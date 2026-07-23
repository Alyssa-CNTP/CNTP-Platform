-- ============================================================
-- CNTP Production — Yield / Batch Reporting Query Layer
-- Run in: Supabase SQL Editor as the owner role (staging first, then prod)
-- Depends on: 20260611_001_production_capture.sql, 20260618_002_checks_engine.sql,
--             20260706_001_production_runs.sql, 20260721_002_batch_spine.sql
-- ============================================================
--
-- Reusable read-side views for yield analytics. Until now every KPI was computed
-- in per-page TypeScript; these views make the joins (capture <-> machine params
-- <-> quality) queryable once and consistently.
--
-- The quality views cross into the qms schema. They are created as OWNER-privileged
-- views (default, NOT security_invoker) so an app user querying them reads qms via
-- the view owner without needing direct qms access. This is acceptable because the
-- data is already visible to these users through the quality pages; keep it in mind
-- if qms RLS is ever tightened. RUN THIS SCRIPT AS THE SQL-EDITOR OWNER (postgres),
-- which owns/sees qms.*.
--
-- Quality column TYPES in qms.* are not guaranteed (those tables aren't in repo
-- migrations), so quality values are surfaced as latest-value TEXT via
-- array_agg(col::text ...) — type-safe regardless of the underlying type; the API
-- layer parses numbers. Aggregate maths (avg etc.) is done in TypeScript.
-- ============================================================


-- ── v_session_yield — one row per capture session ────────────
-- Yield% = output(B+C+D) / input, mirroring app/api/production/manager-kpis.
CREATE OR REPLACE VIEW production.v_session_yield AS
SELECT
  s.id            AS session_id,
  s.section_id,
  s.date,
  s.shift,
  s.status,
  s.variant,
  s.lot_number,
  s.batch_id,
  b.batch_key,
  s.run_id,
  COALESCE(mb.total_input_kg, 0) AS input_kg,
  COALESCE(mb.total_output_b_kg, 0)
    + COALESCE(mb.total_output_c_kg, 0)
    + COALESCE(mb.total_output_d_kg, 0) AS output_kg,
  mb.balance_kg,
  COALESCE(mb.tolerance_kg, 15) AS tolerance_kg,
  CASE WHEN COALESCE(mb.total_input_kg, 0) > 0
       THEN round(
              ( (COALESCE(mb.total_output_b_kg,0)
                 + COALESCE(mb.total_output_c_kg,0)
                 + COALESCE(mb.total_output_d_kg,0)) / mb.total_input_kg
              ) * 100, 1)
  END AS yield_pct,
  CASE WHEN mb.balance_kg IS NULL THEN NULL
       ELSE abs(mb.balance_kg) <= COALESCE(mb.tolerance_kg, 15)
  END AS within_tol
FROM production.prod_sessions s
LEFT JOIN production.prod_mass_balance mb ON mb.session_id = s.id
LEFT JOIN production.batches b            ON b.id = s.batch_id
WHERE s.deleted_at IS NULL;


-- ── v_output_stream — one row per output product per session ──
-- Carries each product's share of that session's total output — the core
-- "Fine Leaf 3600 / total 6007 ≈ 59.9%" figure, generalized to every stream.
CREATE OR REPLACE VIEW production.v_output_stream AS
WITH per AS (
  SELECT session_id, product_type, sum(kg) AS kg, count(*) AS bag_count
  FROM production.prod_bagging
  GROUP BY session_id, product_type
),
tot AS (
  SELECT session_id, sum(kg) AS session_output_kg FROM per GROUP BY session_id
)
SELECT
  p.session_id,
  s.section_id, s.date, s.shift, s.variant, s.lot_number, s.batch_id, b.batch_key,
  p.product_type,
  p.kg,
  p.bag_count,
  t.session_output_kg,
  CASE WHEN t.session_output_kg > 0
       THEN round((p.kg / t.session_output_kg) * 100, 1)
  END AS output_share_pct
FROM per p
JOIN tot t                        ON t.session_id = p.session_id
JOIN production.prod_sessions s    ON s.id = p.session_id AND s.deleted_at IS NULL
LEFT JOIN production.batches b     ON b.id = s.batch_id;


-- ── v_machine_params — machine settings pivoted per checks record ──
-- check_records is UNIQUE(section_id,date,shift) and carries session_id, so this
-- is 1:1 with a session (via session_id when set, else the section/date/shift key).
-- VSD is hourly → avg/min/max; startup readings → the recorded value.
CREATE OR REPLACE VIEW production.v_machine_params AS
SELECT
  cr.id         AS check_record_id,
  cr.session_id,
  cr.section_id,
  cr.date,
  cr.shift,
  max(e.value_num) FILTER (WHERE e.check_key = 'indent_screen_speed') AS indent_screen_speed_rpm,
  max(e.value_num) FILTER (WHERE e.check_key = 'indent_screen_angle') AS indent_screen_angle_deg,
  avg(e.value_num) FILTER (WHERE e.check_key = 'infeed_vsd')          AS infeed_vsd_hz_avg,
  min(e.value_num) FILTER (WHERE e.check_key = 'infeed_vsd')          AS infeed_vsd_hz_min,
  max(e.value_num) FILTER (WHERE e.check_key = 'infeed_vsd')          AS infeed_vsd_hz_max,
  count(*)         FILTER (WHERE e.check_key = 'infeed_vsd')          AS infeed_vsd_reading_count,
  (array_agg(e.value_text) FILTER (WHERE e.check_key = 'sieving_config' AND e.value_text IS NOT NULL))[1] AS sieving_config,
  max(e.value_num) FILTER (WHERE e.check_key = 'scale_verification')  AS scale_verification_kg
