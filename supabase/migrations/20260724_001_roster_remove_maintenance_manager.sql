-- ============================================================
-- Shift Roster — remove the "Maintenance Manager" role row
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260717_001_roster_maintenance_manager.sql
-- ============================================================
--
-- Reverses 20260717_001: the roster no longer tracks a Maintenance Manager
-- row at all. Deactivate rather than delete the roster_roles row (keeps
-- history / avoids an FK surprise if anything still references the key),
-- and drop any roster_entries that were placed under it so the Maintenance
-- section grid doesn't carry a stray, invisible entry.
-- ============================================================

DELETE FROM production.roster_entries WHERE role_key = 'maintenance_manager';

UPDATE production.roster_roles
   SET active = false
 WHERE key = 'maintenance_manager';
