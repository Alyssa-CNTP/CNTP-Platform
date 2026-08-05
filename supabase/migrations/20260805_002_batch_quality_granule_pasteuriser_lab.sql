-- ============================================================
-- CNTP Production — extend v_batch_quality / v_batch_360 with
-- Granule, Pasteuriser and Lab Results quality
-- Run in: Supabase SQL Editor (staging qjqkpockmujecjgmdple first, then prod)
-- Depends on: 20260721_002_batch_spine.sql, 20260721_003_yield_views.sql
-- ============================================================
--
-- 20260721_003_yield_views.sql deliberately left these out — its comment said
-- "add qms.granule_samples.moisture / untapped_bd once the granule batch/lot
-- join column is confirmed against the live qms schema... rather than
-- guessing." That confirmation has now been done by reading the actual,
-- working queries in the quality capture pages themselves (not guessed):
--
--   qms.granule_runs(batch_number, production_date, overall_status, ...)
--     — app/(app)/quality/granule/page.tsx, e.g. handleAddRun's insert body
--   qms.granule_samples(run_id -> granule_runs.id, moisture, bulk_density, ...)
--     — same file, handleAddSample / handleEditSample
--   qms.quality_records(batch_number, workflow='pasteuriser_run',
--     data_json->'samples' jsonb array, each sample carrying .moisture and
--     .untapped_bd) — app/(app)/quality/pasteuriser/page.tsx
--   qms.lab_results(batch_no, overall_status, date_issued, created_at)
--     — app/(app)/quality/lab-results/page.tsx
--
-- qms.raw-material quality_records (workcenter='rawMaterial') is NOT joined
-- here — it carries pesticide/EU-MRL residue compliance for incoming raw leaf,
-- not moisture/bulk-density/waste, and its batch numbering predates any
-- processed batch_key, so joining it to production.batches would be a
-- different, lower-confidence kind of join than the three above. Left for a
-- separate decision if/when that data is wanted on the batch view.
--
-- None of qms.*'s tables or the quality pages that own them are touched —
-- this migration only adds read-only SELECTs against them from a new view
-- layer in the production schema, exactly like 20260721_003 already does for
-- qms.sd_runs and qms.quality_records.
-- ============================================================

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
),
-- ── Granule Line: moisture/BD per sample, aggregated to the run's batch ────
granule AS (
  SELECT
    production.normalize_batch(gr.batch_number) AS batch_key,
    (array_agg(gs.moisture::text ORDER BY gs.sample_date DESC NULLS LAST, gs.sample_time DESC NULLS LAST)
      FILTER (WHERE gs.moisture IS NOT NULL))[1] AS granule_moisture_latest,
    (array_agg(gs.bulk_density::text ORDER BY gs.sample_date DESC NULLS LAST, gs.sample_time DESC NULLS LAST)
      FILTER (WHERE gs.bulk_density IS NOT NULL))[1] AS granule_bulk_density_latest,
    bool_and(gr.overall_status = 'Pass') AS granule_all_passed,
    count(DISTINCT gr.id) AS granule_run_count,
    max(gr.production_date) AS last_granule_date
  FROM qms.granule_runs gr
  LEFT JOIN qms.granule_samples gs ON gs.run_id = gr.id
  WHERE gr.batch_number IS NOT NULL
  GROUP BY production.normalize_batch(gr.batch_number)
),
-- ── Pasteuriser: moisture/BD live inside data_json->'samples', not flat
-- columns — unnest per run, then take the latest non-null sample value.
past AS (
  SELECT
    production.normalize_batch(qr2.batch_number) AS batch_key,
    (array_agg(s->>'moisture' ORDER BY qr2.created_at DESC)
      FILTER (WHERE (s->>'moisture') IS NOT NULL))[1] AS pasteuriser_moisture_latest,
    (array_agg(s->>'untapped_bd' ORDER BY qr2.created_at DESC)
      FILTER (WHERE (s->>'untapped_bd') IS NOT NULL))[1] AS pasteuriser_bd_latest,
    count(s) AS pasteuriser_sample_count,
    max(qr2.created_at)::date AS last_pasteuriser_date
  FROM qms.quality_records qr2
  LEFT JOIN LATERAL jsonb_array_elements(COALESCE(qr2.data_json->'samples', '[]'::jsonb)) AS s ON true
  WHERE qr2.workflow = 'pasteuriser_run' AND qr2.batch_number IS NOT NULL
  GROUP BY production.normalize_batch(qr2.batch_number)
),
-- ── Final product lab results (COA micro/pesticide/heavy-metals/etc.) —
-- pass/fail + a count, keyed on batch_no. The compound-level results stay in
-- their own jsonb blob (results) and are not unpacked here; overall_status is
-- the pass/fail signal the batch view needs.
lab AS (
  SELECT
    production.normalize_batch(batch_no) AS batch_key,
    (array_agg(overall_status ORDER BY date_issued DESC NULLS LAST, created_at DESC)
      FILTER (WHERE overall_status IS NOT NULL AND overall_status <> ''))[1] AS lab_overall_status_latest,
    count(*) AS lab_result_count,
    max(date_issued) AS last_lab_date_issued
  FROM qms.lab_results
  WHERE batch_no IS NOT NULL
  GROUP BY production.normalize_batch(batch_no)
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
  qr.residue_grade,
  granule.granule_moisture_latest,
  granule.granule_bulk_density_latest,
  granule.granule_all_passed,
  granule.granule_run_count,
  granule.last_granule_date,
  past.pasteuriser_moisture_latest,
  past.pasteuriser_bd_latest,
  past.pasteuriser_sample_count,
  past.last_pasteuriser_date,
  lab.lab_overall_status_latest,
  lab.lab_result_count,
  lab.last_lab_date_issued
FROM production.batches b
LEFT JOIN sd      ON sd.batch_key      = b.batch_key
LEFT JOIN qr      ON qr.batch_key      = b.batch_key
LEFT JOIN granule ON granule.batch_key = b.batch_key
LEFT JOIN past    ON past.batch_key    = b.batch_key
LEFT JOIN lab     ON lab.batch_key     = b.batch_key;


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
  q.granule_moisture_latest,
  q.granule_bulk_density_latest,
  q.granule_all_passed,
  q.granule_run_count,
  q.pasteuriser_moisture_latest,
  q.pasteuriser_bd_latest,
  q.pasteuriser_sample_count,
  q.lab_overall_status_latest,
  q.lab_result_count,
  -- Data-completeness flags — surface gaps instead of hiding them.
  (q.sd_run_count IS NOT NULL AND q.sd_run_count > 0) AS has_quality,
  (q.granule_run_count IS NOT NULL AND q.granule_run_count > 0) AS has_granule_quality,
  (q.pasteuriser_sample_count IS NOT NULL AND q.pasteuriser_sample_count > 0) AS has_pasteuriser_quality,
  (q.lab_result_count IS NOT NULL AND q.lab_result_count > 0) AS has_lab_result
FROM production.batches b
LEFT JOIN prod p             ON p.batch_id = b.id
LEFT JOIN production.v_batch_quality q ON q.batch_id = b.id;


-- Grants unchanged (views already granted by 20260721_003); re-stated in case
-- this runs standalone on an environment where that grant was missed.
GRANT SELECT ON production.v_batch_quality TO authenticated, service_role;
GRANT SELECT ON production.v_batch_360     TO authenticated, service_role;
