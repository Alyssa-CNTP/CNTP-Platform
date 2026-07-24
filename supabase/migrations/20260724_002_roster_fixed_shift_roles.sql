-- ============================================================
-- Shift Roster — fixed-shift roles: Store Supervisor, Forklift Driver,
-- Refining 2, Value Added Product no longer auto-rotate day↔night.
-- Run in: Supabase SQL Editor (staging first, then production)
-- ============================================================
--
-- Corrects every CURRENT or FUTURE weekly roster_period (never past ones,
-- which are historical) to the fixed arrangement, so they stop showing
-- whatever the old unconditional rotation last swapped them to. Going
-- forward, lib/production/roster-rotate.ts (FIXED_SHIFT_ROLE_KEYS) keeps
-- these roles from flipping on every future rotation — this migration only
-- needs to fix periods that were already generated under the old
-- (always-flip) behaviour. Period ids are looked up by date rather than
-- hardcoded, so this file runs unmodified on any environment (staging,
-- production) regardless of how their period rows/ids differ.
-- ============================================================

-- Store Supervisor: always Bongikaya Ndikinda on day, Steven Paris on night.
UPDATE production.roster_entries
   SET shift = 'day'
 WHERE role_key = 'store_supervisor'
   AND person_name ILIKE '%bongikaya%'
   AND period_id IN (
     SELECT id FROM production.roster_periods WHERE kind = 'week' AND end_date >= CURRENT_DATE
   );

UPDATE production.roster_entries
   SET shift = 'night'
 WHERE role_key = 'store_supervisor'
   AND person_name ILIKE '%steven%'
   AND period_id IN (
     SELECT id FROM production.roster_periods WHERE kind = 'week' AND end_date >= CURRENT_DATE
   );

-- Refining 2 + Value Added Product: day-shift operators only, never night.
UPDATE production.roster_entries
   SET shift = 'day'
 WHERE role_key IN ('refining_2', 'rosehip')
   AND period_id IN (
     SELECT id FROM production.roster_periods WHERE kind = 'week' AND end_date >= CURRENT_DATE
   );

-- Forklift Driver: move Sibabalo Lindi + Nkosiphendule Vutza out of Store
-- Operator into their own fixed day-shift row. The rest of Store Operator is
-- untouched and keeps auto-rotating as before.
UPDATE production.roster_entries
   SET role_key = 'forklift_driver', shift = 'day', sort_order = 0
 WHERE role_key = 'store_operator'
   AND person_name ILIKE '%sibabalo%lindi%'
   AND period_id IN (
     SELECT id FROM production.roster_periods WHERE kind = 'week' AND end_date >= CURRENT_DATE
   );

UPDATE production.roster_entries
   SET role_key = 'forklift_driver', shift = 'day', sort_order = 1
 WHERE role_key = 'store_operator'
   AND person_name ILIKE '%nkosiphendule%vutza%'
   AND period_id IN (
     SELECT id FROM production.roster_periods WHERE kind = 'week' AND end_date >= CURRENT_DATE
   );
