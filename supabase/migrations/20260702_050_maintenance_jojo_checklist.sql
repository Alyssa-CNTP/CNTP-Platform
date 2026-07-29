-- 20260702_050_maintenance_jojo_checklist.sql
-- JoJo Tanks water checklist — a new WEEKLY checklist. Two percentage readings
-- (Tank 1 / Tank 2) that the UI averages. Stored like any checklist: the two
-- values live in the task notes; the average is computed for display.
-- Idempotent (guarded by area); id is GENERATED ALWAYS so it is not specified.
-- (Applied to the staging DB.)

insert into maintenance.checklist_templates (frequency, area, doc_ref, tasks, sort_order, active)
select 'weekly', 'JoJo Tanks Water', 'QM-FM-JOJO/0',
  '["Tank 1 water level (%)","Tank 2 water level (%)"]'::jsonb, 7, true
where not exists (select 1 from maintenance.checklist_templates where area = 'JoJo Tanks Water');
