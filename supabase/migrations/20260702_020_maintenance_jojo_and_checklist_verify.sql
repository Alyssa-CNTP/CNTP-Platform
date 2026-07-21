-- 20260702_020_maintenance_jojo_and_checklist_verify.sql
-- NOTE: NOT yet applied to the staging DB — left for review (this work connects to
-- the shift-roster domain and is on a branch for Alyssa to review before deploy).
--
--  1. JoJo Tanks water checklist — a new WEEKLY checklist. Two percentage readings
--     (Tank 1 / Tank 2) that the UI averages. Stored like any checklist: the two
--     values live in the task notes; the average is computed for display.
--  2. Monthly checklist verification — a technician sends a completed monthly
--     checklist to the maintenance manager, who marks it verified. Adds the
--     submitted/verified stamp columns to checklist_completions.

insert into maintenance.checklist_templates (id, frequency, area, doc_ref, tasks, sort_order, active)
values (25, 'weekly', 'JoJo Tanks Water', 'QM-FM-JOJO/0',
  '["Tank 1 water level (%)","Tank 2 water level (%)"]'::jsonb, 7, true)
on conflict (id) do nothing;

alter table maintenance.checklist_completions
  add column if not exists submitted_at timestamptz,   -- tech sent it to the manager
  add column if not exists submitted_by text,
  add column if not exists verified_at  timestamptz,   -- manager verified
  add column if not exists verified_by  text;
