-- ============================================================
-- Fix: Refining's "A" output stream was silently dropped from
-- production.prod_mass_balance and everything reading it.
-- Run in: Supabase SQL Editor — STAGING (qjqkpockmujecjgmdple), then
--         PRODUCTION (sxzjjcyuzyfneesnsjna) once promoted.
-- Depends on: 20260611_001_production_capture.sql, 20260721_003_yield_views.sql
-- ============================================================
--
-- prod_mass_balance only ever had B/C/D output slots (fine for granule/
-- sieving/pasteuriser, which each write their single output total into B).
-- Refining genuinely has up to 4 named output streams (A/B/C/D), and the app
-- only wrote B/C/D — A (Refining 1's "Indent Dust" / Refining 2's "Cut Heavy
-- Stick Fine") never reached this table, so balance_kg and every view built on
-- it (v_session_yield, v_batch_360, the Production Orders tab) were wrong for
-- every refining session. This adds the missing column and folds it into the
-- generated balance/yield math.
--
-- balance_kg is a STORED generated column, so it can't be altered in place —
-- it has to be dropped and recreated. v_session_yield depends on it, and
-- v_batch_360 depends on v_session_yield, so a plain DROP COLUMN fails; this
-- uses CASCADE and then rebuilds both views (and their grants) exactly as
-- they were, just with A folded into the totals.
-- ============================================================

ALTER TABLE production.prod_mass_balance
  ADD COLUMN IF NOT EXISTS total_output_a_kg numeric NOT NULL DEFAULT 0;

-- CASCADE also drops production.v_session_yield and production.v_batch_360
-- (which depends on v_session_yield) — both are recreated below.
ALTER TABLE production.prod_mass_balance DROP COLUMN IF EXISTS balance_kg CASCADE;
ALTER TABLE production.prod_mass_balance
  ADD COLUMN balance_kg numeric GENERATED ALWAYS AS (
    total_input_kg
    - total_output_a_kg
    - total_output_b_kg
    - total_output_c_kg
    - total_output_d_kg
  ) STORED;

-- ── v_session_yield — include A in output_kg / yield_pct ──────────────────
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
  COALESCE(mb.total_output_a_kg, 0)
    + COALESCE(mb.total_output_b_kg, 0)
    + COALESCE(mb.total_output_c_kg, 0)
    + COALESCE(mb.total_output_d_kg, 0) AS output_kg,
  mb.balance_kg,
  COALESCE(mb.tolerance_kg, 15) AS tolerance_kg,
  CASE WHEN COALESCE(mb.total_input_kg, 0) > 0
       THEN round(
              ( (COALESCE(mb.total_output_a_kg,0)
                 + COALESCE(mb.total_output_b_kg,0)
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

-- ── v_batch_360 — unchanged from 20260721_003_yield_views.sql, just needs
--    recreating since CASCADE dropped it along with v_session_yield ────────
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
  (q.sd_run_count IS NOT NULL AND q.sd_run_count > 0) AS has_quality
FROM production.batches b
LEFT JOIN prod p             ON p.batch_id = b.id
LEFT JOIN production.v_batch_quality q ON q.batch_id = b.id;

-- ── Grants — CASCADE drop removes previous grants on both views; reinstate ─
GRANT SELECT ON production.v_session_yield TO authenticated, service_role;
GRANT SELECT ON production.v_batch_360     TO authenticated, service_role;
