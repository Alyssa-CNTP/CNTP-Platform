-- ============================================================
-- CNTP Production Capture — signatures live on the Staff Directory record,
-- verified server-side, not drawn by hand on every job card
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260623_001_staff_directory.sql (production.employees),
--             20260709_001_people_links.sql (shared.app_roles.employee_id)
-- ============================================================
--
-- Supersedes public.user_signatures (created last session, keyed on the raw
-- auth user id with fully-open RLS — any authenticated user could read/write
-- ANY other user's signature row via the client). Replaced with a table keyed
-- on production.employees.id (the Staff Directory record, "front door for
-- people") and RLS that only allows reads client-side — every write goes
-- through a server route that resolves the caller's own employee_id via
-- shared.app_roles first, so a signature can only ever be set by the person
-- it belongs to (or someone with can_edit_staff_profiles, e.g. HR onboarding).
-- ============================================================

DROP TABLE IF EXISTS public.user_signatures;

CREATE TABLE IF NOT EXISTS production.employee_signatures (
  employee_id  uuid PRIMARY KEY REFERENCES production.employees(id) ON DELETE CASCADE,
  signature    text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS employee_signatures_updated_at ON production.employee_signatures;
CREATE TRIGGER employee_signatures_updated_at
  BEFORE UPDATE ON production.employee_signatures
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

ALTER TABLE production.employee_signatures ENABLE ROW LEVEL SECURITY;

-- Read-only for the client (needed to display/print a signature already on
-- file); every write goes through a server route using the service-role key.
DROP POLICY IF EXISTS "authenticated_read_employee_signatures" ON production.employee_signatures;
CREATE POLICY "authenticated_read_employee_signatures"
  ON production.employee_signatures FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON production.employee_signatures TO authenticated;
GRANT ALL ON production.employee_signatures TO service_role;

-- ── Quality sign-off attestation (Manager already has created_by/
--    sent_for_approval_at, Supervisor already has approved_by/approved_at —
--    Quality had no equivalent "who + when" pair until now) ──────────────────
ALTER TABLE public.job_cards_pasteuriser
  ADD COLUMN IF NOT EXISTS quality_signed_by uuid,
  ADD COLUMN IF NOT EXISTS quality_signed_at timestamptz;
