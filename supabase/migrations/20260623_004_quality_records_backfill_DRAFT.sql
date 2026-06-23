-- 20260623_004_quality_records_backfill  — DRAFT, NOT YET RUN
-- ---------------------------------------------------------------------------
-- Goal: finish consolidating legacy quality data into qms so the app can stop
-- reading the public schema at runtime ("everything in qms").
--
-- IMPORTANT — this is a SAME-DATABASE operation. public.quality_records and
-- qms.quality_records both live in the PRODUCTION project (sxzjjcyuzyfneesnsjna).
-- "Staging-first" only rehearses this if staging holds a comparable
-- public.quality_records; otherwise treat staging as a structural dry-run and
-- the real backfill runs against production after review.
--
-- Audit at time of writing (read-only, 2026-06-23, production):
--   public.quality_records = 854 rows
--   qms.quality_records    = 862 rows  (already a re-keyed superset of public)
--   public rows NOT already in qms (by workcenter|workflow|batch|file|created_at)
--                          = 5 rows, all workcenter='pasteuriser'
-- So this backfill is tiny — qms is already ~complete. The remaining work is
-- mostly retiring the dual-read code path (see note at bottom), not moving data.
--
-- Safe to run repeatedly: the NOT EXISTS guard makes it idempotent, and we do
-- NOT copy public.id (qms.id is its own sequence) to avoid PK collisions.
-- No capture/calculation logic is affected — this only copies rows.
-- ---------------------------------------------------------------------------

BEGIN;

-- Snapshot counts before (visible in the migration output)
DO $$
DECLARE p_count int; q_count int;
BEGIN
  SELECT count(*) INTO p_count FROM public.quality_records;
  SELECT count(*) INTO q_count FROM qms.quality_records;
  RAISE NOTICE 'BEFORE: public=% qms=%', p_count, q_count;
END $$;

INSERT INTO qms.quality_records
  (workcenter, workflow, batch_number, data_json, file_name, file_path, comment, uploaded_by, created_at)
SELECT
  p.workcenter, p.workflow, p.batch_number, p.data_json, p.file_name, p.file_path, p.comment, p.uploaded_by, p.created_at
FROM public.quality_records p
WHERE NOT EXISTS (
  SELECT 1 FROM qms.quality_records q
  WHERE q.workcenter   IS NOT DISTINCT FROM p.workcenter
    AND q.workflow     IS NOT DISTINCT FROM p.workflow
    AND q.batch_number IS NOT DISTINCT FROM p.batch_number
    AND q.file_name    IS NOT DISTINCT FROM p.file_name
    AND q.created_at   IS NOT DISTINCT FROM p.created_at
);

-- Snapshot counts after; expect qms to grow by exactly the missing-row count (5)
DO $$
DECLARE q_count int;
BEGIN
  SELECT count(*) INTO q_count FROM qms.quality_records;
  RAISE NOTICE 'AFTER:  qms=%', q_count;
END $$;

-- Review the result, then COMMIT. Use ROLLBACK to abort during a dry-run.
COMMIT;

-- ---------------------------------------------------------------------------
-- Verification (run manually after COMMIT):
--   SELECT count(*) FROM public.quality_records p
--   WHERE NOT EXISTS (
--     SELECT 1 FROM qms.quality_records q
--     WHERE q.workcenter IS NOT DISTINCT FROM p.workcenter
--       AND q.workflow   IS NOT DISTINCT FROM p.workflow
--       AND q.batch_number IS NOT DISTINCT FROM p.batch_number
--       AND q.file_name  IS NOT DISTINCT FROM p.file_name
--       AND q.created_at IS NOT DISTINCT FROM p.created_at);
--   -- expect 0
--
-- OUT OF SCOPE for this draft (need separate schema mapping, different table
-- shapes than quality_records):
--   public.sd_runs       (1915 rows — legacy sieving)  -> qms.sieving_* ?
--   public.granule_runs  (31 rows)                      -> qms.granule_runs ?
-- These should be mapped and backfilled in their own reviewed migrations.
--
-- AFTER this lands and is verified, the runtime dual-read can be retired so the
-- app reads qms only (no logic change to capture/calc):
--   - app/(app)/quality/pasteuriser/page.tsx — drop the /api/quality/
--     legacy-pasteuriser merge in the load effect + loadPubHistory; the
--     "Historical" toggle becomes a filter over qms instead of a public read.
--   - app/api/quality/legacy-pasteuriser/route.ts + legacy-public/route.ts —
--     remove once nothing reads public.
-- ---------------------------------------------------------------------------
