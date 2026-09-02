-- ============================================================================
-- Parse check for 20260902_001_repair_sieving_changeover_duplicates.sql
-- ============================================================================
--
-- RUN THIS FIRST. It executes NOTHING.
--
-- Every statement below is wrapped in EXPLAIN. Postgres parses, resolves every
-- column and operator, and builds a plan -- then throws the plan away. EXPLAIN
-- without ANALYZE does not run the statement, so the DELETEs and UPDATEs here
-- touch no data.
--
-- The point: a column that does not exist, a text compared to a date, a min()
-- on a uuid, a GROUP BY that does not cover the select list -- every one of
-- those fails here, in seconds, against the real schema, instead of halfway
-- through a repair. Three of them already have.
--
-- If this whole file runs without error, every statement in the repair script
-- is valid against this database.
--
-- Step 0 (the backup table) and Step 4's function must be created first --
-- EXPLAIN still has to resolve their names. Run Step 0 and the
-- "create or replace function production.dedupe_sieving_draft" block from the
-- repair script, then this. Both are safe: one creates an empty table, the
-- other creates a pure function. Neither touches production data.
-- ============================================================================


-- Step 1a
explain
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


-- Step 2a
explain
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
    and coalesce(btrim(pd.notes), '') <> ''
)
select case when rn = 1 then 'KEEP' else 'DROP' end as keep_or_drop,
       session_id, bag_no, lot_number, notes as bag_label, kg_nett, id
from ranked
order by session_id, lot_number, notes, rn;


-- Step 2b
explain
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


-- Step 2c (also the guard inside Step 3)
explain
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


-- Step 2d
explain
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


-- Step 3a (DELETE -- parsed and planned, NOT executed)
explain
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


-- Step 3b (DELETE -- parsed and planned, NOT executed)
explain
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


-- Step 4a
explain
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
       ) as debag_after
from production.prod_sessions s
where s.section_id = 'sieving'
  and jsonb_typeof(s.draft_data -> 'productions') = 'array'
  and production.dedupe_sieving_draft(s.draft_data) is distinct from s.draft_data
order by s.date desc, s.shift;


-- Step 4b (UPDATE -- parsed and planned, NOT executed)
explain
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


-- Step 7a
explain
select case when coalesce(btrim(v.bag_serial_no), '') = ''
            then 'no serial - changeover twin, removed by Step 3b'
            else 'has serial - a real bag still awaiting QC' end as kind,
       count(*)               as bags,
       min(v.bagged_at)::date as oldest,
       max(v.bagged_at)::date as newest
from qms.v_pending_bag_qc v
group by 1
order by 2 desc;


-- Step 8a
explain
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
      and fr.date     = to_char(v.bagged_at::date, 'YYYY-MM-DD')
      and qms.norm_lot(fr.lot_number) = v.lot_key
where coalesce(btrim(v.bag_serial_no), '') <> ''
group by 1, 2, 3, 4
order by 1, 2, 3;


-- Step 8b (UPDATE -- parsed and planned, NOT executed)
explain
with pending as (
  select v.bagging_id, v.bag_serial_no, v.lot_key, v.product, v.bagged_at::date as day
  from qms.v_pending_bag_qc v
  where coalesce(btrim(v.bag_serial_no), '') <> ''
),
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
