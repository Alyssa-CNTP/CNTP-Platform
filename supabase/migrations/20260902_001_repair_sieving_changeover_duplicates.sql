-- ============================================================================
-- Repair: the duplicated Sieving Tower rows left by the 2026-08-31 changeover
-- ============================================================================
--
-- This file is deliberately plain ASCII. An earlier draft used box-drawing
-- characters in its comment banners; somewhere between the file and the SQL
-- editor the multi-byte characters were mangled, the "--" comment markers went
-- with them, and Postgres reported a syntax error on a line of dashes. Keep it
-- ASCII.
--
--
-- WHAT WENT WRONG
-- ---------------
-- SievingCapture self-heals its debagging and output arrays from the ledger on
-- mount. Both reads are scoped .eq('session_id', ...), but a session can hold
-- SEVERAL batches (a grade changeover creates a second one mid-shift) and the
-- capture screen mounts ONE batch at a time. So the mounted batch treated every
-- sibling batch's row as "missing" and adopted it, and persist() -- which
-- writes the whole session back from draft_data -- made the copies permanent.
-- Every page load doubled them: 8, 16, 32, 64, 128, 258 rows for 41 physical
-- bags. The production order then read 91 036 kg of input against 4 704 kg
-- bagged, and printed "-94.8% material lost" beside it.
--
-- On the output side the copies collided with prod_bagging's
-- (session_id, bag_serial_no) uniqueness. persist() nulls a repeated serial to
-- get the write through and keeps the row, so each copied bag survived as a
-- serial-less twin: the blank-serial rows on the production order, and the
-- unidentified bags clogging Quality's awaiting-QC queue.
--
-- The code fault is fixed separately (lib/production/self-heal-reconcile.ts and
-- SievingCapture): each batch is now told what its siblings hold, so a restore
-- is idempotent. This script cleans up the rows the fault already wrote.
--
--
-- WHY draft_data IS REPAIRED TOO -- DO NOT SKIP STEP 4
-- ----------------------------------------------------
-- prod_debagging and prod_bagging are REBUILT from prod_sessions.draft_data on
-- every save. Deleting the duplicate rows without also deduplicating draft_data
-- undoes itself the moment an operator next touches that session. draft_data is
-- the source; the two tables are its projection.
--
--
-- NOTHING IS LOST
-- ---------------
-- Every row and every draft_data document this script changes is copied whole
-- into production.repair_20260902_backup first. Step 6 shows how to put any of
-- it back.
--
--
-- RUNBOOK -- do these in this order
-- ---------------------------------
-- Run ONE STEP AT A TIME. Do not paste the whole file in at once.
-- Everything numbered "READ ONLY" is safe to run at any point, repeatedly.
--
--   0.  Step 0            create the backup table            (writes: empty table)
--   1.  Step 4's function create dedupe_sieving_draft        (writes: a function)
--   2.  20260902_002_repair_parse_check.sql
--                         proves every statement below is valid against THIS
--                         database before any of them touches data. Executes
--                         nothing. If it errors, stop and fix that first.
--   3.  Step 1a           confirm you are on PRODUCTION, not staging  READ ONLY
--   4.  Step 2c           safety check -- MUST return no rows         READ ONLY
--   5.  Step 2d           the bags that survive; check against the
--                         floor's sheet before deleting anything      READ ONLY
--   6.  Step 3            delete the duplicate rows          WRITES, backed up
--   7.  Step 4b           deduplicate draft_data             WRITES, backed up
--                         NOT OPTIONAL -- see below
--   8.  Step 6a           verify: re-run Step 1, expect no rows       READ ONLY
--   9.  Step 8a           why the QC queue is not clearing            READ ONLY
--  10.  Step 8b           relink the forced matches          WRITES, backed up
--  11.  Step 8a, 8c       what is left for a person to decide         READ ONLY
--
-- Steps 1, 1b, 1c, 1d, 2a, 2b, 7a, 7b, 7c are diagnostics. Run them whenever
-- you want more detail; none of them change anything.
--
-- ALSO REQUIRED, AND NOT IN THIS FILE: the code fix (PR #872) has to be on
-- main and deployed, or the duplicates come straight back. This script cleans
-- up what the fault already wrote; the fault itself is fixed in
-- SievingCapture + lib/production/self-heal-reconcile.ts. Deploy first, repair
-- second -- in that order nothing can re-duplicate between the two.
--
-- Why Step 1a matters: run this against staging and every step comes back
-- clean, which looks exactly like "already fixed".
-- Why Step 4 matters: prod_debagging and prod_bagging are REBUILT from
-- draft_data on every save, so Step 3 without Step 4 undoes itself the moment
-- an operator next opens the session.
-- ============================================================================


-- ===========================================================================
-- Step 0. Backup table (safe to re-run)
-- ===========================================================================
create table if not exists production.repair_20260902_backup (
  id           bigserial primary key,
  captured_at  timestamptz not null default now(),
  source       text        not null,   -- prod_debagging | prod_bagging | prod_sessions.draft_data
  session_id   uuid,
  row_id       text,                    -- text, not uuid: this must not fail on a surrogate key type
  payload      jsonb       not null
);

comment on table production.repair_20260902_backup is
  'Rows and draft_data documents removed/rewritten by the 2026-09-02 Sieving changeover-duplication repair. Keep until the repair is confirmed on the floor.';


-- ===========================================================================
-- Step 1a. READ ONLY. RUN THIS FIRST. Which database am I connected to?
-- ===========================================================================
-- The duplication is on PRODUCTION. Run the repair against staging and every
-- step comes back clean, which is indistinguishable from "already fixed" --
-- so confirm the database before reading anything below as good news.
--
-- Supabase project refs (see CLAUDE.md and .env.local):
--   staging     qjqkpockmujecjgmdple
--   production  sxzjjcyuzyfneesnsjna
-- The ref is in the dashboard URL of the SQL editor you are typing into.
--
-- This query is the evidence, not the label. On the production database the
-- Sieving Tower ran on 2026-08-31 AND 2026-09-01, and 31-08 carries far more
-- debagging rows than distinct bags. A database with no 2026-09-01 sieving
-- session, or with a single-figure row count on 31-08, is not the one the
-- floor is capturing into.
-- Counted with scalar subqueries, NOT by joining both tables to the session.
-- Joining prod_debagging and prod_bagging in one query pairs every debag row
-- with every bagging row and multiplies both counts.
select s.date, s.shift, s.id as session_id, s.status,
       (select count(*) from production.prod_debagging pd
         where pd.session_id = s.id
           and pd.product_type in ('Farm Bag', '500kg Farm Bag')
           and pd.is_spillage = false) as debag_rows,
       (select count(*) from production.prod_bagging pb
         where pb.session_id = s.id) as bagging_rows
from production.prod_sessions s
where s.section_id = 'sieving'
  and s.date >= date '2026-08-28'
order by s.date, s.shift;


-- ===========================================================================
-- Step 1. READ ONLY. How bad is it, per session
-- ===========================================================================
-- debag_rows vs debag_rows_expected is the duplication factor. A healthy
-- session has them equal. Rows with no bag label are never counted as
-- duplicates: two different unlabelled bags are two bags, not one.
with sieving as (
  select id, date, shift from production.prod_sessions where section_id = 'sieving'
),
d as (
  select s.id as session_id, s.date, s.shift,
         count(*) filter (
           where pd.product_type in ('Farm Bag', '500kg Farm Bag')
             and pd.is_spillage = false
         ) as debag_rows,
         count(distinct case
           when pd.product_type in ('Farm Bag', '500kg Farm Bag')
                and pd.is_spillage = false
                and coalesce(btrim(pd.notes), '') <> ''
           then upper(regexp_replace(coalesce(pd.lot_number, ''), '\s', '', 'g')) || '|' || btrim(pd.notes)
         end) as distinct_labelled_bags,
         count(*) filter (
           where pd.product_type in ('Farm Bag', '500kg Farm Bag')
             and pd.is_spillage = false
             and coalesce(btrim(pd.notes), '') = ''
         ) as unlabelled_rows
  from sieving s
  left join production.prod_debagging pd on pd.session_id = s.id
  group by s.id, s.date, s.shift
),
b as (
  select s.id as session_id,
         count(*) as bag_rows,
         count(*) filter (where pb.bag_serial_no is null) as serial_less_rows,
         count(distinct pb.bag_serial_no) as distinct_serials
  from sieving s
  join production.prod_bagging pb on pb.session_id = s.id
  group by s.id
)
select d.date, d.shift, d.session_id,
       d.debag_rows,
       d.distinct_labelled_bags + d.unlabelled_rows as debag_rows_expected,
       d.debag_rows - (d.distinct_labelled_bags + d.unlabelled_rows) as debag_copies,
       coalesce(b.bag_rows, 0)         as bag_rows,
       coalesce(b.serial_less_rows, 0) as bag_rows_without_serial,
       coalesce(b.distinct_serials, 0) as distinct_serials
from d
left join b on b.session_id = d.session_id
where d.debag_rows > (d.distinct_labelled_bags + d.unlabelled_rows)
   or coalesce(b.serial_less_rows, 0) > 0
order by d.date desc, d.shift;


-- ===========================================================================
-- Step 1b. READ ONLY. What is ACTUALLY in prod_debagging
-- ===========================================================================
-- Step 1 and Step 2a both filter to product_type in ('Farm Bag','500kg Farm
-- Bag'). If the duplicated rows on this database carry some other type, those
-- steps show nothing and the repair is a no-op against the real problem. This
-- query assumes nothing. Run it and check that the farm-bag types are in fact
-- where the rows are.
select s.section_id,
       pd.product_type,
       pd.is_spillage,
       count(*)                      as rows,
       count(distinct pd.session_id) as sessions,
       count(*) filter (where coalesce(btrim(pd.notes), '') = '') as rows_without_bag_label,
       min(s.date)                   as first_date,
       max(s.date)                   as last_date
from production.prod_debagging pd
left join production.prod_sessions s on s.id = pd.session_id
group by s.section_id, pd.product_type, pd.is_spillage
order by count(*) desc;


-- ===========================================================================
-- Step 1c. READ ONLY. The fattest sessions, whatever their product_type
-- ===========================================================================
-- debag_rows far above distinct_identities is the duplication. This finds the
-- affected session without needing to know its id: the 2026-08-31 incident
-- session held 258 rows for 41 distinct identities.
select s.section_id, s.date, s.shift, pd.session_id,
       count(*) as debag_rows,
       count(distinct upper(regexp_replace(coalesce(pd.lot_number, ''), '\s', '', 'g')) || '|' || btrim(coalesce(pd.notes, ''))) as distinct_identities,
       round(sum(pd.kg_nett)::numeric, 1) as total_kg
from production.prod_debagging pd
left join production.prod_sessions s on s.id = pd.session_id
group by s.section_id, s.date, s.shift, pd.session_id
order by count(*) desc
limit 20;


-- ===========================================================================
-- Step 1d. READ ONLY. Lot numbers that differ only by whitespace or case
-- ===========================================================================
-- Live data holds "MAT-0375" and "  MAT- 0375" in the SAME session. Compared
-- literally those read as two different lots: here, in traceability, and in
-- every batch join. This repair normalises them, but the stored values are
-- still worth cleaning up separately.
select upper(regexp_replace(coalesce(pd.lot_number, ''), '\s', '', 'g')) as lot_identity,
       array_agg(distinct pd.lot_number) as written_as,
       count(*) as rows
from production.prod_debagging pd
join production.prod_sessions s on s.id = pd.session_id and s.section_id = 'sieving'
group by 1
having count(distinct pd.lot_number) > 1
order by count(*) desc;


-- ===========================================================================
-- Step 2a. READ ONLY. Which prod_debagging rows Step 3 will remove
-- ===========================================================================
-- Rows marked DROP are the ones that go. Read this before running Step 3.
with ranked as (
  select pd.id, pd.session_id, pd.bag_no, pd.lot_number, pd.notes, pd.kg_nett,
         pd.created_at,
         row_number() over (
           partition by pd.session_id,
                        upper(regexp_replace(coalesce(pd.lot_number, ''), '\s', '', 'g')),
                        btrim(pd.notes)
           order by pd.created_at, pd.bag_no, pd.id
         ) as rn
  from production.prod_debagging pd
  join production.prod_sessions s on s.id = pd.session_id and s.section_id = 'sieving'
  where pd.product_type in ('Farm Bag', '500kg Farm Bag')
    and pd.is_spillage = false
    and coalesce(btrim(pd.notes), '') <> ''   -- unlabelled rows are never deduplicated
)
select case when rn = 1 then 'KEEP' else 'DROP' end as keep_or_drop,
       session_id, bag_no, lot_number, notes as bag_label, kg_nett, id
from ranked
order by session_id, lot_number, notes, rn;


-- ===========================================================================
-- Step 2b. READ ONLY. Which prod_bagging rows Step 3 will remove
-- ===========================================================================
-- A serial-less row that matches a serialed bag on session + product + weight
-- + bagging time is that bag's nulled twin. A genuine serial-less by-product
-- row will not coincide on all four.
with spine as (
  select pb.session_id, pb.product_type, round(pb.kg::numeric, 3) as kg, pb.bagging_time
  from production.prod_bagging pb
  join production.prod_sessions s on s.id = pb.session_id and s.section_id = 'sieving'
  where pb.bag_serial_no is not null
)
select pb.id, pb.session_id, pb.bag_no, pb.product_type, pb.kg, pb.bagging_time,
       'DROP - nulled twin of a serialed bag' as reason
from production.prod_bagging pb
join production.prod_sessions s on s.id = pb.session_id and s.section_id = 'sieving'
where pb.bag_serial_no is null
  and exists (
    select 1 from spine sp
    where sp.session_id   = pb.session_id
      and sp.product_type is not distinct from pb.product_type
      and sp.kg           = round(pb.kg::numeric, 3)
      and sp.bagging_time is not distinct from pb.bagging_time
  )
order by pb.session_id, pb.bag_no;


-- ===========================================================================
-- Step 2c. READ ONLY. SAFETY CHECK -- this must return NO ROWS
-- ===========================================================================
-- Deduplication keys on (session, lot, bag label) because a farm bag is a
-- physical object debagged once. If two rows share that identity but disagree
-- on weight they are NOT copies of one another, and dropping one would lose a
-- real figure. Confirmed empty for 31-08-2026 against the floor's paper sheet
-- (41 bags, 41 distinct pairs). Check it again here before writing anything.
--
-- Step 3 runs this same check itself and aborts if it finds anything.
select pd.session_id,
       upper(regexp_replace(coalesce(pd.lot_number, ''), '\s', '', 'g')) as lot_identity,
       array_agg(distinct pd.lot_number) as lot_written_as,
       btrim(pd.notes) as bag_label,
       count(*) as rows_with_this_identity,
       count(distinct round(pd.kg_nett::numeric, 3)) as distinct_weights,
       array_agg(distinct round(pd.kg_nett::numeric, 3)) as weights
from production.prod_debagging pd
join production.prod_sessions s on s.id = pd.session_id and s.section_id = 'sieving'
where pd.product_type in ('Farm Bag', '500kg Farm Bag')
  and pd.is_spillage = false
  and coalesce(btrim(pd.notes), '') <> ''
group by pd.session_id, upper(regexp_replace(coalesce(pd.lot_number, ''), '\s', '', 'g')), btrim(pd.notes)
having count(distinct round(pd.kg_nett::numeric, 3)) > 1;


-- ===========================================================================
-- Step 2d. READ ONLY. The bags that SURVIVE, per session
-- ===========================================================================
-- Check this against the floor's paper sheet for the day before running Step
-- 3. A disagreement with the sheet is a reason to stop, not to proceed.
--
-- COUNTS LABELLED BAGS ONLY. Rows with a blank bag label are never
-- deduplicated (two unlabelled bags are two bags), so they are also never
-- deleted -- and they are not counted here either. The affected sessions each
-- hold one, so the post-repair ROW count is this figure plus one:
--   2026-09-01 morning  18 labelled + 1 unlabelled = 19 rows (267 today)
--   2026-08-31 morning  21 labelled + 1 unlabelled = 22 rows (37 today)
select s.date, s.shift, pd.session_id,
       count(*) as bags_after_repair,
       round(sum(pd.kg_nett)::numeric, 1) as kg_after_repair,
       array_agg(btrim(pd.notes) order by btrim(pd.notes)) as bag_labels
from (
  select distinct on (pd.session_id, upper(regexp_replace(coalesce(pd.lot_number, ''), '\s', '', 'g')), btrim(pd.notes))
         pd.session_id, pd.notes, pd.kg_nett
  from production.prod_debagging pd
  join production.prod_sessions s on s.id = pd.session_id and s.section_id = 'sieving'
  where pd.product_type in ('Farm Bag', '500kg Farm Bag')
    and pd.is_spillage = false
    and coalesce(btrim(pd.notes), '') <> ''
  order by pd.session_id, upper(regexp_replace(coalesce(pd.lot_number, ''), '\s', '', 'g')), btrim(pd.notes), pd.created_at, pd.bag_no, pd.id
) pd
join production.prod_sessions s on s.id = pd.session_id
group by s.date, s.shift, pd.session_id
order by s.date desc, s.shift;


-- ===========================================================================
-- Step 3. WRITES. Remove the duplicate ledger rows (backed up first)
-- ===========================================================================
do $$
declare
  v_debag  int;
  v_bag    int;
  v_unsafe int;
begin
  -- Refuse to run at all if Step 2c is not clean.
  select count(*) into v_unsafe from (
    select 1
    from production.prod_debagging pd
    join production.prod_sessions s on s.id = pd.session_id and s.section_id = 'sieving'
    where pd.product_type in ('Farm Bag', '500kg Farm Bag')
      and pd.is_spillage = false
      and coalesce(btrim(pd.notes), '') <> ''
    group by pd.session_id, upper(regexp_replace(coalesce(pd.lot_number, ''), '\s', '', 'g')), btrim(pd.notes)
    having count(distinct round(pd.kg_nett::numeric, 3)) > 1
  ) q;

  if v_unsafe > 0 then
    raise exception
      'Aborted: % bag identities have rows that disagree on weight, so they are not copies. Run Step 2c and resolve them by hand first.', v_unsafe;
  end if;

  -- 3a. prod_debagging
  with ranked as (
    select pd.id,
           row_number() over (
             partition by pd.session_id,
                          upper(regexp_replace(coalesce(pd.lot_number, ''), '\s', '', 'g')),
                          btrim(pd.notes)
             order by pd.created_at, pd.bag_no, pd.id
           ) as rn
    from production.prod_debagging pd
    join production.prod_sessions s on s.id = pd.session_id and s.section_id = 'sieving'
    where pd.product_type in ('Farm Bag', '500kg Farm Bag')
      and pd.is_spillage = false
      and coalesce(btrim(pd.notes), '') <> ''
  ),
  doomed as (
    select id from ranked where rn > 1
  ),
  saved as (
    insert into production.repair_20260902_backup (source, session_id, row_id, payload)
    select 'prod_debagging', pd.session_id, pd.id::text, to_jsonb(pd)
    from production.prod_debagging pd
    join doomed d on d.id = pd.id
    returning 1
  )
  delete from production.prod_debagging pd
  using doomed d
  where pd.id = d.id;

  get diagnostics v_debag = row_count;

  -- 3b. prod_bagging
  with spine as (
    select pb.session_id, pb.product_type, round(pb.kg::numeric, 3) as kg, pb.bagging_time
    from production.prod_bagging pb
    join production.prod_sessions s on s.id = pb.session_id and s.section_id = 'sieving'
    where pb.bag_serial_no is not null
  ),
  doomed as (
    select pb.id
    from production.prod_bagging pb
    join production.prod_sessions s on s.id = pb.session_id and s.section_id = 'sieving'
    where pb.bag_serial_no is null
      and exists (
        select 1 from spine sp
        where sp.session_id   = pb.session_id
          and sp.product_type is not distinct from pb.product_type
          and sp.kg           = round(pb.kg::numeric, 3)
          and sp.bagging_time is not distinct from pb.bagging_time
      )
  ),
  saved as (
    insert into production.repair_20260902_backup (source, session_id, row_id, payload)
    select 'prod_bagging', pb.session_id, pb.id::text, to_jsonb(pb)
    from production.prod_bagging pb
    join doomed d on d.id = pb.id
    returning 1
  )
  delete from production.prod_bagging pb
  using doomed d
  where pb.id = d.id;

  get diagnostics v_bag = row_count;

  raise notice 'Removed % duplicate debagging row(s) and % nulled-twin bagging row(s). Backed up in production.repair_20260902_backup.', v_debag, v_bag;
end $$;


-- ===========================================================================
-- Step 4. WRITES. Deduplicate draft_data, or Step 3 undoes itself
-- ===========================================================================
-- draft_data is what persist() rebuilds both tables from on the next save.

create or replace function production.dedupe_sieving_draft(dd jsonb)
returns jsonb
language plpgsql
immutable
as $fn$
declare
  prods       jsonb := coalesce(dd -> 'productions', '[]'::jsonb);
  out_prods   jsonb := '[]'::jsonb;
  p           jsonb;
  r           jsonb;
  new_debag   jsonb;
  new_outputs jsonb;
  seen_debag  text[] := '{}';
  seen_out    text[] := '{}';
  k           text;
begin
  if jsonb_typeof(prods) <> 'array' then
    return dd;
  end if;

  -- seen_debag and seen_out span EVERY batch of the session, because the copies
  -- live in the OTHER batches, not alongside the original in its own.
  for p in select value from jsonb_array_elements(prods) loop

    new_debag := '[]'::jsonb;
    for r in select value from jsonb_array_elements(case when jsonb_typeof(p -> 'data' -> 'debag') = 'array'
                                        then p -> 'data' -> 'debag' else '[]'::jsonb end) loop
      -- A farm bag is a physical object debagged ONCE, so (lot, bag label) is
      -- its identity. A row with a BLANK label is never deduplicated: two
      -- different unlabelled bags would collapse into one and UNDER-count,
      -- which is worse than keeping a copy.
      k := upper(btrim(coalesce(nullif(r ->> 'lot', ''), p ->> 'lot', '')))
           || '|' || btrim(coalesce(r ->> 'bag_no', ''));
      if btrim(coalesce(r ->> 'bag_no', '')) = '' then
        new_debag := new_debag || jsonb_build_array(r);
      elsif not (k = any(seen_debag)) then
        seen_debag := seen_debag || k;
        new_debag  := new_debag || jsonb_build_array(r);
      end if;
    end loop;

    new_outputs := '[]'::jsonb;
    for r in select value from jsonb_array_elements(case when jsonb_typeof(p -> 'data' -> 'outputs') = 'array'
                                        then p -> 'data' -> 'outputs' else '[]'::jsonb end) loop
      -- An output bag's serial is unique to one physical bag.
      k := btrim(coalesce(r ->> 'serial', ''));
      if k = '' then
        new_outputs := new_outputs || jsonb_build_array(r);
      elsif not (k = any(seen_out)) then
        seen_out    := seen_out || k;
        new_outputs := new_outputs || jsonb_build_array(r);
      end if;
    end loop;

    if p ? 'data' then
      p := jsonb_set(p, '{data,debag}',   new_debag,   true);
      p := jsonb_set(p, '{data,outputs}', new_outputs, true);
    end if;

    out_prods := out_prods || jsonb_build_array(p);
  end loop;

  return jsonb_set(dd, '{productions}', out_prods, true);
end
$fn$;

comment on function production.dedupe_sieving_draft(jsonb) is
  'One-off repair helper for the 2026-08-31 Sieving changeover duplication. Drops repeated debag rows on (lot, bag label) and repeated output bags on serial, across every batch of a session. Blank labels and blank serials are never deduplicated. Safe to drop once the repair is confirmed.';


-- Step 4a. READ ONLY preview: how many rows each session loses.
select s.id, s.date, s.shift,
       (select count(*)
          from jsonb_array_elements(s.draft_data -> 'productions') pr,
               jsonb_array_elements(case when jsonb_typeof(pr.value -> 'data' -> 'debag') = 'array'
                                          then pr.value -> 'data' -> 'debag' else '[]'::jsonb end)
       ) as debag_before,
       (select count(*)
          from jsonb_array_elements(production.dedupe_sieving_draft(s.draft_data) -> 'productions') pr,
               jsonb_array_elements(case when jsonb_typeof(pr.value -> 'data' -> 'debag') = 'array'
                                          then pr.value -> 'data' -> 'debag' else '[]'::jsonb end)
       ) as debag_after,
       (select count(*)
          from jsonb_array_elements(s.draft_data -> 'productions') pr,
               jsonb_array_elements(case when jsonb_typeof(pr.value -> 'data' -> 'outputs') = 'array'
                                          then pr.value -> 'data' -> 'outputs' else '[]'::jsonb end)
       ) as outputs_before,
       (select count(*)
          from jsonb_array_elements(production.dedupe_sieving_draft(s.draft_data) -> 'productions') pr,
               jsonb_array_elements(case when jsonb_typeof(pr.value -> 'data' -> 'outputs') = 'array'
                                          then pr.value -> 'data' -> 'outputs' else '[]'::jsonb end)
       ) as outputs_after
from production.prod_sessions s
where s.section_id = 'sieving'
  and jsonb_typeof(s.draft_data -> 'productions') = 'array'
  and production.dedupe_sieving_draft(s.draft_data) is distinct from s.draft_data
order by s.date desc, s.shift;


-- Step 4b. WRITES: back up the document, then rewrite it.
with changed as (
  select s.id, s.draft_data
  from production.prod_sessions s
  where s.section_id = 'sieving'
    and jsonb_typeof(s.draft_data -> 'productions') = 'array'
    and production.dedupe_sieving_draft(s.draft_data) is distinct from s.draft_data
),
saved as (
  insert into production.repair_20260902_backup (source, session_id, payload)
  select 'prod_sessions.draft_data', c.id, c.draft_data from changed c
  returning session_id
)
update production.prod_sessions s
set draft_data = production.dedupe_sieving_draft(s.draft_data),
    updated_at = now()
from changed c
where s.id = c.id;


-- ===========================================================================
-- Step 5. NOT NEEDED. Deliberately no bag_tags cleanup
-- ===========================================================================
-- It is tempting to void the bag_tags rows for bags that no longer appear in a
-- repaired session, and it would be WRONG. The duplication never created a
-- bag_tags row: the self-heal reads bag_tags and copies bags INTO draft_data,
-- it never writes back (see SievingCapture). bag_tags therefore already holds
-- exactly one row per physical bag, and it -- not draft_data -- is the source
-- of truth on the output side. Voiding tags on the strength of draft_data would
-- invert that and destroy real bags the moment draft_data is behind, which is
-- the very condition the self-heal exists to recover from.
--
-- The unidentified bags in Quality's awaiting-QC queue are the serial-less
-- prod_bagging twins, and Step 3b is what clears them.


-- ===========================================================================
-- Step 6. READ ONLY. Verify, and how to undo
-- ===========================================================================
-- 6a. Re-run Step 1. It should now return no rows at all.
--
-- 6b. What was removed:
--       select source, count(*), min(captured_at)
--       from production.repair_20260902_backup
--       group by source;
--
-- 6c. Put a deleted debagging row back:
--       insert into production.prod_debagging
--       select (jsonb_populate_record(null::production.prod_debagging, payload)).*
--       from production.repair_20260902_backup
--       where id = <backup id>;
--
--     The same shape works for prod_bagging. To restore a session's draft_data:
--       update production.prod_sessions s
--       set draft_data = b.payload
--       from production.repair_20260902_backup b
--       where b.source = 'prod_sessions.draft_data'
--         and b.session_id = s.id
--         and b.id = <backup id>;
--
-- 6d. Once the floor has confirmed the repair, the helper can go:
--       drop function production.dedupe_sieving_draft(jsonb);
--     Keep repair_20260902_backup for at least one audit cycle.


-- ===========================================================================
-- Step 7. READ ONLY. The bags sitting in Quality's awaiting-sampling queue
-- ===========================================================================
-- Quality reported 62 bags waiting to be sampled, and that the backlog is
-- getting confused with newly loaded bags. That queue is qms.v_pending_bag_qc,
-- which reads prod_bagging (20260813_007) -- so the serial-less twins Step 3b
-- removes are IN it, appearing as cards with no serial that can never be
-- sampled and therefore never clear.
--
-- Step 3b removes those. It does NOT touch the rest, and the rest are real
-- bags that genuinely have not been QC'd. Clearing those is a Quality
-- decision, not a data repair -- do not delete them to make a number go down.
--
-- 7a. Split the queue: how much of it is the fault, and how much is real work.
select case when coalesce(btrim(v.bag_serial_no), '') = ''
            then 'no serial - changeover twin, removed by Step 3b'
            else 'has serial - a real bag still awaiting QC' end as kind,
       count(*)             as bags,
       min(v.bagged_at)::date as oldest,
       max(v.bagged_at)::date as newest
from qms.v_pending_bag_qc v
group by 1
order by 2 desc;

-- 7b. The real ones, oldest first -- this is the list for Quality to work
--     through or to decide about.
select v.bagged_at::date as bagged_on, v.product, count(*) as bags
from qms.v_pending_bag_qc v
where coalesce(btrim(v.bag_serial_no), '') <> ''
group by 1, 2
order by 1, 2;


-- 7c. Were the remaining bags already sampled, under a link that broke?
-- ---------------------------------------------------------------------------
-- Before asking QC to sample 42 bags going back to 21 August, check whether
-- they were sampled already. qms.v_pending_bag_qc clears a bag when a final
-- sd_run matches on bagging_id OR on serial_number. bagging_id is
-- prod_bagging.id, and that is NOT stable: persist() delete-then-inserts these
-- rows on every save, so a bagging_id recorded earlier points at a row that no
-- longer exists. The only fallback is serial_number -- so a final run captured
-- without one leaves its bag in the queue permanently.
--
-- Read it this way:
--   final_runs_that_day around or above pending_bags  -> likely sampled, link
--       broken; the fix is to relink, NOT to sample again.
--   final_runs_that_day = 0                           -> genuinely never
--       sampled; that is real QC work.
--   final_runs_without_serial > 0                     -> those runs can never
--       clear a bag by the serial fallback, whatever else is true.
select d.day, d.product, d.pending_bags,
       coalesce(f.final_runs, 0)                as final_runs_that_day,
       coalesce(f.final_runs_without_serial, 0) as final_runs_without_serial
from (
  select v.bagged_at::date as day, v.product, count(*) as pending_bags
  from qms.v_pending_bag_qc v
  where coalesce(btrim(v.bag_serial_no), '') <> ''
  group by 1, 2
) d
left join (
  -- sd_runs.date is TEXT; keep the comparison in text on both sides.
  select fr.date as day_text, fr.product,
         count(*) as final_runs,
         count(*) filter (where coalesce(btrim(fr.serial_number), '') = '') as final_runs_without_serial
  from qms.sd_runs fr
  where fr.run_type = 'final'
  group by 1, 2
) f on f.day_text = to_char(d.day, 'YYYY-MM-DD') and f.product = d.product
order by d.day, d.product;


-- ===========================================================================
-- Step 8. Clearing the awaiting-QC notifications
-- ===========================================================================
-- The floor's account: QC DID sample these bags. The duplicates aside, the
-- queue is showing work that is already done.
--
-- So the fix is to RESTORE THE LINK between each bag and the final run that
-- was captured for it. It is not to delete the pending bags: those rows are
-- the bags themselves, and the sd_runs are the QC record for them. Deleting
-- either to clear a screen destroys the traceability that the sampling was
-- done at all.
--
-- Two separate causes, two separate fixes:
--   * the serial-less duplicates       -> Step 3b deletes them. Not real bags.
--   * a real bag whose link broke      -> Step 8 below.
--
-- Why a link breaks. qms.v_pending_bag_qc clears a bag when a final sd_run
-- matches on bagging_id OR on serial_number. bagging_id is prod_bagging.id,
-- and persist() delete-then-inserts those rows on EVERY save -- so the id a
-- run was signed off against stops existing the next time the session is
-- touched. That leaves serial_number as the only surviving link, and it works
-- only if the run carries the same serial the bag now carries.


-- 8a. READ ONLY. Per bag: is there a final run for it, and why is it not
--     matching? Run this before anything in 8b.
--
-- Reading the result:
--   runs_matching_this_serial > 0   -> should already be clearing; if the bag
--       is still pending, look at the bag's own serial, not the run's.
--   final_runs_same_lot_day > 0 and runs_matching_this_serial = 0
--       -> sampled, but the run does not carry this bag's serial. run_serials
--          shows what it does carry -- '(no serial)' means nothing can ever
--          match it by serial and the stale bagging_id was its only link.
--   final_runs_same_lot_day = 0     -> no final run for that lot that day.
--       Genuinely not sampled, or captured under a different lot.
select v.bagged_at::date  as bagged_on,
       v.product,
       v.bag_serial_no,
       v.lot_number,
       count(fr.id)       as final_runs_same_lot_day,
       count(*) filter (
         where upper(btrim(coalesce(fr.serial_number, ''))) = upper(btrim(v.bag_serial_no))
       )                  as runs_matching_this_serial,
       array_agg(distinct coalesce(nullif(btrim(fr.serial_number), ''), '(no serial)'))
         filter (where fr.id is not null) as run_serials
from qms.v_pending_bag_qc v
left join qms.sd_runs fr
       on fr.run_type = 'final'
      and fr.product  = v.product
      -- sd_runs.date is TEXT; compare as text, never cast the stored value.
      and fr.date     = to_char(v.bagged_at::date, 'YYYY-MM-DD')
      and qms.norm_lot(fr.lot_number) = v.lot_key
where coalesce(btrim(v.bag_serial_no), '') <> ''
group by 1, 2, 3, 4
order by 1, 2, 3;


-- 8b. WRITES. Relink ONLY where the pairing is forced, never guessed.
-- ---------------------------------------------------------------------------
-- A final run is relinked to a bag only when, for one (lot, product, day),
-- there is EXACTLY ONE pending bag and EXACTLY ONE final run that currently
-- clears nothing. Then there is only one bag that run can belong to and the
-- pairing is not a choice.
--
-- Anything with two or more of either is left alone and listed by 8c. Pairing
-- those by position would attach one bag's needle count and leaf shade to a
-- different bag -- a traceability error, not a tidy-up.
--
-- The run's serial_number is set as well as its bagging_id, so the link
-- survives the next persist() rewrite instead of breaking again.
-- Every row is backed up first.
with pending as (
  select v.bagging_id, v.bag_serial_no, v.lot_key, v.product, v.bagged_at::date as day
  from qms.v_pending_bag_qc v
  where coalesce(btrim(v.bag_serial_no), '') <> ''
),
-- Final runs that currently clear no bag at all.
stuck as (
  select fr.id, fr.product, fr.date as day_text, qms.norm_lot(fr.lot_number) as lot_key
  from qms.sd_runs fr
  where fr.run_type = 'final'
    and not exists (
      select 1 from qms.v_bag_events be
      where fr.bagging_id = be.bagging_id
         or (be.bag_serial_no is not null
             and upper(btrim(fr.serial_number)) = upper(btrim(be.bag_serial_no)))
    )
),
forced as (
  -- (array_agg(distinct ...))[1], not min(): there is no min() for uuid. The
  -- HAVING below guarantees one distinct value per group, so the first element
  -- IS the value.
  select p.lot_key, p.product, p.day,
         (array_agg(distinct p.bagging_id))[1]    as bagging_id,
         (array_agg(distinct p.bag_serial_no))[1] as bag_serial_no,
         (array_agg(distinct st.id))[1]           as run_id
  from pending p
  join stuck st
    on st.lot_key = p.lot_key
   and st.product = p.product
   and st.day_text = to_char(p.day, 'YYYY-MM-DD')
  group by p.lot_key, p.product, p.day
  having count(distinct p.bagging_id) = 1
     and count(distinct st.id)        = 1
),
saved as (
  insert into production.repair_20260902_backup (source, row_id, payload)
  select 'qms.sd_runs', fr.id::text, to_jsonb(fr)
  from qms.sd_runs fr join forced f on f.run_id = fr.id
  returning 1
)
update qms.sd_runs fr
set bagging_id    = f.bagging_id,
    serial_number = f.bag_serial_no
from forced f
where fr.id = f.run_id;


-- 8c. READ ONLY. What 8b deliberately did not touch.
-- Re-run 8a after 8b; whatever is still listed needs a person to decide which
-- run belongs to which bag, or to sample the bag.
select v.bagged_at::date as bagged_on, v.product, v.lot_number,
       count(*) as bags_still_pending
from qms.v_pending_bag_qc v
where coalesce(btrim(v.bag_serial_no), '') <> ''
group by 1, 2, 3
order by 1, 2;
