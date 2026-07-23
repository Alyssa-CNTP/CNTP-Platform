-- ============================================================
-- CNTP Shift Roster — manual Saturday roster
-- Run in: Supabase SQL Editor — STAGING (qjqkpockmujecjgmdple) AND
--         PRODUCTION (sxzjjcyuzyfneesnsjna).
-- Depends on: 20260622_001_roster.sql (production.roster_periods)
-- ============================================================
--
-- The Saturday roster is a lightweight, fully MANUAL sheet — it does NOT
-- rotate and is NOT touched by the auto-rotate cron. A supervisor/admin picks
-- the Saturday date + shift time and adds names by role, then saves/submits per
-- section exactly like the weekday roster. It reuses roster_entries and
-- roster_section_status unchanged; the only schema change is a `kind` flag on
-- roster_periods so the UI can keep the two lists apart.
--
--   kind = 'week'     → the normal Mon–Fri, day/night, auto-rotated period
--   kind = 'saturday' → a single-shift manual Saturday sheet (start_date =
--                       end_date = that Saturday; day_label holds the chosen
--                       time range, e.g. '07h00 – 13h00'; night unused)
-- ============================================================

ALTER TABLE production.roster_periods
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'week';

-- Any period that predates this column is a normal weekly period.
UPDATE production.roster_periods SET kind = 'week' WHERE kind IS NULL;

ALTER TABLE production.roster_periods
  DROP CONSTRAINT IF EXISTS roster_periods_kind_chk;
ALTER TABLE production.roster_periods
  ADD CONSTRAINT roster_periods_kind_chk CHECK (kind IN ('week','saturday'));

CREATE INDEX IF NOT EXISTS roster_periods_kind_idx
  ON production.roster_periods(kind, start_date DESC);