FROM production.check_records cr
LEFT JOIN production.check_events e ON e.record_id = cr.id
GROUP BY cr.id, cr.session_id, cr.section_id, cr.date, cr.shift;


-- ── v_batch_quality — quality factors per canonical batch ─────
-- Normalize-joins qms.sd_runs + qms.quality_records to production.batches.
-- Latest values as TEXT (type-safe); API parses numbers.
-- TODO(qms schema confirm): add qms.granule_samples.moisture / untapped_bd once the
-- granule batch/lot join column is confirmed against the live qms schema. Left out
-- deliberately rather than guessing a column name and breaking this migration.
CREATE OR REPLACE VIEW production.v_batch_quality AS
WITH sd AS (
  SELECT
    production.normalize_batch(lot_number) AS batch_key,
    (array_agg(bulk_density::text ORDER BY date DESC NULLS LAST) FILTER (WHERE bulk_density IS NOT NULL))[1] AS bulk_density_latest,
    (array_agg(leaf_shade::text   ORDER BY date DESC NULLS LAST) FILTER (WHERE leaf_shade   IS NOT NULL))[1] AS leaf_shade_latest,
    (array_agg(pa_level::text     ORDER BY date DESC NULLS LAST) FILTER (WHERE pa_level     IS NOT NULL))[1] AS pa_level_latest,
    bool_and(pass_status = 'pass') AS all_passed,
    count(*)  AS sd_run_count,
    max(date) AS last_sd_date
  FROM qms.sd_runs
  WHERE lot_number IS NOT NULL
  GROUP BY production.normalize_batch(lot_number)
),
qr AS (
  SELECT
    production.normalize_batch(batch_number) AS batch_key,
    (array_agg(data_json->>'pa_level')        FILTER (WHERE workflow = 'pa_ta_analysis'))[1] AS pa_ta_level,
    (array_agg(data_json->>'overall_r_grade') FILTER (WHERE workflow = 'residue'))[1]        AS residue_grade
  FROM qms.quality_records
  WHERE batch_number IS NOT NULL
  GROUP BY production.normalize_batch(batch_number)
)
SELECT
  b.id AS batch_id,
  b.batch_key,
  sd.bulk_density_latest,
  sd.leaf_shade_latest,
  sd.pa_level_latest,
  sd.all_passed,
  sd.sd_run_count,
  sd.last_sd_date,
  qr.pa_ta_level,
  qr.residue_grade
FROM production.batches b
LEFT JOIN sd ON sd.batch_key = b.batch_key
LEFT JOIN qr ON qr.batch_key = b.batch_key;


-- ── v_batch_360 — one consolidated row per canonical batch ────
-- Production rollup + quality, keyed on batch. Acumatica PO columns are added by
-- the Phase-3 migration once the production-order sync lands.
CREATE OR REPLACE VIEW production.v_batch_360 AS
WITH prod AS (
  SELECT
    batch_id,
    count(DISTINCT session_id)     AS session_count,
    array_agg(DISTINCT section_id) AS sections,
    sum(input_kg)                  AS total_input_kg,
    sum(output_kg)                 AS total_output_kg,
    CASE WHEN sum(input_kg) > 0
         THEN round((sum(output_kg) / sum(input_kg)) * 100, 1) END AS yield_pct,
    min(date) AS first_date,
    max(date) AS last_date
  FROM production.v_session_yield
  WHERE batch_id IS NOT NULL
  GROUP BY batch_id
)
SELECT
  b.id AS batch_id,
  b.batch_key,
  b.display_lot,
  b.variant,
  b.first_section,
  p.session_count,
  p.sections,
  p.total_input_kg,
  p.total_output_kg,
  p.yield_pct,
  p.first_date,
  p.last_date,
  q.bulk_density_latest,
  q.leaf_shade_latest,
  q.pa_level_latest,
  q.all_passed,
  q.sd_run_count,
  q.pa_ta_level,
  q.residue_grade,
  -- Data-completeness flags — surface gaps instead of hiding them.
  (q.sd_run_count IS NOT NULL AND q.sd_run_count > 0) AS has_quality
FROM production.batches b
LEFT JOIN prod p             ON p.batch_id = b.id
LEFT JOIN production.v_batch_quality q ON q.batch_id = b.id;


-- ── Grants — authenticated may read the views ─────────────────
GRANT SELECT ON production.v_session_yield  TO authenticated, service_role;
GRANT SELECT ON production.v_output_stream  TO authenticated, service_role;
GRANT SELECT ON production.v_machine_params TO authenticated, service_role;
GRANT SELECT ON production.v_batch_quality  TO authenticated, service_role;
GRANT SELECT ON production.v_batch_360      TO authenticated, service_role;
