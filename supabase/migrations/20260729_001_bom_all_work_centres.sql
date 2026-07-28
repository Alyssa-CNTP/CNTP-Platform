-- ============================================================
-- CNTP Production Capture — widen BOM catalogue to all work centres
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260713_001_blender_bom.sql (production.bom_components)
-- ============================================================
--
-- production.bom_components was originally scoped to Blender BOMs only
-- (work_centre CHECK allowed just the two Blender work centres). The
-- customer's full Acumatica BOM export covers every work centre in the
-- plant, and the Pasteuriser finished-product BOMs (the "30FP..." codes)
-- specifically have nowhere to live under the old constraint. This widens
-- the CHECK to the full set of real Acumatica work-centre values found in
-- that export, verbatim (including '21-CHEMICAL TREATMEN', which is
-- truncated in Acumatica's own master data — stored as-is, not "corrected",
-- so it byte-for-byte matches any future cross-reference against Acumatica).
--
-- Blender capture (lib/production/bom.ts's listBlenderBoms/getBlendComponents)
-- is unaffected — it already filters explicitly by work_centre and keeps
-- doing so. This migration only removes a blocker for rows that were never
-- storable before.
-- ============================================================

ALTER TABLE production.bom_components DROP CONSTRAINT IF EXISTS bom_components_work_centre_check;
ALTER TABLE production.bom_components ADD CONSTRAINT bom_components_work_centre_check
  CHECK (work_centre IN (
    '01-SIEVING',
    '02-REFINING1',
    '03-REFINING2',
    '04-GRANULATION',
    '05-BLENDER BIG',
    '05-BLENDER SMALL',
    '06-PASTEURISING',
    '08-PACKING',
    '12RHHAMMER',
    '15-RHBLENDING',
    '20-SCARIFICATION',
    '21-CHEMICAL TREATMEN'
  ));
