-- ============================================================
-- CNTP Production Capture — Pasteuriser job card generation + approval workflow
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: none
-- ============================================================
--
-- public.job_cards_pasteuriser was assumed to already exist (created ad hoc,
-- pre-dating this table being migration-tracked) -- confirmed WRONG when this
-- migration was first run (42P01: relation does not exist). It may exist in
-- one environment and not another, so this now creates the full original
-- table with `IF NOT EXISTS` first (a no-op wherever it's already there,
-- exactly reproducing app/(app)/job-cards/pasteuriser/page.tsx's original
-- field list before this session's workflow columns), THEN adds the new
-- workflow columns via ADD COLUMN IF NOT EXISTS either way. Safe to (re-)run
-- in any environment regardless of whether the table pre-existed.
--
-- blend_ratio_lines / final_ratio_lines are JSONB line arrays
-- ([{componentItemId, label, pct}]) rather than more fixed columns, because
-- a BOM-generated card's ratio tables have a variable number of components
-- drawn from a large ingredient vocabulary -- they cannot be forced into the
-- form's original 4+7 hardcoded pct fields. Those legacy fields are kept and
-- still used for any card created the old manual-entry way.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.job_cards_pasteuriser (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer                       text,
  date_of_card                   date,
  expected_commencement          date,
  job_card_no                    text,
  item_no                        text,
  blend_description              text,
  fine_leaf_export_a_kg          text,
  fine_leaf_export_a_pct         text,
  fine_leaf_blend_b_kg           text,
  fine_leaf_blend_b_pct          text,
  cut_block_kg                   text,
  cut_block_pct                  text,
  clean_block_kg                 text,
  clean_block_pct                text,
  total_blend_size               text,
  fp_fine_leaf_export_a_pct      text,
  fp_fine_leaf_blend_b_pct       text,
  fp_sg_granules_pct             text,
  fp_cut_coarse_leaf_a_pct       text,
  fp_cut_coarse_leaf_b_pct       text,
  fp_cut_coarse_leaf_c_pct       text,
  fp_fine_granule_pct            text,
  product_name                   text,
  total_mass                     text,
  weight_per_bulk_bag            text,
  no_of_bags                     text,
  packaging                      text,
  batch_number                   text,
  customer_po                    text,
  bag_markings                   text,
  local_or_export                text,
  palletised                     text,
  debagging_hopper_inverter      text,
  debagging_hopper_manual        text,
  steriliser_inverter            text,
  post_sieve_plate_size          text,
  product_temp_at_pasteuriser    text,
  special_instructions           text,
  rework_material                text,
  sig_production_coordinator     text,
  sig_production_supervisor      text,
  sig_quality_officer            text,
  sig_production_manager         text,
  submitted_at                   timestamptz,
  created_at                     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_cards_pasteuriser ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_job_cards_pasteuriser" ON public.job_cards_pasteuriser;
CREATE POLICY "authenticated_all_job_cards_pasteuriser"
  ON public.job_cards_pasteuriser FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON public.job_cards_pasteuriser TO authenticated, service_role;

-- ── This session's workflow columns (additive, safe whether the table above
--    was just created or already existed with these missing) ───────────────
ALTER TABLE public.job_cards_pasteuriser
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent_for_approval', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS bom_output_item_id text,   -- soft ref -> production.bom_components.output_item_id (no hard FK, same convention as that table)
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS sent_for_approval_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_reason text,
  ADD COLUMN IF NOT EXISTS blend_ratio_lines jsonb,
  ADD COLUMN IF NOT EXISTS final_ratio_lines jsonb;

-- Backfill: any row that already has submitted_at set predates this workflow
-- entirely -- paper/digital sign-off already happened for it, so treat it as
-- implicitly approved rather than surfacing it in a new pending-approval queue.
-- (No-op on a freshly created, empty table.)
UPDATE public.job_cards_pasteuriser
  SET status = 'approved', approved_at = submitted_at
  WHERE submitted_at IS NOT NULL AND status = 'draft';
