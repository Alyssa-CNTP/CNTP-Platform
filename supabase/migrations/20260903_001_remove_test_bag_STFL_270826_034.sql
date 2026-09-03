-- ============================================================================
-- Remove the TEST-001 phantom bag from Quality's awaiting-QC queue
-- ============================================================================
--
-- Plain ASCII, no dollar-quoting. Run ONE STEP AT A TIME.
--
-- The bag: serial STFL-270826-034, lot TEST-001, Fine Leaf, ORGANIC, 300 kg,
-- printed 2026-08-28 05:34 SAST under session e3c3482d (2026-08-27 afternoon,
-- still a draft). Step 1 confirmed what exists:
--
--   bag_tags       1 row, status ALREADY 'voided'
--   scan_events    1 row, a bagging_out with no session_id
--   prod_bagging   none
--   prod_debagging none
--   qms.sd_runs    none  <- no QC record, so nothing of record is lost
--
--
-- IT IS ALREADY VOIDED, AND STILL IN THE QUEUE
-- --------------------------------------------
-- That is the actual bug, and it is why this bag is a phantom. Voiding is
-- supposed to retire a bag. qms.v_bag_events builds from prod_bagging FIRST
-- and falls back to bag_tags for serials prod_bagging lacks (20260813_007) --
-- and NEITHER branch filters on status. With no prod_bagging row this bag
-- arrives through the fallback branch and the void is simply ignored.
--
-- Deleting it clears this one bag. Any other voided bag without a
-- prod_bagging row is in the queue for the same reason -- Step 4 counts them.
--
--
-- DELETING IT DOES NOT CHANGE ANY PRODUCTION FIGURE
-- -------------------------------------------------
-- I said earlier it would take ~300 kg off 2026-08-28's output. That was
-- wrong. The production order already excludes voided bags
-- (mergeOutputBags filters status <> 'voided' in lib/production/order-detail.ts)
-- and there is no prod_bagging row either, so the bag is in no total. This
-- removal is only about the queue.
--
-- Two rows to delete, in this order: scan_events references
-- bag_tags.serial_number by FK, so it goes first.
-- ============================================================================


-- ===========================================================================
-- Step 1. READ ONLY. Confirm it is what we think, and see everything that
--         references it
-- ===========================================================================
select 'bag_tags' as tbl, t.serial_number, t.lot_number, t.product_type,
       t.variant, t.weight_kg::text as kg, t.status, t.printed_at::text as at,
       t.session_id::text
from production.bag_tags t where t.serial_number = 'STFL-270826-034'
union all
select 'prod_bagging', b.bag_serial_no, b.lot_number, b.product_type,
       b.variant, b.kg::text, null, b.bagging_time::text, b.session_id::text
from production.prod_bagging b where b.bag_serial_no = 'STFL-270826-034'
union all
select 'prod_debagging', d.bag_serial_no, d.lot_number, d.product_type,
       d.variant, d.kg_nett::text, null, d.bagging_time::text, d.session_id::text
from production.prod_debagging d where d.bag_serial_no = 'STFL-270826-034'
union all
select 'scan_events', e.serial_number, null, e.action,
       null, e.weight_kg::text, e.notes, e.scanned_at::text, e.session_id::text
from production.scan_events e where e.serial_number = 'STFL-270826-034'
union all
select 'qms.sd_runs', r.serial_number, r.lot_number, r.product,
       r.variant, null, r.run_type, r.date, r.qc_name
from qms.sd_runs r where upper(btrim(r.serial_number)) = 'STFL-270826-034';

-- Expect: one bag_tags row, one prod_bagging row (or none), a scan_events row
-- or two, and NO qms.sd_runs row. If a sd_runs row appears, STOP -- a QC
-- record exists and step 3 will refuse to run anyway. Use option B instead.


-- ===========================================================================
-- Step 2. Backup table (safe to re-run -- already exists if the 2026-09-02
--         repair was run)
-- ===========================================================================
create table if not exists production.repair_20260902_backup (
  id           bigserial primary key,
  captured_at  timestamptz not null default now(),
  source       text        not null,
  session_id   uuid,
  row_id       text,
  payload      jsonb       not null
);


-- ===========================================================================
-- Step 3. WRITES. Back both rows up, then delete them
-- ===========================================================================
-- Every statement carries a guard on qms.sd_runs: if a QC record for this
-- serial ever appears, all four become no-ops rather than half-applying. A
-- food-safety record is not something to delete on the assumption it is absent.

-- 3a. Backup.
insert into production.repair_20260902_backup (source, session_id, row_id, payload)
select 'TESTBAG bag_tags', t.session_id, t.serial_number, to_jsonb(t)
from production.bag_tags t
where t.serial_number = 'STFL-270826-034'
  and not exists (select 1 from qms.sd_runs r where upper(btrim(r.serial_number)) = 'STFL-270826-034');

