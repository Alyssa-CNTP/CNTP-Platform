-- Printers registry — one row per production section → its assigned label printer.
-- Lets the Printers admin page (under Users & Roles) reassign printers at runtime
-- without a code change; the print API reads this table (short cache) so edits
-- take effect within ~30s.
--
-- Run in: Supabase SQL Editor (staging first, then prod). Re-runnable (IF NOT EXISTS).

create table if not exists production.printers (
  section_id   text primary key,
  printer_name text        not null default '',
  ip           text        not null default '',
  port         integer     not null default 9100,
  lang         text        not null default 'zpl' check (lang in ('zpl','pplb')),
  enabled      boolean     not null default true,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

grant usage on schema production to authenticated, service_role;
grant all on production.printers to authenticated, service_role;
alter default privileges in schema production grant all on tables to authenticated, service_role;
