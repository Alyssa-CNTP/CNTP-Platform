-- ============================================================
-- CNTP Production Capture — Pasteuriser job card generation + approval workflow
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: none (job_cards_pasteuriser already exists in public schema,
--             created ad hoc before this table was migration-tracked)
-- ============================================================
--
-- public.job_cards_pasteuriser has never had a migration file — it was
-- created directly in Supabase and already holds real, signed production
-- job cards. This migration is intentionally ADDITIVE ONLY: it never
-- redeclares the table's existing ~35 columns (see
-- app/(app)/job-cards/pasteuriser/page.tsx for the authoritative current
-- field list), only adds the new columns needed for BOM-driven generation
-- and the manager-generates/supervisor-approves workflow.
--
-- blend_ratio_lines / final_ratio_lines are JSONB line arrays
-- ([{componentItemId, label, pct}]) rather than more fixed columns, because
-- a BOM-generated card's ratio tables have a variable number of components
-- drawn from a large ingredient vocabulary -- they cannot be forced into the
-- form's existing 4+7 hardcoded pct fields. Those legacy fields are left
-- untouched and still used for any card created the old manual-entry way.
-- ============================================================

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
UPDATE public.job_cards_pasteuriser
  SET status = 'approved', approved_at = submitted_at
  WHERE submitted_at IS NOT NULL AND status = 'draft';
