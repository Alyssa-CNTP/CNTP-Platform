-- ============================================================
-- label_sign_offs.recorded_by — who keyed in an external approval.
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- Then:   NOTIFY pgrst, 'reload schema';
-- ============================================================
--
-- Two of the four template roles are not staff. The CUSTOMER signs by email and
-- the CERTIFIER signs on Control Union letterhead; somebody here then records
-- that it happened. `actor_name` is that outside party — correctly, because the
-- record must say who approved the label, not who typed it in.
--
-- Which leaves the second question unanswered: who typed it in. For an internal
-- sign-off the two are the same person and `actor_employee_id` covers it. For an
-- external one there was no column at all, so the trail stopped at "Control
-- Union approved this" with nothing saying on whose word.
--
-- That is the half of traceability FSSC actually asks about — not whether an
-- approval is claimed, but whether it can be traced to a person who stands
-- behind the claim. `external_ref` holds the evidence; this holds the hand.
--
-- Nullable, because for an internal sign-off it is the signer and duplicating
-- them buys nothing. The route fills it only when actor_employee_id is NULL.
-- ============================================================

ALTER TABLE public.label_sign_offs
  ADD COLUMN IF NOT EXISTS recorded_by_employee_id uuid
    REFERENCES production.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recorded_by_name text;

COMMENT ON COLUMN public.label_sign_offs.recorded_by_employee_id IS
  'Who entered an EXTERNAL approval (customer, certifier). NULL on an internal '
  'sign-off, where actor_employee_id already names the signer.';

COMMENT ON COLUMN public.label_sign_offs.recorded_by_name IS
  'Display name as at recording, so the trail survives an offboarding that '
  'nulls recorded_by_employee_id.';

-- An external sign-off must say who recorded it. Internal ones must not,
-- because there the signer IS the recorder and a second name invites the two to
-- drift apart.
--
-- NOT VALID: existing rows predate the column and cannot satisfy it. New writes
-- are checked from now on; the backfilled sales rows stay as they are rather
-- than being given a recorder nobody can name.
DO $$
BEGIN
  ALTER TABLE public.label_sign_offs
    ADD CONSTRAINT label_sign_offs_recorded_by_shape CHECK (
      (actor_employee_id IS NOT NULL AND recorded_by_employee_id IS NULL)
      OR
      (actor_employee_id IS NULL AND recorded_by_employee_id IS NOT NULL)
    ) NOT VALID;
EXCEPTION
  WHEN duplicate_table  THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Verify ──────────────────────────────────────────────────────────────────
--
--   SELECT role, actor_name, actor_employee_id, recorded_by_name
--   FROM public.label_sign_offs ORDER BY signed_at DESC LIMIT 20;
--
--   -- must ERROR (an external sign-off with nobody behind it):
--   INSERT INTO public.label_sign_offs
--     (scope, template_id, template_version, role, actor_name)
--   SELECT 'template', id, version, 'certifier', 'Control Union'
--   FROM public.label_templates LIMIT 1;
--
-- ⚠ THEN:  NOTIFY pgrst, 'reload schema';
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--
--   ALTER TABLE public.label_sign_offs
--     DROP CONSTRAINT IF EXISTS label_sign_offs_recorded_by_shape,
--     DROP COLUMN IF EXISTS recorded_by_employee_id,
--     DROP COLUMN IF EXISTS recorded_by_name;
