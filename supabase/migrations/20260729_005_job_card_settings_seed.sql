-- ============================================================
-- CNTP Production Capture — seed known plant settings / special instructions
-- from the two paper Pasteuriser job cards already reviewed this session
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260729_003_job_card_packaging_numbering_templates.sql
-- ============================================================
--
-- Pre-fills job_card_settings_templates for the two (item, customer) pairs
-- already on hand, so the next job card generated for either doesn't need
-- these typed in by hand even once. Values transcribed directly off the
-- paper cards (PR-FM-013/1).
-- ============================================================

INSERT INTO public.job_card_settings_templates
  (item_no, customer, debagging_hopper_inverter, debagging_hopper_manual, steriliser_inverter, post_sieve_plate_size, product_temp_at_pasteuriser, special_instructions, rework_material)
VALUES
  ('30FPSG-NAT26-1-C', 'Entyce', NULL, '8,00', NULL, '3mm', '>85°C',
   'Bulk density: 280-300cc/100g' || chr(10) ||
   'Granule line moisture 9.2%' || chr(10) ||
   'Final Product Moisture 9.2%' || chr(10) ||
   'Dust less than 0.6%' || chr(10) ||
   'Packaged only in 500kg bulk bags, open duffel top',
   NULL),
  ('30FPSFC-KUN25-C', 'Kunitaro', 'auto', '8,00', '100%', '3mm', '>85°C',
   'Over runs must be blended, according to lab recommendation.' || chr(10) ||
   'Use Diamond Blender to blend all shades.',
   NULL)
ON CONFLICT (item_no, customer) DO UPDATE SET
  debagging_hopper_inverter   = excluded.debagging_hopper_inverter,
  debagging_hopper_manual     = excluded.debagging_hopper_manual,
  steriliser_inverter         = excluded.steriliser_inverter,
  post_sieve_plate_size       = excluded.post_sieve_plate_size,
  product_temp_at_pasteuriser = excluded.product_temp_at_pasteuriser,
  special_instructions        = excluded.special_instructions,
  rework_material             = excluded.rework_material,
  updated_at                  = now();
