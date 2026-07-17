-- ============================================================
-- CNTP Production — Timesheet worked-minutes recompute (OPTIONAL, manual)
-- Run in: Supabase SQL Editor — STAGING first, review, then production.
-- Depends on: 20260613_001_timesheets.sql
-- ============================================================
--
-- Context: until the login-anchored fix, worked_minutes was derived by treating
-- any inactivity gap >=5 min as a break (>30 min = lunch). Operators do long
-- stretches of physical floor work without touching the tablet, so a whole shift
-- collapsed into one giant "lunch" and worked_minutes came out as a few minutes
-- (e.g. an 08:24–15:57 shift showing 8m). New timesheets are now computed as
-- (login -> sign-off) minus the standard break schedule and are correct.
--
-- This script re-approximates the EXISTING confirmed rows so the historical
-- numbers stop looking absurd. It is APPROXIMATE on purpose:
--   * shift_start is reliable (it was always the first stamp = login).
--   * shift_end on old rows is the LAST activity stamp, which underestimates the
--     true end when the operator stopped tapping well before sign-off. There is
--     no stored signal for the real end on historical rows, so we cannot make
--     these exact — only sane. Going forward, timesheets are exact.
--
-- Formula: worked = GREATEST(0, round(minutes(shift_end - shift_start))
--                                  - standard_break_allowance(shift))
--   morning            → 60 min (tea 30 + lunch 30)
--   afternoon / night  → 75 min (tea 15 + meal 60)
-- The stored `breaks` array is left untouched (audit); only worked_minutes moves.
-- ============================================================

-- ── STEP 1 — PREVIEW. Run this SELECT ALONE first and eyeball the before/after.
--    Nothing is written. Sanity-check a handful of full shifts read ~7–8h.
/*
SELECT
  t.date,
  t.section_id,
  t.shift,
  t.operator_name,
  to_char(t.shift_start AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') AS start_sast,
  to_char(t.shift_end   AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') AS end_sast,
  t.worked_minutes                                              AS worked_old,
  GREATEST(0,
    round(EXTRACT(EPOCH FROM (t.shift_end - t.shift_start)) / 60.0)
    - CASE WHEN t.shift = 'morning' THEN 60 ELSE 75 END
  )::int                                                        AS worked_new
FROM production.prod_timesheets t
WHERE t.confirmed = true
  AND t.shift_start IS NOT NULL
  AND t.shift_end   IS NOT NULL
ORDER BY t.date DESC, t.section_id, t.operator_name;
*/

-- ── STEP 2 — APPLY. Only after the preview looks right. Wrapped in a txn so a
--    surprising row count can be rolled back before COMMIT.
/*
BEGIN;

UPDATE production.prod_timesheets t
SET worked_minutes = GREATEST(0,
      round(EXTRACT(EPOCH FROM (t.shift_end - t.shift_start)) / 60.0)
      - CASE WHEN t.shift = 'morning' THEN 60 ELSE 75 END
    )::int,
    updated_at = now()
WHERE t.confirmed = true
  AND t.shift_start IS NOT NULL
  AND t.shift_end   IS NOT NULL;

-- Check the row count, then either:
--   COMMIT;    -- keep the recompute
--   ROLLBACK;  -- undo and investigate
*/
