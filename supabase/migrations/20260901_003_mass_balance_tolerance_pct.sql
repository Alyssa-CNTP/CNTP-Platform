-- ============================================================
-- CNTP — mass-balance tolerance becomes +/-1% of Total Input
-- Run in: Supabase SQL Editor — STAGING (qjqkpockmujecjgmdple), then
--         PRODUCTION (sxzjjcyuzyfneesnsjna) once promoted.
-- Depends on: 20260728_001_refining_mass_balance_output_a.sql
-- ============================================================
--
-- Every section's tolerance is now +/-1% of Total Input. The app side already
-- computes it that way (lib/core/mass-balance/tolerance.ts); this brings
-- v_session_yield with it, because the Batch 360 and Yield Analytics routes
-- read within_tol straight off the view and would otherwise keep flagging
-- against the old flat 15 kg.
--
-- Why a percentage: a fixed 15 kg is ~7% of a 200 kg trial run and ~0.4% of a
-- 4 t shift, so the same allowance meant "nothing ever flags" on one and
-- "everything flags" on the other. refining2 had a 100 kg special case purely
-- because it runs bigger volumes — which is exactly what a percentage handles
-- without a special case, so it is gone.
--
-- prod_mass_balance.tolerance_kg is left in place and is now WRITTEN by the
-- capture save (it previously took its DEFAULT 15 on every row and was never
-- set). The view no longer trusts the stored value: historical rows all carry
-- 15, and reading them back would leave two tolerance regimes side by side.
-- Deriving it here means old sessions re-render under today's rule.
--
-- Sanity check before/after, to see which sessions change state:
--
--   SELECT section_id, count(*) FILTER (WHERE abs(balance_kg) <= 15)          AS ok_old,
--          count(*) FILTER (WHERE abs(balance_kg) <= round(input_kg*0.01, 1)) AS ok_new
--   FROM production.v_session_yield
--   WHERE input_kg > 0
--   GROUP BY 1 ORDER BY 1;
-- ============================================================

-- Same column list, names and types as before, so CREATE OR REPLACE is enough
-- and v_batch_360 (which selects from this view) is left untouched.
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
  -- +/-1% of Total Input, rounded to 0.1 kg — the precision every weight on
  -- the floor is captured at, and the same rounding massBalanceToleranceKg()
  -- applies, so the screen and the view can never disagree by a hair.
  round(COALESCE(mb.total_input_kg, 0) * 0.01, 1) AS tolerance_kg,
  CASE WHEN COALESCE(mb.total_input_kg, 0) > 0
       THEN round(
              ( (COALESCE(mb.total_output_a_kg,0)
                 + COALESCE(mb.total_output_b_kg,0)
                 + COALESCE(mb.total_output_c_kg,0)
                 + COALESCE(mb.total_output_d_kg,0)) / mb.total_input_kg
              ) * 100, 1)
  END AS yield_pct,
  -- A session with no input is "not started", not "everything unaccounted
  -- for" — it has no percentage tolerance, so it is left unjudged (NULL)
  -- rather than being flagged against a zero allowance.
  CASE WHEN mb.balance_kg IS NULL OR COALESCE(mb.total_input_kg, 0) <= 0 THEN NULL
       ELSE abs(mb.balance_kg) <= round(mb.total_input_kg * 0.01, 1)
  END AS within_tol
FROM production.prod_sessions s
LEFT JOIN production.prod_mass_balance mb ON mb.session_id = s.id
LEFT JOIN production.batches b            ON b.id = s.batch_id
WHERE s.deleted_at IS NULL;

GRANT SELECT ON production.v_session_yield TO authenticated, service_role;

-- The column default was the source of the flat 15 on every historical row.
-- New rows are written explicitly by the capture save; drop the default so a
-- row can never again silently claim an allowance nobody calculated.
ALTER TABLE production.prod_mass_balance ALTER COLUMN tolerance_kg DROP DEFAULT;
ALTER TABLE production.prod_mass_balance ALTER COLUMN tolerance_kg DROP NOT NULL;
