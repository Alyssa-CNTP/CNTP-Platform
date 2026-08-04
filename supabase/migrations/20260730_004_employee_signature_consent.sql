-- ============================================================
-- CNTP — Consent record on the Staff Directory signature-on-file
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260729_007_employee_signatures.sql (production.employee_signatures)
-- ============================================================
--
-- Drawing a signature and storing it on the platform needs the person's
-- explicit consent, recorded alongside the signature itself — not just
-- implied by the act of clicking Save. consent_text is a snapshot of the
-- exact wording shown at the moment of consent (not a live join to whatever
-- copy exists today), so a later wording change never rewrites history.
--
-- Existing signature-on-file rows (drawn before this migration existed)
-- keep consent_given_at = NULL — this is not backfilled/assumed. The app
-- treats NULL as "no consent recorded" and prompts for it on next redraw;
-- nobody is silently opted in.
--
-- set_by records who actually performed the write. Almost always the
-- employee themselves, but during initial platform setup senior_developer/
-- co_developer are temporarily allowed to set a signature on someone else's
-- behalf (a distinct, honestly-worded consent string is stored for that
-- case — see lib/production/employee-signature.ts) — set_by is what makes
-- that admin-assisted case traceable rather than indistinguishable from
-- self-service.
-- ============================================================

ALTER TABLE production.employee_signatures
  ADD COLUMN IF NOT EXISTS consent_given_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_text      text,
  ADD COLUMN IF NOT EXISTS set_by            uuid;
