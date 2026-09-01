-- ============================================================
-- CNTP — capture schema drift: prod_bagging (session_id, bag_no) unique index
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- Depends on: 20260611_001_production_capture.sql (production.prod_bagging)
-- ============================================================
--
-- prod_bagging_session_bag_uidx exists in the live databases but in NO
-- migration file. The capture save path depends on it — there is a comment in
-- app/(app)/production/capture/[section]/page.tsx explaining that bag_no is
-- handed out from the numbers actually free "once the deletes have run",
-- precisely because this index rejects a duplicate (session_id, bag_no).
--
-- So the app's save logic is written against a constraint the repo does not
-- declare. Anyone rebuilding a database from migrations alone gets a schema
-- where that logic is subtly wrong and the bug only appears under concurrent
-- use. This migration closes that gap. It is a no-op where the index already
-- exists.
--
-- Note: CREATE UNIQUE INDEX will fail if duplicate (session_id, bag_no) pairs
-- are already present. The SELECT below is here so you can check first — run
-- it, confirm zero rows, then run the CREATE.
-- ============================================================

-- Pre-flight: must return zero rows before the index will build.
--
--   SELECT session_id, bag_no, count(*)
--   FROM production.prod_bagging
--   WHERE bag_no IS NOT NULL
--   GROUP BY session_id, bag_no
--   HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS prod_bagging_session_bag_uidx
  ON production.prod_bagging(session_id, bag_no);
