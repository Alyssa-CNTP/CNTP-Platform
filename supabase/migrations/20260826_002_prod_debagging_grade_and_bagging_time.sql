-- 20260826_002_prod_debagging_grade_and_bagging_time.sql
--
-- Two prod_debagging schema changes requested together:
--
--   1. Rename local_or_export -> grade. A debagging row doesn't carry a bare
--      local-vs-export flag so much as the bulk bag's quality grade (Export /
--      Export Blend / Domestic/Local) -- same three values, a name that
--      actually says what it is. The existing CHECK constraint is preserved
--      verbatim: Postgres keeps a column's constraints working across a
--      rename (it tracks the column by attnum, not name) -- only the
--      constraint's own auto-generated name still reads local_or_export.
--      Scoped to production.prod_debagging only -- the unrelated
--      local_or_export columns on job_cards_granule / job_cards_pasteuriser
--      are untouched.
--
--   2. Add bagging_time (timestamptz), the debag-side twin of
--      prod_bagging.bagging_time (20260813_001): persist() deletes and
--      reinserts every prod_debagging row on every save, so created_at is
--      really "when this session was last saved", not when the bag was
--      actually captured -- identical across the whole session and drifting
--      forward the whole time the screen stays open. Every debag row already
--      carries a real logged_at instant client-side (same pattern as output
--      bags' logged_at); this column gives it somewhere durable to live,
--      immune to the delete+reinsert restamp. Nullable and NOT backfilled --
--      historical rows have no better instant to fall back to than their own
--      created_at, same as prod_bagging.bagging_time was left NULL-and-
--      falling-back for rows that predate it.
--
-- Idempotent: guarded so re-running is a no-op.
--
-- ⚠ Apply manually per docs/db-reconciliation-runbook.md -- this repo's
--   migration-push workflow is disabled. Run on staging first, then
--   production, and land the matching app-code deploy close after (code
--   references to local_or_export become grade in the same deploy -- a
--   window where the column has the new name but old code still writes
--   local_or_export would fail every debagging save).

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'production' AND table_name = 'prod_debagging' AND column_name = 'local_or_export'
  ) THEN
    ALTER TABLE production.prod_debagging RENAME COLUMN local_or_export TO grade;
  END IF;
END $$;

ALTER TABLE production.prod_debagging
  ADD COLUMN IF NOT EXISTS bagging_time timestamptz;

COMMIT;

NOTIFY pgrst, 'reload schema';
