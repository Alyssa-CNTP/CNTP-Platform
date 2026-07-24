-- ============================================================
-- Shift Roster — fixed-shift roles: Store Supervisor, Forklift Driver,
-- Refining 2, Value Added Product no longer auto-rotate day↔night.
-- Run in: Supabase SQL Editor (staging first, then production)
-- ============================================================
--
-- Corrects the two roster_periods that already exist as of 2026-07-24 (the
-- current week and the one already generated ahead of it) to the fixed
-- arrangement, so they stop showing whatever the old unconditional rotation
-- last swapped them to. Going forward, lib/production/roster-rotate.ts
-- (FIXED_SHIFT_ROLE_KEYS) keeps these roles from flipping on every future
-- rotation — this migration only needs to fix the two periods that were
-- already generated under the old (always-flip) behaviour.
-- ============================================================

-- Store Supervisor: always Bongikaya Ndikinda on day, Steven Paris on night.
UPDATE production.roster_entries
   SET shift = 'day'
 WHERE role_key = 'store_supervisor'
   AND person_name ILIKE '%bongikaya%'
   AND period_id IN ('7e5d7320-9b2e-4f70-a444-405bdead9ae2', '3674f3bd-67ac-4c54-94c4-57bdebb10e25');

UPDATE production.roster_entries
   SET shift = 'night'
 WHERE role_key = 'store_supervisor'
   AND person_name ILIKE '%steven%'
   AND period_id IN ('7e5d7320-9b2e-4f70-a444-405bdead9ae2', '3674f3bd-67ac-4c54-94c4-57bdebb10e25');

-- Refining 2 + Value Added Product: day-shift operators only, never night.
UPDATE production.roster_entries
   SET shift = 'day'
 WHERE role_key IN ('refining_2', 'rosehip')
   AND period_id IN ('7e5d7320-9b2e-4f70-a444-405bdead9ae2', '3674f3bd-67ac-4c54-94c4-57bdebb10e25');

-- Forklift Driver: move Sibabalo Lindi + Nkosiphendule Vutza out of Store
-- Operator into their own fixed day-shift row. The rest of Store Operator is
-- untouched and keeps auto-rotating as before.
UPDATE production.roster_entries
   SET role_key = 'forklift_driver', shift = 'day', sort_order = 0
 WHERE role_key = 'store_operator'
   AND person_name ILIKE '%sibabalo%lindi%'
   AND period_id IN ('7e5d7320-9b2e-4f70-a444-405bdead9ae2', '3674f3bd-67ac-4c54-94c4-57bdebb10e25');

UPDATE production.roster_entries
   SET role_key = 'forklift_driver', shift = 'day', sort_order = 1
 WHERE role_key = 'store_operator'
   AND person_name ILIKE '%nkosiphendule%vutza%'
   AND period_id IN ('7e5d7320-9b2e-4f70-a444-405bdead9ae2', '3674f3bd-67ac-4c54-94c4-57bdebb10e25');
