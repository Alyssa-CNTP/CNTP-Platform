-- ============================================================
-- CNTP Production — direct DDL fix for prod_sessions section_id constraint
-- Run in: Supabase SQL Editor on PRODUCTION project
-- ============================================================
-- The earlier DO-block migration may not have taken effect cleanly.
-- This uses direct ALTER TABLE statements instead.
-- ============================================================

-- Drop any existing CHECK constraint on section_id (handles any auto-generated name).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'production.prod_sessions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%section_id%'
  LOOP
    EXECUTE 'ALTER TABLE production.prod_sessions DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- Re-add with all 6 sections.
ALTER TABLE production.prod_sessions
  ADD CONSTRAINT prod_sessions_section_id_check
  CHECK (section_id IN (
    'sieving', 'refining1', 'refining2',
    'granule', 'blender', 'pasteuriser'
  )) NOT VALID;

-- Drop and re-add output_group constraint to include 'A' (for refining outputA stream).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'production.prod_bagging'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%output_group%'
  LOOP
    EXECUTE 'ALTER TABLE production.prod_bagging DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE production.prod_bagging
  ADD CONSTRAINT prod_bagging_output_group_check
  CHECK (output_group IN ('A', 'B', 'C', 'D')) NOT VALID;
