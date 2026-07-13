-- ============================================================
-- CNTP Production Capture — add 'smallblender' as a valid section_id
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260611_002_shift_assignments.sql, 20260704_005_prod_sessions_section_direct.sql
-- ============================================================
-- Small Blender reuses the Big Blender capture component (BlenderCapture),
-- keyed off its own work centre ('05-BLENDER SMALL') in production.bom_components.
-- It was already listed in lib/production/live-types.ts's SECTION_CONFIG, but
-- the DB-side CHECK constraints on section_id predate it and need widening —
-- without this, saving a shift assignment or session for Small Blender fails.
-- ============================================================

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

ALTER TABLE production.prod_sessions
  ADD CONSTRAINT prod_sessions_section_id_check
  CHECK (section_id IN (
    'sieving', 'refining1', 'refining2',
    'granule', 'blender', 'smallblender', 'pasteuriser'
  )) NOT VALID;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'production.shift_assignments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%section_id%'
  LOOP
    EXECUTE 'ALTER TABLE production.shift_assignments DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE production.shift_assignments
  ADD CONSTRAINT shift_assignments_section_id_check
  CHECK (section_id IN (
    'sieving', 'refining1', 'refining2',
    'granule', 'blender', 'smallblender', 'pasteuriser'
  )) NOT VALID;
