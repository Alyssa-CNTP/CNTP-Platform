-- ============================================================
-- Fix: batch KPIs (yield / output mix) blank for any batch whose ONLY
-- sessions are Sieving Tower — i.e. every batch while it's still Fine Leaf /
-- Coarse Leaf and hasn't reached Refining/Granule/etc. yet.
-- Run in: Supabase SQL Editor — STAGING (qjqkpockmujecjgmdple) first, then
--         PRODUCTION (sxzjjcyuzyfneesnsjna) once promoted.
-- Depends on: 20260721_002_batch_spine.sql, 20260728_001_refining_mass_balance_output_a.sql
-- ============================================================
--
-- Root cause: v_output_stream and v_batch_360's "prod" rollup both key off
-- production.prod_sessions.batch_id. That column is set from the session's
-- OWN single lot (app/(app)/production/capture/[section]/page.tsx:
-- `prods[0]?.lot || assignment?.lot_number`) — fine for sections that run one
-- lot per shift session, but Sieving debags several different raw-material
-- lots into ONE session, so it has no single session-level lot and
-- prod_sessions.batch_id/lot_number are NULL for every Sieving session
-- (confirmed live: every recent sieving session in staging has both NULL).
-- v_output_stream's `.eq('batch_key', key)` filter then never matches, so the
-- batch page's "Output mix" always came back empty for a Fine/Coarse Leaf
-- batch, and v_batch_360's yield/input/output tiles were blank too since its
-- `prod` CTE only aggregated batch_id'd SESSIONS.
--
-- The bag ROWS themselves (prod_debagging, prod_bagging) already carry the
-- correct per-row batch_id — resolveBatchIds() in the capture page sets it
-- from each bag's own lot, independent of the session. This fix reads that
-- instead of falling through the session, which is both correct (a bag
-- belongs to the lot printed on it, not to whichever lot happened to be
-- first/last in that shift) and general (works whether a session has one
-- lot or several).
-- ============================================================

BEGIN;

-- ── v_output_stream — key output rows off the bag's own batch_id ──────────
-- Was: GROUP BY session_id, product_type, joined to production.batches via
-- prod_sessions.batch_id. A session that debags >1 lot (Sieving, always)
-- meant s.batch_id was NULL, so b.batch_key was NULL, so every Sieving output
-- row silently failed the API route's `.eq('batch_key', key)` filter.
-- Now: GROUP BY session_id, batch_id, product_type — batch_id comes straight
-- off prod_bagging, which is always correctly set per-row. For sections that
-- only ever run one lot per session, batch_id is constant within a session,
-- so this is byte-for-byte the same result as before — this only adds rows
-- back for the multi-lot case, it doesn't change any existing figure.
CREATE OR REPLACE VIEW production.v_output_stream AS
WITH per AS (
  SELECT session_id, batch_id, product_type, sum(kg) AS kg, count(*) AS bag_count
  FROM production.prod_bagging
  WHERE batch_id IS NOT NULL
  GROUP BY session_id, batch_id, product_type
),
tot AS (
  SELECT session_id, batch_id, sum(kg) AS session_output_kg FROM per GROUP BY session_id, batch_id
)
SELECT
  p.session_id,
  s.section_id, s.date, s.shift, s.variant, s.lot_number,
  p.batch_id, b.batch_key,
  p.product_type,
  p.kg,
  p.bag_count,
  t.session_output_kg,
  CASE WHEN t.session_output_kg > 0
       THEN round((p.kg / t.session_output_kg) * 100, 1)
  END AS output_share_pct
FROM per p
JOIN tot t                         ON t.session_id = p.session_id AND t.batch_id = p.batch_id
JOIN production.prod_sessions s    ON s.id = p.session_id AND s.deleted_at IS NULL
JOIN production.batches b          ON b.id = p.batch_id;

-- ── v_batch_360 — add a bag-sourced fallback for batches with no session
--    row that ever got a batch_id (i.e. every touch was Sieving) ──────────
-- Rebuilt from the current definition (20260805_002_batch_quality_granule_
-- pasteuriser_lab.sql — the granule/pasteuriser/lab quality columns live
-- there, NOT in the older 20260728_001 copy). Only the `prod` CTE changes:
-- the existing session-based rollup (v_session_yield, unchanged) is kept
-- exactly as-is for every batch it already covers correctly — this only
-- fills in batches it returns NOTHING for. v_batch_quality is untouched.
CREATE OR REPLACE VIEW production.v_batch_360 AS
WITH prod_from_sessions AS (
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
),
bag_sessions AS (
  -- Sessions that touched this batch, discovered from the bag rows' own
  -- batch_id rather than the session's — this is what lets a Sieving-only
  -- batch (no prod_sessions.batch_id anywhere) still get a session
  -- count / date range / section list.
  SELECT batch_id, session_id FROM production.prod_debagging WHERE batch_id IS NOT NULL
  UNION
  SELECT batch_id, session_id FROM production.prod_bagging   WHERE batch_id IS NOT NULL
),
bag_io AS (
  SELECT
    bs.batch_id,
    count(DISTINCT bs.session_id)      AS session_count,
    array_agg(DISTINCT s.section_id)   AS sections,
    min(s.date)                        AS first_date,
    max(s.date)                        AS last_date
  FROM bag_sessions bs
  JOIN production.prod_sessions s ON s.id = bs.session_id AND s.deleted_at IS NULL
  GROUP BY bs.batch_id
),
bag_output AS (
  -- Mirrors v_session_yield's output_kg = A+B+C+D (see 20260728_001).
  SELECT batch_id, sum(kg) AS output_kg
  FROM production.prod_bagging
  WHERE batch_id IS NOT NULL
  GROUP BY batch_id
),
bag_input AS (
  -- No is_spillage filter needed: bucket-elevator/machine-spillage rows carry
  -- no lot_number (see [section]/page.tsx persist()), so they never resolve
  -- to a batch_id and are already excluded by the WHERE below.
  SELECT batch_id, sum(kg_nett) AS input_kg
  FROM production.prod_debagging
  WHERE batch_id IS NOT NULL
  GROUP BY batch_id
),
prod_from_bags AS (
  SELECT
    bio.batch_id,
    bio.session_count,
    bio.sections,
    COALESCE(bi.input_kg, 0)  AS total_input_kg,
    COALESCE(bo.output_kg, 0) AS total_output_kg,
    CASE WHEN COALESCE(bi.input_kg, 0) > 0
         THEN round((COALESCE(bo.output_kg, 0) / bi.input_kg) * 100, 1) END AS yield_pct,
    bio.first_date,
    bio.last_date
  FROM bag_io bio
  LEFT JOIN bag_output bo ON bo.batch_id = bio.batch_id
  LEFT JOIN bag_input  bi ON bi.batch_id = bio.batch_id
  -- Only batches the session-based rollup found NOTHING for — never
  -- overrides an already-working figure.
  WHERE bio.batch_id NOT IN (SELECT batch_id FROM prod_from_sessions)
),
prod AS (
  SELECT * FROM prod_from_sessions
  UNION ALL
  SELECT * FROM prod_from_bags
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
LEFT JOIN prod p                       ON p.batch_id = b.id
LEFT JOIN production.v_batch_quality q ON q.batch_id = b.id;

GRANT SELECT ON production.v_output_stream TO authenticated, service_role;
GRANT SELECT ON production.v_batch_360     TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
