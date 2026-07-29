-- ============================================================
-- CNTP Shift Roster — retire the Forklift Driver role
-- Run in: Supabase SQL Editor — STAGING (qjqkpockmujecjgmdple) AND
--         PRODUCTION (sxzjjcyuzyfneesnsjna).
-- Depends on: 20260729_004_roster_entry_pinned.sql (roster_entries.pinned)
-- ============================================================
--
-- Forklift drivers are Store Operators who happen to stay on day shift. Rather
-- than a separate "Forklift Driver" role, move those people into Store Operator
-- and PIN them to day (so they stay put through the weekly rotation), then
-- retire the standalone role. Idempotent.
-- ============================================================

-- Move every forklift-driver placement into Store Operator, on day, pinned.
UPDATE production.roster_entries
SET    role_key = 'store_operator',
       shift    = 'day',
       pinned   = true
WHERE  role_key = 'forklift_driver';

-- Retire the standalone role (kept as inactive rather than deleted so any
-- loose references stay valid; the roster only lists active roles).
UPDATE production.roster_roles
SET    active = false
WHERE  key = 'forklift_driver';
