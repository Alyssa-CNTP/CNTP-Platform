-- ============================================================
-- CNTP Production Capture — Granule job card generation + approval workflow
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: none (mirrors 20260729_002_job_cards_pasteuriser_workflow.sql)
-- ============================================================
--
-- public.job_cards_granule already exists ad hoc (created directly in the
-- Supabase dashboard, pre-dating this table being migration-tracked) backing
-- a flat manual-entry form at app/(app)/job-cards/granule/page.tsx. This
-- creates the full original table with `IF NOT EXISTS` first (a no-op
-- wherever it's already there, reproducing that page's original field list),
-- THEN adds the new workflow columns via ADD COLUMN IF NOT EXISTS either way.
-- Safe to (re-)run in any environment regardless of whether the table
-- pre-existed.
--
-- blend_ratio_lines is a JSONB line array ([{componentItemId, label, pct}]),
-- same reasoning as Pasteuriser's: a BOM-generated card draws from a variable
-- ingredient vocabulary that can't be forced into the form's original 11
-- hardcoded dust columns. Those legacy columns are kept and still used for
-- any card created the old manual-entry way. Unlike Pasteuriser, Granule has
-- no second "final product" ratio stage — its dust blend IS the final
-- product — so there is no final_ratio_lines column here.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.job_cards_granule (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer                       text,
  date_of_card                   date,
  expected_commencement          date,
  job_card_no                    text,
  item_no                        text,
  brown_dust                     text,
  white_dust                     text,
  alt                            text,
  milled_material                text,
  leaf_dust                      text,
  oq_dust                        text,
  powder_dust                    text,
  is_dust                        text,
  ss_dust                        text,
  brown_powder_dust              text,
  khoisan_dust                   text,
  product_name                   text,
  total_mass                     text,
  mass_per_bag_bin               text,
  no_of_bags                     text,
  packaging                      text,
  batch_number                   text,
  bag_markings                   text,
  local_or_export                text,
  palletised                     text,
  special_instructions           text,
  sig_production_supervisor      text,
  sig_quality_officer             text,
  sig_production_manager         text,
  submitted_at                   timestamptz,
  created_at                     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_cards_granule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_job_cards_granule" ON public.job_cards_granule;
CREATE POLICY "authenticated_all_job_cards_granule"
  ON public.job_cards_granule FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON public.job_cards_granule TO authenticated, service_role;

-- ── Workflow columns (additive, safe whether the table above was just
--    created or already existed with these missing) ─────────────────────────
ALTER TABLE public.job_cards_granule
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent_for_approval', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS bom_output_item_id text,   -- soft ref -> production.bom_components.output_item_id (no hard FK, same convention as that table)
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS sent_for_approval_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_reason text,
  ADD COLUMN IF NOT EXISTS blend_ratio_lines jsonb,
  ADD COLUMN IF NOT EXISTS quality_signed_by uuid,
  ADD COLUMN IF NOT EXISTS quality_signed_at timestamptz;

-- Backfill: any row that already has submitted_at set predates this workflow
-- entirely -- paper/digital sign-off already happened for it, so treat it as
-- implicitly approved rather than surfacing it in a new pending-approval queue.
-- (No-op on a freshly created, empty table.)
UPDATE public.job_cards_granule
  SET status = 'approved', approved_at = submitted_at
  WHERE submitted_at IS NOT NULL AND status = 'draft';
