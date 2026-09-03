-- ============================================================================
-- Voiding a bag now retires it from Quality's awaiting-QC queue
-- ============================================================================
--
-- Plain ASCII, no dollar-quoting.
--
--
-- THE BUG
-- -------
-- qms.v_bag_events ignores bag_tags.status entirely. Both its branches --
-- prod_bagging first, bag_tags as the fallback for serials prod_bagging lacks
-- (20260813_007) -- select the bag regardless of whether it was voided. So a
-- voided bag still reaches v_bag_qc_status and still shows as awaiting QC,
-- for ever, because nothing in that queue expires.
--
-- Found via STFL-270826-034 (lot TEST-001): already voided, still in the
-- queue, and voiding it again could never have helped. Every other voided bag
-- is there for the same reason.
--
--
-- WHY THE FILTER GOES HERE AND NOT IN v_bag_events
-- ------------------------------------------------
-- v_bag_events is the complete record of bag events and has a second consumer:
-- the Sieving QC screen reads it to populate the serial dropdown used to
-- CORRECT a serial on an already-sampled or historical run
-- (app/(app)/quality/sieving/page.tsx). That list is deliberately every
-- bagging, not just pending ones -- so dropping voided bags from it would make
-- a voided bag's serial unpickable when fixing an old QC row.
--
-- The queue is what should not show a voided bag. So v_pending_bag_qc gets the
-- filter and v_bag_events stays complete.
--
-- CREATE OR REPLACE with SELECT * keeps the column list byte-identical, so no
-- dependent object is dropped and v_bag_events / v_bag_qc_status are not
-- touched at all. Rebuilding those from the repo is what once took this queue
-- from 8 rows to 847 (see 20260813_003 / _004) -- this migration deliberately
-- does not go near them.
-- ============================================================================


-- Step 1. READ ONLY. How many bags is this holding in the queue right now?
select v.bagged_at::date as bagged_on, v.product, v.bag_serial_no, v.lot_number,
       t.status, t.session_id
from qms.v_pending_bag_qc v
join production.bag_tags t on t.serial_number = v.bag_serial_no
where coalesce(t.status, '') = 'voided'
order by v.bagged_at;


-- Step 2. The waiver table, if 20260902_003 has not been applied yet. Harmless
--         to re-run; the view below references it, so it has to exist.
create table if not exists qms.bag_qc_waivers (
  bag_serial_no text        primary key,
  reason        text        not null,
  waived_by     text        not null,
  waived_at     timestamptz not null default now(),
  note          text
);

alter table qms.bag_qc_waivers enable row level security;

drop policy if exists bag_qc_waivers_read on qms.bag_qc_waivers;
create policy bag_qc_waivers_read on qms.bag_qc_waivers
  for select to anon, authenticated, service_role using (true);

drop policy if exists bag_qc_waivers_write on qms.bag_qc_waivers;
create policy bag_qc_waivers_write on qms.bag_qc_waivers
  for all to authenticated, service_role using (true) with check (true);

grant select on qms.bag_qc_waivers to anon, authenticated, service_role;
grant insert, update, delete on qms.bag_qc_waivers to authenticated, service_role;


-- Step 3. WRITES. Replace the queue view.
--
-- Two exclusions, both on the outermost view only:
--   * a bag whose bag_tags row is voided -- it is retired, and the queue is
--     the one place that never noticed
--   * a bag with an explicit QC waiver (20260902_003)
--
-- coalesce on status is load-bearing: `t.status <> 'voided'` is NULL for a NULL
-- status, and a NULL predicate drops the row -- which would have silently
-- hidden every bag whose status was never set.
--
-- A serial-less row (bag_serial_no NULL) matches neither subquery and is kept:
-- those are the changeover fault's twins, handled by the 2026-09-02 repair, not
-- here.
create or replace view qms.v_pending_bag_qc as
select *
from qms.v_bag_qc_status s
where s.qc_required
  and not s.qc_done
  and s.bag_date >= date '2026-08-13'
  and not exists (
    select 1 from production.bag_tags t
    where t.serial_number = s.bag_serial_no
      and coalesce(t.status, '') = 'voided'
  )
  and not exists (
    select 1 from qms.bag_qc_waivers w
    where w.bag_serial_no = s.bag_serial_no
  )
order by s.bagged_at desc;

grant select on qms.v_pending_bag_qc to anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- Step 4. READ ONLY. Verify.
-- Step 1 re-run should now return NO rows.
--
-- And the queue should be smaller by exactly what Step 1 listed:
--   select count(*) as still_pending,
--          count(*) filter (where coalesce(btrim(bag_serial_no), '') = '') as without_a_serial
--   from qms.v_pending_bag_qc;
--
--
-- WHAT THIS MEANS FOR STFL-270826-034
-- -----------------------------------
-- The TEST-001 bag is voided, so this migration alone drops it out of the
-- queue -- 20260903_001 no longer needs to be run to clear it. Run that one
-- only if you also want the row physically gone; it changes no production
-- figure either way, because the order page already excludes voided bags.
-- ============================================================================
