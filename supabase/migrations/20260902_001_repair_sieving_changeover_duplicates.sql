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
-- HOW TO RUN
-- ----------
-- Steps 1 and 2 are read-only: run them first and read the output. Steps 3 and
-- 4 change data, and step 4 must not be skipped. Step 6 verifies.
--
-- START WITH STEP 1a: confirm you are on the PRODUCTION database. Run this
-- against staging and every step comes back clean, which looks exactly like
-- "already fixed". Then 1b -- steps 1, 2a and 2c filter to product_type in
-- ('Farm Bag','500kg Farm Bag'), while 1b assumes nothing and shows where the
-- rows actually are, so a repair cannot come back clean merely because it was
-- looking in the wrong place. 1c finds the duplicated session without its id.
--
-- Run ONE STEP AT A TIME. Do not paste the whole file in at once.
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
select s.date, s.shift, s.id as session_id, s.status,
       count(pd.id) filter (
         where pd.product_type in ('Farm Bag', '500kg Farm Bag')
           and pd.is_spillage = false
       ) as debag_rows,
       count(pb.id) as bagging_rows
from production.prod_sessions s
left join production.prod_debagging pd on pd.session_id = s.id
left join production.prod_bagging   pb on pb.session_id = s.id
where s.section_id = 'sieving'
  and s.date >= date '2026-08-28'
group by s.date, s.shift, s.id, s.status
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
select pd.session_id, pd.lot_number, btrim(pd.notes) as bag_label,
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
    for r in select value from jsonb_array_elements(coalesce(p -> 'data' -> 'debag', '[]'::jsonb)) loop
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
    for r in select value from jsonb_array_elements(coalesce(p -> 'data' -> 'outputs', '[]'::jsonb)) loop
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
               jsonb_array_elements(coalesce(pr.value -> 'data' -> 'debag', '[]'::jsonb))
       ) as debag_before,
       (select count(*)
          from jsonb_array_elements(production.dedupe_sieving_draft(s.draft_data) -> 'productions') pr,
               jsonb_array_elements(coalesce(pr.value -> 'data' -> 'debag', '[]'::jsonb))
       ) as debag_after,
       (select count(*)
          from jsonb_array_elements(s.draft_data -> 'productions') pr,
               jsonb_array_elements(coalesce(pr.value -> 'data' -> 'outputs', '[]'::jsonb))
       ) as outputs_before,
       (select count(*)
          from jsonb_array_elements(production.dedupe_sieving_draft(s.draft_data) -> 'productions') pr,
               jsonb_array_elements(coalesce(pr.value -> 'data' -> 'outputs', '[]'::jsonb))
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
