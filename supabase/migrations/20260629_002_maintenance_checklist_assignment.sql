-- 20260629_002_maintenance_checklist_assignment.sql
-- Checklist allocation — additive, non-destructive.
--
-- A maintenance manager can allocate a weekly / monthly checklist (one row per
-- template + period in checklist_completions) to a technician. The technician
-- then sees the checklists assigned to them.
--
--  • assigned_to — technician the checklist is allocated to
--  • assigned_by — who allocated it (manager)
--  • assigned_at — when it was allocated

ALTER TABLE maintenance.checklist_completions
  ADD COLUMN IF NOT EXISTS assigned_to text,
  ADD COLUMN IF NOT EXISTS assigned_by text,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
