-- ============================================================
-- CNTP Production — record management (numbering, soft-delete, edit audit)
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- db-migrate.yml is manual-dispatch only, so this does NOT auto-apply.
-- Idempotent: safe to re-run.
-- ============================================================
set lock_timeout = '5s';

-- Soft-delete + edit-provenance columns, and a stable human-readable record number.
alter table production.prod_sessions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists edited_at  timestamptz,
  add column if not exists edited_by  uuid references auth.users(id),
  add column if not exists record_no  text;

create index if not exists prod_sessions_deleted_idx  on production.prod_sessions(deleted_at);
create index if not exists prod_sessions_record_no_idx on production.prod_sessions(record_no);

-- Auto-assign a stable record number on insert: <SECTIONCODE>-<DDMMYY>-<NN>
-- e.g. ST-080726-01. Section codes match SECTION_CODE_MAP in the app.
create or replace function production.set_record_no()
returns trigger language plpgsql as $$
declare
  code text;
  seq  int;
begin
  if new.record_no is not null and new.record_no <> '' then
    return new;
  end if;
  code := case new.section_id
    when 'sieving'      then 'ST' when 'refining1'   then 'R1'
    when 'refining2'    then 'R2' when 'granule'     then 'GL'
    when 'blender'      then 'BL' when 'smallblender' then 'SB'
    when 'pasteuriser'  then 'PR' else upper(left(new.section_id, 2)) end;
  select count(*) + 1 into seq
    from production.prod_sessions
   where section_id = new.section_id and date = new.date;
  new.record_no := code || '-' || to_char(new.date, 'DDMMYY') || '-' || lpad(seq::text, 2, '0');
  return new;
end $$;

drop trigger if exists prod_sessions_record_no on production.prod_sessions;
create trigger prod_sessions_record_no
  before insert on production.prod_sessions
  for each row execute function production.set_record_no();

-- Backfill existing rows, ordered by creation within each section + production day.
with numbered as (
  select id, section_id, date,
         row_number() over (partition by section_id, date order by created_at) as seq
    from production.prod_sessions
   where record_no is null
)
update production.prod_sessions ps
   set record_no = (case n.section_id
        when 'sieving'      then 'ST' when 'refining1'   then 'R1'
        when 'refining2'    then 'R2' when 'granule'     then 'GL'
        when 'blender'      then 'BL' when 'smallblender' then 'SB'
        when 'pasteuriser'  then 'PR' else upper(left(n.section_id, 2)) end)
     || '-' || to_char(n.date, 'DDMMYY') || '-' || lpad(n.seq::text, 2, '0')
  from numbered n
 where ps.id = n.id;

notify pgrst, 'reload schema';
