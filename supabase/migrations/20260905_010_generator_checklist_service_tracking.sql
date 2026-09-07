-- Weekly Generator / Diesel checklist, checklist allocation by user id, and
-- run-hour service scheduling for the compressor and generator.
-- APPLIED TO STAGING. Production needs this before promotion.

-- 1. Only the two readings that are actually captured; the other three lines
--    were prompts, not measurements.
update maintenance.checklist_templates
  set tasks = '["Generator run hours", "Generator fuel level"]'::jsonb
  where frequency='weekly' and area='Generator / Diesel';

-- 2. Checklist allocation was matched on the technician's NAME, which silently
--    failed whenever the roster spelling and the person's profile name differed,
--    so an allocated checklist never appeared on their screen. Record the id too.
alter table maintenance.checklist_completions
  add column if not exists assigned_user_id uuid;

-- 3. A service interval can be hours-based, days-based, or BOTH (whichever falls
--    first). The generator is 500 hours OR 12 months.
alter table maintenance.equipment_config
  add column if not exists service_interval_days integer;

-- 4. The compressor is serviced every 2000 running hours (was wrongly set to 350).
update maintenance.equipment_config
  set service_interval_hours = 2000
  where equipment = '500L Factory Compressor';

-- 5. The generator was never in the run-hours register at all. hours_per_workday
--    is the projection rate used to turn "hours remaining" into a due DATE; the
--    generator only runs during outages, hence the low figure.
insert into maintenance.equipment_config (equipment, service_interval_hours, hours_per_workday, active)
select 'Generator GKSD-440', 500, 0.5, true
where not exists (select 1 from maintenance.equipment_config where equipment = 'Generator GKSD-440');

update maintenance.equipment_config set service_interval_days = 365
  where equipment = 'Generator GKSD-440';
