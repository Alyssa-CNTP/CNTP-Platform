-- ============================================================
-- Granule Line: allow more than one re-check attempt per failing sample.
-- ============================================================
--
-- qms.granule_samples already carries a single re-check slot
-- (recheck_done/recheck_moisture/recheck_dryer_temp/recheck_time/
-- recheck_pass — added out-of-band, no migration for them in this repo,
-- which is why this file only adds to them rather than creating them).
-- Reported: a failing re-check dead-ended the app-side UI at "add a new
-- sample" — there was no way to log a second or third re-test against the
-- SAME failing sample, even though that's QC's normal workflow (keep
-- re-testing the dryer's output until moisture is back in spec).
--
-- This adds a JSONB history array holding every attempt (each element:
-- {n, sample_date, time, moisture, dryer_temp, pass}), so nothing is lost
-- when attempt 1 and 2 fail before attempt 3 passes. The existing single-
-- slot columns are left in place and are now written by the app as a
-- mirror of the LATEST attempt, so any other code/reports still reading
-- recheck_moisture/recheck_pass directly keep working unchanged.
-- ============================================================

ALTER TABLE qms.granule_samples
  ADD COLUMN IF NOT EXISTS recheck_attempts jsonb NOT NULL DEFAULT '[]'::jsonb;