insert into production.repair_20260902_backup (source, session_id, row_id, payload)
select 'TESTBAG scan_events', e.session_id, e.id::text, to_jsonb(e)
from production.scan_events e
where e.serial_number = 'STFL-270826-034'
  and not exists (select 1 from qms.sd_runs r where upper(btrim(r.serial_number)) = 'STFL-270826-034');

-- 3b. scan_events first -- its serial_number is an FK to bag_tags.
delete from production.scan_events
where serial_number = 'STFL-270826-034'
  and not exists (select 1 from qms.sd_runs r where upper(btrim(r.serial_number)) = 'STFL-270826-034');

-- 3c. Then the bag.
delete from production.bag_tags
where serial_number = 'STFL-270826-034'
  and not exists (select 1 from qms.sd_runs r where upper(btrim(r.serial_number)) = 'STFL-270826-034');


-- ===========================================================================
-- Step 4. READ ONLY. Verify
-- ===========================================================================
-- Both of these should return no rows.
select 'still in the QC queue' as problem, v.bag_serial_no, v.lot_number
from qms.v_pending_bag_qc v where v.bag_serial_no = 'STFL-270826-034';

select 'still referenced' as problem, 'bag_tags' as tbl from production.bag_tags where serial_number = 'STFL-270826-034'
union all select 'still referenced', 'prod_bagging' from production.prod_bagging where bag_serial_no = 'STFL-270826-034'
union all select 'still referenced', 'scan_events' from production.scan_events where serial_number = 'STFL-270826-034';

-- What was saved, in case it is ever needed:
--   select id, source, row_id, captured_at
--   from production.repair_20260902_backup
--   where source like 'TESTBAG%' order by id;

-- THE SAME BUG, EVERYWHERE ELSE. Every bag in the queue whose bag_tags row is
-- voided. Each one is a phantom for the same reason and cannot be cleared by
-- voiding it again. If this returns rows, the fix is the view, not more
-- deletes -- see the note at the end of this file.
select v.bagged_at::date as bagged_on, v.product, v.bag_serial_no, v.lot_number,
       t.status, t.session_id
from qms.v_pending_bag_qc v
join production.bag_tags t on t.serial_number = v.bag_serial_no
where coalesce(t.status, '') = 'voided'
order by v.bagged_at;


-- ===========================================================================
-- Step 5. How to put it back
-- ===========================================================================
-- bag_tags FIRST (the others reference it), then the rest:
--   insert into production.bag_tags
--   select (jsonb_populate_record(null::production.bag_tags, payload)).*
--   from production.repair_20260902_backup where source = 'TESTBAG bag_tags';
--
--   insert into production.prod_bagging
--   select (jsonb_populate_record(null::production.prod_bagging, payload)).*
--   from production.repair_20260902_backup where source = 'TESTBAG prod_bagging';
--
--   insert into production.scan_events
--   select (jsonb_populate_record(null::production.scan_events, payload)).*
--   from production.repair_20260902_backup where source = 'TESTBAG scan_events';


-- ===========================================================================
-- Step 6. OPTION B instead: waive it, delete nothing
-- ===========================================================================
-- Needs migration 20260902_003 (qms.bag_qc_waivers) applied first. The bag
-- stays exactly where it is and drops out of the queue.
--
--   insert into qms.bag_qc_waivers (bag_serial_no, reason, waived_by, note)
--   values ('STFL-270826-034',
--           'Test bag, not product. No sample required.',
--           'REPLACE ME -- the person accepting this',
--           'Lot TEST-001, Fine Leaf, bagged 2026-08-28. Left in the queue by '
--           || 'a test capture; kept on record rather than deleted.')
--   on conflict (bag_serial_no) do nothing;
--
-- To reverse:
--   delete from qms.bag_qc_waivers where bag_serial_no = 'STFL-270826-034';
--
-- Either way no production figure moves: the bag is voided and has no
-- prod_bagging row, so it is in no total already.
--
--
-- ===========================================================================
-- THE REAL FIX, NOT IN THIS FILE
-- ===========================================================================
-- Voiding a bag should retire it from the QC queue, and it does not.
-- qms.v_bag_events ignores bag_tags.status in both branches, so:
--   * a voided bag with no prod_bagging row (this one) arrives via the
--     fallback branch and stays for ever
--   * a voided bag WITH a prod_bagging row arrives via branch 1, which cannot
--     see bag_tags.status at all
--
-- The production order already respects voiding (mergeOutputBags), so only the
-- QC queue is affected -- but every future voided bag will do this again, and
-- deleting them one at a time is not a fix.
--
-- v_bag_events has been redefined six times (20260807_001, 20260813_001, _003,
-- _004, _006, _007), and rebuilding it from the migration files once took the
-- queue from 8 rows to 847. So do NOT reconstruct it from this repo. Dump what
-- is actually deployed first:
--
--   select pg_get_viewdef('qms.v_bag_events'::regclass, true);
--
-- and the status filters can then be added to THAT definition with CREATE OR
-- REPLACE, which keeps the column list byte-identical and leaves
-- v_bag_qc_status and v_pending_bag_qc untouched.
-- ============================================================================
