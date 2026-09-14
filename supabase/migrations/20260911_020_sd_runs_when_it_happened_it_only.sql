-- The QC types WHEN THE RUN HAPPENED. Correcting it afterwards is IT's job.
--
-- Two different facts, which the table already had columns for but was not
-- keeping straight:
--
--   date + time_of_run  — when the sieve was actually done. The QC knows this;
--                         for a back-capture it is days or weeks ago. It was
--                         being overwritten with the clock at save time, so a
--                         run recaptured on 11 Sep for work done on 21 Aug read
--                         11:25 instead of 09:08 — an instant that never
--                         happened, and one that sorted the row into the wrong
--                         place in a table ordered on date + time.
--
--   run_timestamp       — when the record was created in the system. Nobody
--                         types this. It is what makes a back-capture legible
--                         AS a back-capture: a run dated 21 Aug carrying a
--                         run_timestamp of 11 Sep was plainly entered later.
--
-- These stay EDITABLE — a mistyped time has to be fixable — but only by IT.
-- Enforced here rather than in the app, because a disabled input stops the
-- screen and nothing else: not the edit path (which sends date and time_of_run
-- on every save), not the API, not a hand-written UPDATE.
--
-- "IT" is the same claim the rest of the platform's RLS uses (shared.is_it()),
-- inlined so this migration does not depend on that helper existing — it is
-- present on production but not on staging. The full admin counts, and so does
-- a server-side connection (service_role / postgres): those are IT's own tools,
-- and the API routes need to keep working.

create or replace function qms.sd_runs_when_it_happened_guard()
returns trigger
language plpgsql
-- SECURITY INVOKER (the default) on purpose. Under SECURITY DEFINER,
-- `current_user` is the function's OWNER, not the caller — so the server-side
-- check below was true for everybody and the guard let a QC through.
set search_path = qms, public
as $$
declare
  is_it_user boolean := coalesce(
    current_user in ('postgres', 'service_role', 'supabase_admin')
    or coalesce(auth.jwt() ->> 'user_dept', '') = 'IT'
    or coalesce(auth.jwt() ->> 'user_role', '') = 'senior_developer',
    false);
  changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    -- Server-set, always: a client cannot claim when it was captured.
    new.run_timestamp := now();
    return new;
  end if;

  -- array_append, not `|| 'literal'`: the || operator is ambiguous between
  -- array-append and array-concat for an unknown-typed literal, and Postgres
  -- resolves it as a concat, failing with "malformed array literal". That threw
  -- before the IT check was reached, so every caller was refused — including IT.
  if new.date          is distinct from old.date          then changed := array_append(changed, 'date');          end if;
  if new.time_of_run   is distinct from old.time_of_run   then changed := array_append(changed, 'time_of_run');   end if;
  if new.run_timestamp is distinct from old.run_timestamp then changed := array_append(changed, 'run_timestamp'); end if;

  -- Unchanged values pass untouched, so the ordinary edit screen keeps working
  -- even though it still sends these columns.
  if array_length(changed, 1) is null then return new; end if;

  if not is_it_user then
    raise exception
      'Changing % on a sieving run (id %) is restricted to IT. The run''s date and time record when the sieve was actually done; ask IT to correct it.',
      array_to_string(changed, ' and '), old.id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists sd_runs_when_it_happened_guard on qms.sd_runs;
create trigger sd_runs_when_it_happened_guard
  before insert or update on qms.sd_runs
  for each row execute function qms.sd_runs_when_it_happened_guard();

comment on function qms.sd_runs_when_it_happened_guard() is
  'Stamps run_timestamp server-side on insert. Afterwards date / time_of_run / run_timestamp may only be changed by IT (or a server-side connection); everyone else is refused. Unchanged values always pass.';
