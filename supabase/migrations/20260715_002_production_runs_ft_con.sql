-- ============================================================
-- CNTP Production Capture — fix production_runs.variant missing FT-CON
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260706_001_production_runs.sql
-- ============================================================
-- production_runs was created 2026-07-06, two weeks after
-- 20260623_004_variant_ft_conventional.sql widened `variant` on every other
-- production table to add 'FT-CON' — but production_runs didn't exist yet at
-- that point, so it was never included, and no follow-up ever caught it. Net
-- effect: an FT-CON session's run-linking insert silently fails the CHECK
-- constraint (swallowed by page.tsx's try/catch, by design, so it never blocks
-- the actual capture save) — but the day-level rollup for FT-CON sessions
-- never gets created. This just brings the constraint in line with every
-- sibling table (prod_sessions, bag_tags, prod_debagging, prod_bagging,
-- shift_assignments all already allow FT-CON).
-- ============================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'production.production_runs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%variant%'
  LOOP
    EXECUTE 'ALTER TABLE production.production_runs DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE production.production_runs
  ADD CONSTRAINT production_runs_variant_check
  CHECK (variant IN (
    'Conventional', 'Organic', 'RA-Conventional', 'RA-Organic', 'FT-ORG', 'FT-CON'
  ));
