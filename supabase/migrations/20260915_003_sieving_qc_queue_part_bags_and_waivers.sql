-- ============================================================================
-- 20260915_003_sieving_qc_queue_part_bags_and_waivers.sql
--
-- Three things, all about the same screen: the Sieving Tower's "Bag awaiting
-- QC" queue (qms.v_pending_bag_qc).
--
--   1. A PART-FILLED bag must not ask for a Final QC. It is not finished, so
--      there is nothing to sample yet.
--   2. qms.bag_qc_waivers does not exist on this database, so the queue has no
--      way to record "no QC result exists for this bag" — see below.
--   3. Repair the one corrupted row in qms.sieving_spec_overrides.
--
-- Plain ASCII, no dollar-quoting -- the Supabase dashboard editor splits a
-- script on semicolons.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. PART-FILLED BAGS
-- ----------------------------------------------------------------------------
-- 20260818_002 already excludes bags flagged production.bag_tags.is_open, and
-- that flag is set automatically when a bag is captured under
-- OPEN_BAG_WEIGHT_THRESHOLD_KG = 200 (lib/production/capture-config.ts). It is
-- not enough, and the live data says why:
--
--   STFL-260826-001 -- prod_bagging.kg 150, bag_tags.weight_kg 300, is_open
--   false. Bagged at 150kg and topped up by another 150 forty minutes later.
--
-- and, in the other direction, Coarse Leaf bags sitting at 215kg and Fine Leaf
-- at 147kg with is_open false -- part bags that the 200kg auto-flag either
-- missed or that were closed by hand. Those are the ones Quality keeps being
-- asked to sample: the bag is on the floor, still filling, and the queue
-- already wants a bulk density and a leaf shade for it.
--
-- So fullness is decided on WEIGHT, against the product's own standard full-bag
-- weight, and read from bag_tags.weight_kg -- the running total a top-up
-- updates -- with prod_bagging.kg only as a fallback for a bag that has no tag
-- row. Using prod_bagging.kg as the primary would have held STFL-260826-001
-- out of the queue forever: that column keeps the FIRST capture's weight and is
-- never re-written by a top-up, so a bag that really did reach 300kg would read
-- as a 150kg part bag for the rest of its life.
--
-- The standard weights mirror expectedBagWeightFor() in
-- lib/production/capture-config.ts. They are duplicated here rather than
-- imported because a view cannot call TypeScript; the function below is the
-- single place SQL states them, so the two lists are one line each to compare.
--
-- 95%, not 100%: a bag filled to 297kg on a floor scale is full. Observed
-- weights are overwhelmingly exactly 300 (Fine Leaf 97 of 103, Coarse Leaf 50
-- of 54) with the part bags far below -- 215, 160, 147, 87, 80, 57, 56, 47 --
-- so the gap either side of 285 is wide and nothing sits near the boundary.
-- A bag that never reaches 95% stays out of the queue and is closed through the
-- waiver path below, which says so on the record, rather than being sampled as
-- though it were a full bag.

