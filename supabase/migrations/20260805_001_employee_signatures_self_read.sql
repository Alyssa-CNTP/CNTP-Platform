-- ============================================================
-- CNTP — Lock signature-on-file reads to the owner only
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260729_007_employee_signatures.sql (production.employee_signatures)
-- ============================================================
--
-- production.employee_signatures had `FOR SELECT TO authenticated USING (true)`
-- — any authenticated user could read ANY employee's signature image directly,
-- not just via the Staff Directory page (which rendered it as an <img> for
-- whatever profile was open) but via a raw client-side query bypassing the UI
-- entirely. A signature that anyone can view/screenshot is a signature anyone
-- can forge with — this closes that at the data layer, not just in the UI.
--
-- Mirrors resolveEmployeeId() (lib/auth/server-helpers.ts): auth.uid() ->
-- shared.app_roles.user_id -> shared.app_roles.employee_id. Service-role reads
-- (every "Verify & Sign" flow) are unaffected — RLS doesn't apply to service_role.
-- ============================================================

DROP POLICY IF EXISTS "authenticated_read_employee_signatures" ON production.employee_signatures;
CREATE POLICY "self_read_employee_signatures"
  ON production.employee_signatures FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT ar.employee_id FROM shared.app_roles ar WHERE ar.user_id = auth.uid())
  );
