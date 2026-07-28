-- ============================================================
-- CNTP Shift Roster — pin an individual to their shift
-- Run in: Supabase SQL Editor — STAGING (qjqkpockmujecjgmdple) AND
--         PRODUCTION (sxzjjcyuzyfneesnsjna).
-- Depends on: 20260622_001_roster.sql (production.roster_entries)
-- ============================================================
--
-- A pinned entry keeps its current shift through the weekly day↔night rotation
-- ("pin" it like a chat) — everyone else still rotates as normal, and the pin
-- carries forward to each new week. This replaces the hardcoded person lists in
-- lib/production/roster-rotate.ts (store_supervisor / forklift_driver) with a
-- per-person flag set right on the roster. (The genuinely day-only ROLES —
-- refining_2, rosehip — stay role-level in code.)
-- ============================================================

ALTER TABLE production.roster_entries
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

-- Preserve today's behaviour + make it visible: the store-supervisor and
-- forklift-driver people were previously fixed in code. Pin their existing
-- entries so they stay put and now show as pinned in the UI.
UPDATE production.roster_entries
SET    pinned = true
WHERE  role_key IN ('store_supervisor', 'forklift_driver')
  AND  pinned = false;
