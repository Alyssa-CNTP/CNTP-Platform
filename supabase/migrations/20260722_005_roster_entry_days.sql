-- ============================================================
-- CNTP Shift Roster — per-person working days
-- Run in: Supabase SQL Editor — STAGING (qjqkpockmujecjgmdple) AND
--         PRODUCTION (sxzjjcyuzyfneesnsjna).
-- Depends on: 20260622_001_roster.sql (production.roster_entries)
-- ============================================================
--
-- Each rostered person can optionally work only some weekdays. Defaults to the
-- full working week (Mon–Fri) so existing rows and the common case are
-- unchanged — a supervisor only touches the day-picker for the rare partial
-- week. The production-manager approval notification reads these to say exactly
-- which days a change affects.
-- ============================================================

ALTER TABLE production.roster_entries
  ADD COLUMN IF NOT EXISTS days text[] NOT NULL
  DEFAULT ARRAY['mon','tue','wed','thu','fri']::text[];
