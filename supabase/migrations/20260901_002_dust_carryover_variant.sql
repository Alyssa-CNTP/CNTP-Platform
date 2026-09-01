-- ============================================================
-- CNTP — dust carry-over ledger: split by variant family
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- Depends on: 20260804_002_dust_carryover.sql
-- ============================================================
--
-- production.dust_carryover_log tracks leftover dust per (section_id,
-- item_key), so SG Dust and SF Dust never mix. But conventional and organic
-- are ALSO separate physical pools that never mix, and the table had no way to
-- say so — an organic shift's leftover and a conventional shift's leftover for
-- the same dust type summed into one outstanding balance, and whichever line
-- asked first was offered the lot.
--
-- production.bucket_elevator_log (20260818_003) already got this right with a
-- variant_family column. This brings the dust ledger to the same shape.
--
-- Existing rows are backfilled to 'conventional': the Granule Line ran
-- conventional only up to this point, so that is the true value rather than a
-- convenient default. Verify before running:
--
--   SELECT variant_family, count(*), sum(kg)
--   FROM production.dust_carryover_log
--   GROUP BY 1;
--
-- If any organic rows exist, correct them by hand BEFORE the NOT NULL below —
-- an outstanding balance attributed to the wrong family sends organic dust
-- into a conventional blend, which is a certification failure, not a rounding
-- error.
-- ============================================================

ALTER TABLE production.dust_carryover_log
  ADD COLUMN IF NOT EXISTS variant_family text;

UPDATE production.dust_carryover_log
  SET variant_family = 'conventional'
  WHERE variant_family IS NULL;

-- DEFAULT, not just NOT NULL, and deliberately so. This migration has to be
-- applied BEFORE the code that supplies the column deploys — but the code
-- currently running inserts without it, and a bare NOT NULL would make every
-- one of those inserts fail for the length of the deploy. With the default,
-- the old code keeps working and the new code always passes the value
-- explicitly, so neither order of operations has a broken window.
ALTER TABLE production.dust_carryover_log
  ALTER COLUMN variant_family SET DEFAULT 'conventional';
ALTER TABLE production.dust_carryover_log
  ALTER COLUMN variant_family SET NOT NULL;

ALTER TABLE production.dust_carryover_log
  DROP CONSTRAINT IF EXISTS dust_carryover_log_variant_family_check;
ALTER TABLE production.dust_carryover_log
  ADD CONSTRAINT dust_carryover_log_variant_family_check
  CHECK (variant_family IN ('conventional','organic'));

-- The old index no longer matches how the balance is read: every query now
-- filters all three columns.
DROP INDEX IF EXISTS production.dust_carryover_log_section_item_idx;
CREATE INDEX IF NOT EXISTS dust_carryover_log_section_item_variant_idx
  ON production.dust_carryover_log(section_id, item_key, variant_family);
