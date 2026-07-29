-- ============================================================
-- CNTP Production Capture — job card packaging auto-calc, auto-numbering,
-- and per blend+customer settings memory
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260729_002_job_cards_pasteuriser_workflow.sql
-- ============================================================
--
-- Packaging for a Pasteuriser finished good is predefined in its own BOM —
-- the packaging component lines (uom = 'PCS') already encode "1 unit per
-- N kg" via qty_required (e.g. 0.055556 = 1 bag per 18kg). So once a BOM is
-- picked, the packaging type + weight-per-unit is known; the production
-- manager just confirms it rather than typing it, and No. of bags is
-- computed live from Total mass. packaging_item_id/packaging_lines carry
-- that through to the saved record so packaging usage is auditable against
-- the PO, per Acumatica code — not just a free-text label.
--
-- job_card_settings_templates is deliberately in the PUBLIC schema, next to
-- job_cards_pasteuriser (not production) -- it's a config/memory layer for
-- the digital job-card workflow itself (which blend+customer combination
-- uses which plant settings/instructions), not a physical-production record.
-- ============================================================

ALTER TABLE public.job_cards_pasteuriser
  ADD COLUMN IF NOT EXISTS packaging_item_id text,   -- soft ref -> production.bom_components.component_item_id (the packaging line actually used)
  ADD COLUMN IF NOT EXISTS packaging_lines jsonb;    -- every packaging option the BOM offered: [{componentItemId, label, kgPerUnit}]

-- ── Auto job card numbering ──────────────────────────────────────────────────
-- Atomic, gap-tolerant sequence so concurrent managers never collide. Format
-- is CNTP's own audit-trail number (JC-<year>-<seq>) -- deliberately NOT an
-- attempt to reproduce Acumatica's own production-order numbering scheme
-- (the paper examples' 5-digit codes), since that format isn't confirmed and
-- a wrong guess would look like a real Acumatica number when it isn't one.
CREATE SEQUENCE IF NOT EXISTS public.job_card_no_seq;

CREATE OR REPLACE FUNCTION public.next_job_card_no()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'JC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.job_card_no_seq')::text, 4, '0');
$$;

GRANT USAGE, SELECT ON SEQUENCE public.job_card_no_seq TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_job_card_no() TO authenticated, service_role;

-- ── Blend + customer settings memory ─────────────────────────────────────────
-- Plant settings and special/re-work instructions the manager only wants to
-- type once per (item, customer) combination; looked up and prefilled on
-- every later job card for the same pair, still editable/overridable per run.
CREATE TABLE IF NOT EXISTS public.job_card_settings_templates (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_no                       text NOT NULL,   -- normalized (upper-cased) Acumatica code, matches job_cards_pasteuriser.item_no
  customer                      text NOT NULL,   -- normalized (trimmed) customer name
  debagging_hopper_inverter     text,
  debagging_hopper_manual       text,
  steriliser_inverter           text,
  post_sieve_plate_size         text,
  product_temp_at_pasteuriser   text,
  special_instructions          text,
  rework_material               text,
  updated_by                    uuid,
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_card_settings_templates_item_customer_idx
  ON public.job_card_settings_templates (item_no, customer);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS job_card_settings_templates_updated_at ON public.job_card_settings_templates;
CREATE TRIGGER job_card_settings_templates_updated_at
  BEFORE UPDATE ON public.job_card_settings_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.job_card_settings_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_job_card_settings_templates" ON public.job_card_settings_templates;
CREATE POLICY "authenticated_all_job_card_settings_templates"
  ON public.job_card_settings_templates FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON public.job_card_settings_templates TO authenticated, service_role;
