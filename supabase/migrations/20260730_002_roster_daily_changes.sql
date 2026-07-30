-- ============================================================
-- CNTP Shift Roster — day-to-day changes after the roster is published
-- Run in: Supabase SQL Editor — STAGING (qjqkpockmujecjgmdple) AND
--         PRODUCTION (sxzjjcyuzyfneesnsjna).
-- Depends on: 20260622_001_roster.sql, 20260706_003_roster_section_status.sql
-- ============================================================
--
-- The roster was built as a fortnightly document: draft it, submit it, done. The
-- floor doesn't work that way — people swap lines, call in sick and get moved
-- mid-period, and until now a submitted roster was simply locked, so those real
-- changes were made verbally and the published roster quietly went stale.
--
-- Two changes make the roster the live record it actually needs to be:
--
--   1. A third status, 'changes_pending'. A supervisor can edit and save a
--      SUBMITTED roster; doing so does not silently reopen it as a draft (which
--      would erase the fact it had been signed off) — it moves to
--      changes_pending, which reads as "published, with edits waiting for the
--      Production Manager to re-confirm".
--
--   2. production.roster_change_log — one row per person added, removed or
--      moved between shifts, with who did it and when. This is what makes a
--      post-publish change auditable instead of a diff nobody can reconstruct,
--      and it is what the Production Manager reads to see exactly what changed
--      rather than re-checking the whole grid.
-- ============================================================

-- ── 1. Allow the third status ────────────────────────────────
ALTER TABLE production.roster_section_status
  DROP CONSTRAINT IF EXISTS roster_section_status_status_check;

ALTER TABLE production.roster_section_status
  ADD CONSTRAINT roster_section_status_status_check
  CHECK (status IN ('draft', 'submitted', 'changes_pending'));


-- ── 2. Change log ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production.roster_change_log (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id      uuid        NOT NULL REFERENCES production.roster_periods(id) ON DELETE CASCADE,
  section        text        NOT NULL,   -- production | store | qc | cleaning | maintenance | hs

  change_type    text        NOT NULL CHECK (change_type IN ('added','removed','moved')),
  role_key       text,
  shift          text,                    -- the shift the person ended up on
  previous_shift text,                    -- set for 'moved'
  person_name    text        NOT NULL,
  employee_id    uuid,

  -- Was the roster already published when this change was made? A change to a
  -- draft is just editing; a change to a submitted roster is the thing the
  -- Production Manager needs to see.
  after_publish  boolean     NOT NULL DEFAULT false,
  note           text,

  actor_id       uuid        REFERENCES auth.users(id),
  actor_name     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS roster_change_log_period_idx
  ON production.roster_change_log(period_id, created_at DESC);
CREATE INDEX IF NOT EXISTS roster_change_log_section_idx
  ON production.roster_change_log(section, created_at DESC);

GRANT ALL ON production.roster_change_log TO authenticated, service_role;

ALTER TABLE production.roster_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_roster_change_log" ON production.roster_change_log;
CREATE POLICY "authenticated_all_roster_change_log"
  ON production.roster_change_log FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
