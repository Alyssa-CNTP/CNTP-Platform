-- ============================================================
-- Shift Roster — add a "Maintenance Manager" role row
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260622_001_roster.sql
-- ============================================================
--
-- The roster's Maintenance section only had two rows: Maintenance Tech and
-- Maintenance Assistant. Both role keys are the "on-duty technician" keys used
-- by lib/maintenance/roster.ts (MAINT_ROLE_KEYS) to auto-route urgent
-- breakdowns and to sync maintenance.duty_roster on publish. With no Manager
-- row, the maintenance manager (Shuaib Sentso) could only be placed under
-- "Maintenance Tech" — which made the system treat him as an on-duty technician
-- and eligible for breakdown auto-assignment, even though he is the manager and
-- logs in via SSO (not a PIN technician).
--
-- This adds a dedicated Maintenance Manager row (sorted above Tech). It is
-- deliberately NOT one of MAINT_ROLE_KEYS, so a person rostered here is shown
-- for visibility but is never auto-assigned a breakdown or synced as a duty tech.
-- ============================================================

INSERT INTO production.roster_roles (key, name, category, sort_order) VALUES
  ('maintenance_manager', 'Maintenance Manager', 'maintenance', 490)
ON CONFLICT (key) DO NOTHING;

-- Move any existing roster entries for Shuaib that were placed under the tech /
-- assistant rows onto the new Manager row, so he stops being treated as an
-- on-duty technician. Name-matched (entries are denormalised to person_name);
-- idempotent and safe to re-run.
UPDATE production.roster_entries
   SET role_key = 'maintenance_manager'
 WHERE role_key IN ('maintenance_tech', 'maintenance_asst')
   AND person_name ILIKE '%shuaib%';
