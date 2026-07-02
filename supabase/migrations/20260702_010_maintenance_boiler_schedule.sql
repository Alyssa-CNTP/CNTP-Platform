-- 20260702_010_maintenance_boiler_schedule.sql
-- Boiler startup schedule — a compact, forward-looking weekly roster of which
-- technician is on boiler startup. One row per week (SAST Monday). Editable for
-- the current and future weeks from the maintenance planner.
--
-- Follows the maintenance-schema convention (grants, RLS off) used by area_qc.

create table if not exists maintenance.boiler_schedule (
  id                  bigint generated always as identity primary key,
  week_start          date not null unique,   -- Monday of the week (SAST)
  technician          text not null default '',
  technician_user_id  uuid,
  updated_by          text,
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

grant select on maintenance.boiler_schedule to anon;
grant select, insert, update, delete on maintenance.boiler_schedule to authenticated;
grant select, insert, update, delete on maintenance.boiler_schedule to service_role;