create or replace function qms.full_bag_kg(product text)
returns numeric
language sql
immutable
as 'select case
     when lower(coalesce(product, '''')) like ''%indent stick%'' then 252
     when lower(coalesce(product, '''')) like ''%fine leaf%''
       or lower(coalesce(product, '''')) like ''%coarse leaf%''   then 300
     else null
   end::numeric';

comment on function qms.full_bag_kg(text) is
  'Standard full-bag weight in kg for a sieving output product, or NULL when the product has no standard. Mirrors expectedBagWeightFor() in lib/production/capture-config.ts -- keep the two in step.';


-- ----------------------------------------------------------------------------
-- 2. THE WAIVER TABLE
-- ----------------------------------------------------------------------------
-- 20260902_003 wrote this table and the app has read it since (the sieving
-- page's waiver panel, and its comment that "the table may not exist yet"), but
-- it was never applied to this database -- qms.bag_qc_waivers does not exist
-- here. So every bag with no QC result on the system has stayed in the queue
-- with no way to close it except inventing a sample, which is exactly what
-- 20260902_003 refuses to do.
--
-- Created here with the same shape and the same meaning. A waiver is NOT a
-- pass: it records that no Final QC exists for the bag, who accepted that, and
-- why. Deleting the row puts the bag straight back in the queue.

create table if not exists qms.bag_qc_waivers (
  bag_serial_no text        primary key,
  reason        text        not null,
  waived_by     text        not null,
  waived_at     timestamptz not null default now(),
  note          text
);

comment on table qms.bag_qc_waivers is
  'Bags closed out of the awaiting-QC queue WITHOUT being sampled. One row per bag, with who accepted that and why. This is not a pass: it records that no Final QC exists for the bag and that the omission was accepted deliberately. Delete the row to put the bag back in the queue.';

alter table qms.bag_qc_waivers enable row level security;

drop policy if exists bag_qc_waivers_read on qms.bag_qc_waivers;
create policy bag_qc_waivers_read on qms.bag_qc_waivers
  for select to anon, authenticated, service_role using (true);

drop policy if exists bag_qc_waivers_write on qms.bag_qc_waivers;
create policy bag_qc_waivers_write on qms.bag_qc_waivers
  for all to authenticated, service_role using (true) with check (true);

grant select on qms.bag_qc_waivers to anon, authenticated, service_role;
grant insert, update, delete on qms.bag_qc_waivers to authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 3. THE QUEUE
-- ----------------------------------------------------------------------------
-- Rebuilt with every exclusion in one place. The live view carried 20260818_002's
-- is_open join but NOT 20260902_003's waiver clause -- the two migrations each
-- rewrote the whole view from its own starting point, so whichever ran last
-- dropped the other's rule. Stating all four conditions here ends that.
--
-- DROP first rather than CREATE OR REPLACE: three columns are being appended
-- and REPLACE is fussy about column lists. Checked before writing this --
-- nothing depends on this view, it is a leaf (the app reads it directly).
--
-- The three added columns are at the END, and are there so the screen can SAY
-- why a bag is or is not in the queue instead of it silently being shorter:
--   bag_weight_kg  -- what the bag actually weighs now, top-ups included
--   full_bag_kg    -- what full means for this product
--   is_part_bag    -- always false in this view; the column exists so the same
--                     shape can be selected for the part-bag panel

drop view if exists qms.v_pending_bag_qc;

create view qms.v_pending_bag_qc as
select vqs.*,
       coalesce(bt.weight_kg, vqs.kg)          as bag_weight_kg,
       qms.full_bag_kg(vqs.product)            as full_bag_kg,
       false                                   as is_part_bag
from qms.v_bag_qc_status vqs
left join production.bag_tags bt on bt.serial_number = vqs.bag_serial_no
where vqs.qc_required
  and not vqs.qc_done
  and vqs.bag_date >= date '2026-08-13'
  -- still being filled, flagged at capture
  and coalesce(bt.is_open, false) is not true
  -- closed without sampling, on the record
  and not exists (
    select 1 from qms.bag_qc_waivers w
    where w.bag_serial_no = vqs.bag_serial_no
  )
  -- part bag: not finished, so there is nothing to sample yet. A product with
  -- no standard full weight (full_bag_kg null) is never excluded by this.
  and (
    qms.full_bag_kg(vqs.product) is null
    or coalesce(bt.weight_kg, vqs.kg) is null
    or coalesce(bt.weight_kg, vqs.kg) >= qms.full_bag_kg(vqs.product) * 0.95
  )
order by vqs.bagged_at desc;

grant select on qms.v_pending_bag_qc to anon, authenticated, service_role;


-- The part bags themselves, so they are visible rather than simply absent.
-- Same predicate as the queue's fullness rule, inverted. A bag appears here
-- while it fills and moves to the queue above the moment it reaches full --
-- no action is needed to move it, and none is offered.
create or replace view qms.v_part_bags_awaiting_fill as
select vqs.*,
       coalesce(bt.weight_kg, vqs.kg)          as bag_weight_kg,
       qms.full_bag_kg(vqs.product)            as full_bag_kg,
       true                                    as is_part_bag
from qms.v_bag_qc_status vqs
left join production.bag_tags bt on bt.serial_number = vqs.bag_serial_no
where vqs.qc_required
  and not vqs.qc_done
  and vqs.bag_date >= date '2026-08-13'
  and not exists (
    select 1 from qms.bag_qc_waivers w
    where w.bag_serial_no = vqs.bag_serial_no
  )
  and (
    coalesce(bt.is_open, false) is true
    or (
      qms.full_bag_kg(vqs.product) is not null
      and coalesce(bt.weight_kg, vqs.kg) is not null
      and coalesce(bt.weight_kg, vqs.kg) < qms.full_bag_kg(vqs.product) * 0.95
    )
  )
order by vqs.bagged_at desc;

comment on view qms.v_part_bags_awaiting_fill is
  'Bags that would be awaiting QC except that they are not full yet -- flagged is_open at capture, or below 95% of their product standard full weight. They are not skipped, they are early: each one joins qms.v_pending_bag_qc by itself once it reaches full.';

grant select on qms.v_part_bags_awaiting_fill to anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 4. REPAIR THE CORRUPTED SPEC OVERRIDE
-- ----------------------------------------------------------------------------
-- qms.sieving_spec_overrides holds one row, Fine Leaf, saved 2026-09-15 10:29.
-- It is identical to the built-in defaults in the app except on the six ORGANIC
-- variants, where:
--
--     ">10 (%)": [0, 1]   became   ">10 (%)": [0, 0]  and  ">12 (%)": [0, 1]
--
-- [0,0] is the app's encoding for "no spec" (sdChk returns neutral), and an
-- Organic variant is checked against meshForORG, which contains >10 and not
-- >12. So the net effect of that saved edit was to switch the >10 check OFF for
-- every Organic Fine Leaf grade and park the value in a mesh nothing reads --
-- which is why the change "did not save": it saved, and then did nothing
-- visible. See the editor fix in app/(app)/quality/sieving/page.tsx, which no
-- longer offers a variant a mesh column it does not use.
--
-- Restored to the IPS-SIEV-001.2 value ">10: 0-1" and the phantom >12 dropped.
-- Written as a targeted jsonb edit, not a delete of the row: the row is the
-- record that Quality has customised this product, and the rest of it is
-- correct.

update qms.sieving_spec_overrides o
set specs = (
      select jsonb_object_agg(
               k,
               case
                 when k like '%Organic' then (v - '>12 (%)') || jsonb_build_object('>10 (%)', '[0, 1]'::jsonb)
                 else v
               end)
      from jsonb_each(o.specs) as e(k, v)
    ),
    updated_at = now()
where o.product = 'Fine Leaf'
  and o.specs -> 'Export|Organic' -> '>10 (%)' = '[0, 0]'::jsonb;


notify pgrst, 'reload schema';
