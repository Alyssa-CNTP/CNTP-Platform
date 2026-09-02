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
-- Only Step 0 (the backup table) has to exist first, because EXPLAIN still
-- resolves every name. Run Step 0, then this. Step 0 creates an empty table
-- and touches no production data.
--
-- Nothing here is dollar-quoted, and neither is the repair script: the
-- Supabase dashboard editor splits a script on semicolons, so a "do $$ ... $$"
-- body fails with "unterminated dollar-quoted string".
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
with unsafe as (
  select 1 as x
  from production.prod_debagging pd
  join production.prod_sessions s on s.id = pd.session_id and s.section_id = 'sieving'
  where pd.product_type in ('Farm Bag', '500kg Farm Bag')
    and pd.is_spillage = false
    and coalesce(btrim(pd.notes), '') <> ''
  group by pd.session_id,
           upper(regexp_replace(coalesce(pd.lot_number, ''), '\s', '', 'g')),
           btrim(pd.notes)
  having count(distinct round(pd.kg_nett::numeric, 3)) > 1
),
ranked as (
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
  select id from ranked
  where rn > 1
    and not exists (select 1 from unsafe)
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
with prods as (
  select s.id as session_id, s.date, s.shift, s.draft_data,
         p.ord as p_idx, p.value as p_json
  from production.prod_sessions s
  cross join lateral jsonb_array_elements(s.draft_data -> 'productions')
       with ordinality as p(value, ord)
  where s.section_id = 'sieving'
    and jsonb_typeof(s.draft_data -> 'productions') = 'array'
),
debag as (
  select pr.session_id, pr.p_idx, r.ord as r_idx, r.value as r_json,
         case
           when btrim(coalesce(r.value ->> 'bag_no', '')) = ''
           then '#' || pr.p_idx || '.' || r.ord            -- blank label: never merged
           else upper(regexp_replace(coalesce(nullif(r.value ->> 'lot', ''), pr.p_json ->> 'lot', ''), '\s', '', 'g'))
                || '|' || btrim(coalesce(r.value ->> 'bag_no', ''))
         end as identity
  from prods pr
  cross join lateral jsonb_array_elements(
         case when jsonb_typeof(pr.p_json -> 'data' -> 'debag') = 'array'
              then pr.p_json -> 'data' -> 'debag' else '[]'::jsonb end)
       with ordinality as r(value, ord)
),
outs as (
  select pr.session_id, pr.p_idx, r.ord as r_idx,
         case
           when btrim(coalesce(r.value ->> 'serial', '')) = ''
           then '#' || pr.p_idx || '.' || r.ord            -- blank serial: never merged
           else btrim(r.value ->> 'serial')
         end as identity
  from prods pr
  cross join lateral jsonb_array_elements(
         case when jsonb_typeof(pr.p_json -> 'data' -> 'outputs') = 'array'
              then pr.p_json -> 'data' -> 'outputs' else '[]'::jsonb end)
       with ordinality as r(value, ord)
)
select pr.session_id, min(pr.date) as date, min(pr.shift) as shift,
       (select count(*) from debag d where d.session_id = pr.session_id)          as debag_before,
       (select count(distinct d.identity) from debag d where d.session_id = pr.session_id) as debag_after,
       (select count(*) from outs o where o.session_id = pr.session_id)           as outputs_before,
       (select count(distinct o.identity) from outs o where o.session_id = pr.session_id)  as outputs_after
from prods pr
group by pr.session_id
having (select count(*) from debag d where d.session_id = pr.session_id)
       > (select count(distinct d.identity) from debag d where d.session_id = pr.session_id)
    or (select count(*) from outs o where o.session_id = pr.session_id)
       > (select count(distinct o.identity) from outs o where o.session_id = pr.session_id)
order by min(pr.date) desc, min(pr.shift);


-- Step 4b (UPDATE -- parsed and planned, NOT executed)
explain
with prods as (
  select s.id as session_id, s.draft_data,
         p.ord as p_idx, p.value as p_json
  from production.prod_sessions s
  cross join lateral jsonb_array_elements(s.draft_data -> 'productions')
       with ordinality as p(value, ord)
  where s.section_id = 'sieving'
    and jsonb_typeof(s.draft_data -> 'productions') = 'array'
),
debag as (
  select pr.session_id, pr.p_idx, r.ord as r_idx, r.value as r_json,
         case
           when btrim(coalesce(r.value ->> 'bag_no', '')) = ''
           then '#' || pr.p_idx || '.' || r.ord
           else upper(regexp_replace(coalesce(nullif(r.value ->> 'lot', ''), pr.p_json ->> 'lot', ''), '\s', '', 'g'))
                || '|' || btrim(coalesce(r.value ->> 'bag_no', ''))
         end as identity
  from prods pr
  cross join lateral jsonb_array_elements(
         case when jsonb_typeof(pr.p_json -> 'data' -> 'debag') = 'array'
              then pr.p_json -> 'data' -> 'debag' else '[]'::jsonb end)
       with ordinality as r(value, ord)
),
debag_keep as (
  -- First occurrence in capture order wins, across the whole session.
  select distinct on (session_id, identity) session_id, p_idx, r_idx, r_json
  from debag
  order by session_id, identity, p_idx, r_idx
),
debag_new as (
  select session_id, p_idx, jsonb_agg(r_json order by r_idx) as arr
  from debag_keep group by session_id, p_idx
),
outs as (
  select pr.session_id, pr.p_idx, r.ord as r_idx, r.value as r_json,
         case
           when btrim(coalesce(r.value ->> 'serial', '')) = ''
           then '#' || pr.p_idx || '.' || r.ord
           else btrim(r.value ->> 'serial')
         end as identity
  from prods pr
  cross join lateral jsonb_array_elements(
         case when jsonb_typeof(pr.p_json -> 'data' -> 'outputs') = 'array'
              then pr.p_json -> 'data' -> 'outputs' else '[]'::jsonb end)
       with ordinality as r(value, ord)
),
outs_keep as (
  select distinct on (session_id, identity) session_id, p_idx, r_idx, r_json
  from outs
  order by session_id, identity, p_idx, r_idx
),
outs_new as (
  select session_id, p_idx, jsonb_agg(r_json order by r_idx) as arr
  from outs_keep group by session_id, p_idx
),
prods_rebuilt as (
  -- Only the two arrays are replaced, and only where they already exist as
  -- arrays, so no key is invented and nothing else in the batch is touched.
  select pr.session_id, pr.p_idx,
         case when jsonb_typeof(pr.p_json -> 'data' -> 'outputs') = 'array'
              then jsonb_set(
                     case when jsonb_typeof(pr.p_json -> 'data' -> 'debag') = 'array'
                          then jsonb_set(pr.p_json, '{data,debag}', coalesce(dn.arr, '[]'::jsonb))
                          else pr.p_json end,
                     '{data,outputs}', coalesce(on_.arr, '[]'::jsonb))
              else
                   case when jsonb_typeof(pr.p_json -> 'data' -> 'debag') = 'array'
                        then jsonb_set(pr.p_json, '{data,debag}', coalesce(dn.arr, '[]'::jsonb))
                        else pr.p_json end
         end as p_new
  from prods pr
  left join debag_new dn on dn.session_id = pr.session_id and dn.p_idx = pr.p_idx
  left join outs_new  on_ on on_.session_id = pr.session_id and on_.p_idx = pr.p_idx
),
rebuilt as (
  -- jsonb_agg only. There is no min() for jsonb, so the original document is
  -- picked up from the table below rather than carried through an aggregate.
  select pb.session_id, jsonb_agg(pb.p_new order by pb.p_idx) as prods_new
  from prods_rebuilt pb
  group by pb.session_id
),
changed as (
  select r.session_id,
         jsonb_set(s.draft_data, '{productions}', r.prods_new) as draft_new,
         s.draft_data as draft_old
  from rebuilt r
  join production.prod_sessions s on s.id = r.session_id
  where jsonb_set(s.draft_data, '{productions}', r.prods_new) is distinct from s.draft_data
),
saved as (
  insert into production.repair_20260902_backup (source, session_id, payload)
  select 'prod_sessions.draft_data', c.session_id, c.draft_old from changed c
  returning session_id
)
update production.prod_sessions s
set draft_data = c.draft_new,
    updated_at = now()
from changed c
where s.id = c.session_id;


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
