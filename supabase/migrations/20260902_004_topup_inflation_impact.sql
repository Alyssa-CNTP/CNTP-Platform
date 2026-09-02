-- ============================================================================
-- READ ONLY. Which production orders were inflated by later top-ups
-- ============================================================================
--
-- Plain ASCII, no dollar-quoting.
--
-- WHY
-- ---
-- addFreshWeightToBag overwrites bag_tags.weight_kg in place: current +
-- increment. The scan_events row it writes alongside carries only the
-- INCREMENT, and is never rewritten.
--
-- The production order took each bag's kg from bag_tags.weight_kg, i.e. the
-- bag's weight TODAY. So a bag bagged at 300 kg on 31-08 and topped up 22 kg
-- on 01-09 has read 322 kg on the 31-08 order ever since -- while 01-09
-- separately counted the 22 kg as a fresh top-up. The same 22 kg on two orders,
-- and 31-08's output overstated by it.
--
-- Fixed in code: the bag's kg is now its STARTING weight (earliest scan_events
-- row) plus only that day's own top-up increments.
--
-- This script changes nothing. It shows what the fix moves, so the correction
-- is not a surprise on a day that has already been signed off.
-- ============================================================================


-- 1. Per bag: what the order used to show, what it will show, and the gap.
with first_ev as (
  select distinct on (e.serial_number)
         e.serial_number, e.weight_kg as start_kg, e.scanned_at as first_at
  from production.scan_events e
  order by e.serial_number, e.scanned_at
),
later_topups as (
  -- Every top-up increment AFTER the bag's first event, with the date of the
  -- session that captured it.
  select e.serial_number, s.date as topup_date, sum(e.weight_kg) as kg
  from production.scan_events e
  join first_ev f on f.serial_number = e.serial_number and e.scanned_at > f.first_at
  left join production.prod_sessions s on s.id = e.session_id
  where e.notes like 'HALF_BAG_TOPUP%'
  group by e.serial_number, s.date
)
select bs.date            as order_date,
       bs.section_id,
       t.serial_number,
       t.product_type,
       f.start_kg         as kg_the_day_actually_bagged,
       t.weight_kg        as kg_the_order_has_been_showing,
       round((t.weight_kg - f.start_kg)::numeric, 1) as overstated_by,
       (select string_agg(lt.topup_date::text || ' +' || lt.kg::text, ', ' order by lt.topup_date)
          from later_topups lt where lt.serial_number = t.serial_number) as topped_up_on
from production.bag_tags t
join production.prod_sessions bs on bs.id = t.session_id
join first_ev f on f.serial_number = t.serial_number
where t.status <> 'voided'
  and f.start_kg is not null
  and round(t.weight_kg::numeric, 3) <> round(f.start_kg::numeric, 3)
order by bs.date desc, t.serial_number;


-- 2. The same, totalled per order, so the size of each correction is plain.
with first_ev as (
  select distinct on (e.serial_number)
         e.serial_number, e.weight_kg as start_kg, e.scanned_at as first_at
  from production.scan_events e
  order by e.serial_number, e.scanned_at
)
select bs.date as order_date, bs.section_id,
       count(*) as bags_affected,
       round(sum(t.weight_kg - f.start_kg)::numeric, 1) as kg_removed_from_this_order
from production.bag_tags t
join production.prod_sessions bs on bs.id = t.session_id
join first_ev f on f.serial_number = t.serial_number
where t.status <> 'voided'
  and f.start_kg is not null
  and round(t.weight_kg::numeric, 3) <> round(f.start_kg::numeric, 3)
group by bs.date, bs.section_id
order by bs.date desc;


-- 3. Sanity: a bag whose earliest event has NO weight recorded falls back to
--    bag_tags.weight_kg, so it keeps the old behaviour. Expected to be empty
--    or to hold only bags that predate event logging.
select t.serial_number, t.product_type, t.weight_kg, bs.date as order_date
from production.bag_tags t
join production.prod_sessions bs on bs.id = t.session_id
where t.status <> 'voided'
  and not exists (
    select 1 from production.scan_events e
    where e.serial_number = t.serial_number and e.weight_kg is not null
  )
order by bs.date desc
limit 50;
