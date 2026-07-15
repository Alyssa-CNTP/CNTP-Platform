-- ============================================================
-- CNTP Production Capture — production_ref (traceability groundwork)
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260611_001_production_capture.sql (prod_debagging, prod_bagging)
-- ============================================================
-- A shift can run several blends (or, elsewhere, several batch records) inside
-- one session — until now, which specific production/blend a debagging or
-- bagging row belonged to was only recorded as free text inside `notes`
-- (e.g. "blend 25CH60C40WBC"), not a real column. That makes it unreliable to
-- query "which input bags fed this specific blend run" — exactly the
-- traceability chain that needs to hold up back to Sieving Tower's batch
-- numbers. `production_ref` is that discriminator as a real column (a blend
-- code today; any section with multiple productions per session can adopt it
-- the same way later). Nullable — sections with only one production per
-- session leave it null, unaffected.
-- ============================================================

ALTER TABLE production.prod_debagging
  ADD COLUMN IF NOT EXISTS production_ref text;
ALTER TABLE production.prod_bagging
  ADD COLUMN IF NOT EXISTS production_ref text;

CREATE INDEX IF NOT EXISTS prod_debagging_production_ref_idx
  ON production.prod_debagging(production_ref) WHERE production_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS prod_bagging_production_ref_idx
  ON production.prod_bagging(production_ref) WHERE production_ref IS NOT NULL;
