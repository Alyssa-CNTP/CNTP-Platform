-- Print job queue for the print-relay agent.
-- Prod (VPS) can't reach the factory LAN printers directly, so instead of opening
-- a socket it enqueues a job here. An always-on agent on a factory-LAN machine
-- polls this table over HTTPS, sends the payload to the printer, and reports back.
--
-- Run in: Supabase SQL Editor (staging first, then prod). Re-runnable.

create table if not exists production.print_jobs (
  id           uuid        primary key default gen_random_uuid(),
  section_id   text        not null,
  printer_ip   text        not null,
  printer_port integer     not null default 9100,
  lang         text        not null default 'zpl',
  payload      text        not null,   -- fully-rendered ZPL/PPLB command string
  status       text        not null default 'pending' check (status in ('pending','printing','done','error')),
  attempts     integer     not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  printed_at   timestamptz
);

create index if not exists print_jobs_pending_idx on production.print_jobs (status, created_at);

grant usage on schema production to authenticated, service_role;
grant all on production.print_jobs to authenticated, service_role;
