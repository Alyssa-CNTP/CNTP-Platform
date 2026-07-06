-- ============================================================
-- CNTP Shift Roster — per-section submission tracking
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260622_001_roster.sql (production.roster_periods, set_updated_at)
-- ============================================================
--
-- Each roster period has 6 sections (production, store, qc, cleaning,
-- maintenance, hs). Each section is owned by the people who hold the
-- can_submit_roster_<section> permission; they sign it off ("submit") for the
-- period, latest by Wednesday. This table records that submission state so the
-- UI can show Draft / Submitted, and the reminder cron can email whoever has
-- NOT yet submitted their section.
-- ============================================================

CREATE TABLE IF NOT EXISTS production.roster_section_status (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id     uuid        NOT NULL REFERENCES production.roster_periods(id) ON DELETE CASCADE,
  section       text        NOT NULL,   -- production | store | qc | cleaning | maintenance | hs
  status        text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, section)
);

CREATE INDEX IF NOT EXISTS roster_section_status_period_idx
  ON production.roster_section_status(period_id);

-- updated_at trigger (reuse the shared function from migration 001)
DROP TRIGGER IF EXISTS roster_section_status_updated_at ON production.roster_section_status;
CREATE TRIGGER roster_section_status_updated_at
  BEFORE UPDATE ON production.roster_section_status
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

-- Row Level Security — matches the sibling roster tables (app enforces per-section
-- capability via the permission toggles; RLS stays open to authenticated users).
ALTER TABLE production.roster_section_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_roster_section_status" ON production.roster_section_status;
CREATE POLICY "authenticated_all_roster_section_status"
  ON production.roster_section_status FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Submitter lookup for the reminder cron ────────────────────────────────────
-- The reminder job runs unattended (service_role, no user session), but
-- service_role has no PostgREST access to the `shared` schema. This
-- SECURITY DEFINER function in the exposed `public` schema returns the minimal
-- columns so the cron can resolve — in application code — who holds each
-- section's can_submit_roster_<section> permission. No permission logic lives
-- in SQL; the TS resolver (lib/auth/permissions.ts) remains the single source.
CREATE OR REPLACE FUNCTION public.roster_submitter_candidates()
RETURNS TABLE (user_id uuid, role text, permissions jsonb, is_active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = shared, public
AS $$
  SELECT user_id, role, permissions, is_active FROM shared.app_roles;
$$;

REVOKE ALL ON FUNCTION public.roster_submitter_candidates() FROM public;
GRANT EXECUTE ON FUNCTION public.roster_submitter_candidates() TO service_role, authenticated;
