-- ============================================================
-- AXIS — tickets: ensure created_by exists and is nullable
-- Run in: Supabase SQL Editor (staging first, then production).
-- ============================================================
-- Follow-up to 20260806_001. That migration's
-- `ALTER TABLE axis.tickets ALTER COLUMN created_by DROP NOT NULL` succeeded
-- on production but failed on staging with "column created_by ... does not
-- exist" — staging's axis.tickets table is missing this column entirely
-- (more of this repo's known axis-schema drift between environments; there
-- is no baseline migration for this schema to keep the two in sync).
--
-- ADD COLUMN IF NOT EXISTS is a no-op wherever the column already exists
-- (production), and creates it — nullable by default — wherever it's
-- missing (staging). The DROP NOT NULL is kept too, in case a fresh ADD ever
-- picks up a NOT NULL default from a table-level default in some environment,
-- and is a harmless no-op everywhere else. Safe to run on both environments
-- regardless of which one is in which state.
-- ============================================================

ALTER TABLE axis.tickets ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE axis.tickets ALTER COLUMN created_by DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
