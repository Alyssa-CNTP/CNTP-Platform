-- ============================================================================
-- Closing an awaiting-QC bag that was never sampled, on the record
-- ============================================================================
--
-- Plain ASCII, no dollar-quoting -- the Supabase dashboard editor splits a
-- script on semicolons.
--
--
-- THE PROBLEM
-- -----------
-- Quality's awaiting-sampling queue stood at 62 bags. About 20 were the
-- serial-less twins the changeover fault created, and deleting those was
-- right: they were never physical bags. The remaining 42 are real bags, and
-- Step 8a established what is true of every one of them:
--
--   * no final sd_run carries that bag's serial, and
--   * the final runs that DO exist for the same lot on the same day carry
--     other serials -- bags that have already cleared the queue.
--
-- So there is no broken link to repair. Step 8b looked for one and found
-- nothing to relink.
--
-- THE CAUSE, from the floor: these are bags from the period when serials were
-- being generated incorrectly and skipping -- numbers allocated to bags that
-- were never printed, sequences jumping, counters shared across products. That
-- allocator has since been rewritten (lib/core/serials.ts), and the bad rows it
-- left were removed BY HAND from the database in earlier sessions. The sample
-- records went with the rows they pointed at. So most of these 42 will never
-- have a sample: there is nothing left to link them to, and re-sampling them is
-- not the answer either.
--
-- Separately and still true: the queue asks for a Final QC per BAG while QC
-- samples per LOT, so bags the sampling plan does not cover keep arriving here.
-- That is a policy question, deferred by agreement to a later session.
--
--
-- WHY NOT JUST WRITE THE MISSING sd_runs
-- --------------------------------------
-- Because that would be inventing food-safety test results. A final sd_run
-- carries a needle count, a leaf shade and a QC's name. Manufacturing 42 of
-- them to empty a screen would put fabricated readings into the FSSC record
-- against a real operator's name. Not an option, however the queue looks.
--
--
-- WHAT THIS DOES INSTEAD
-- ----------------------
-- Records an explicit, attributable decision: this bag was not sampled, here
-- is who accepted that and why. The queue then stops asking. The bag's history
-- says "closed without sampling, by X, because Y" -- which is the truth, and
-- is auditable. It never says the bag passed.
--
-- This is a QUALITY decision, not a data repair. The reason and the name must
-- be Quality's own.
-- ============================================================================


-- The waiver record
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


-- The queue skips a waived bag
-- CREATE OR REPLACE, and still SELECT *, so the column list is byte-identical
-- and no dependent view is dropped. v_bag_qc_status and v_bag_events are NOT
-- touched -- rebuilding those is what previously took the queue from 8 rows to
-- 847 (see 20260813_003 / _004).
create or replace view qms.v_pending_bag_qc as
select *
from qms.v_bag_qc_status s
where s.qc_required
  and not s.qc_done
  and s.bag_date >= date '2026-08-13'
  and not exists (
    select 1 from qms.bag_qc_waivers w
    where w.bag_serial_no = s.bag_serial_no
  )
order by s.bagged_at desc;

grant select on qms.v_pending_bag_qc to anon, authenticated, service_role;

notify pgrst, 'reload schema';


-- ============================================================================
-- Closing the 42 -- READ THIS BEFORE RUNNING IT
-- ============================================================================
-- Do not run the insert below until Quality has agreed the reason, and put
-- their own name in waived_by. Both are stored and shown; 'Claude' or 'IT' is
-- not an answer an auditor can use.
--
-- Look at the list first:
--
--   select v.bagged_at::date as bagged_on, v.product, v.lot_number,
--          v.bag_serial_no, v.kg
--   from qms.v_pending_bag_qc v
--   where coalesce(btrim(v.bag_serial_no), '') <> ''
--   order by v.bagged_at, v.product, v.bag_serial_no;
--
-- Then, with the reason and the name filled in:
--
--   insert into qms.bag_qc_waivers (bag_serial_no, reason, waived_by, note)
--   select v.bag_serial_no,
--          'Serial issued by the faulty allocator; sample record removed with the '
--          || 'bad rows during the serial cleanup. No sample exists or can exist.',
--          'REPLACE ME -- the QC or Quality manager accepting this',
--          'Backlog 2026-08-21 to 2026-09-02. No final sd_run carries these '
--          || 'serials; the runs for the same lot and day belong to other bags. '
--          || 'Closed without sampling, not passed. See the 2026-09-02 CHANGELOG '
--          || 'entry on the skipping-serial corrections.'
--   from qms.v_pending_bag_qc v
--   where coalesce(btrim(v.bag_serial_no), '') <> ''
--     and v.bagged_at::date <= date '2026-09-01'   -- leave today's alone
--   on conflict (bag_serial_no) do nothing;
--
-- One of them is a test bag (lot TEST-001) and can be waived with a reason
-- that says so rather than lumped in with real product.
--
-- To undo, for one bag or all of them:
--   delete from qms.bag_qc_waivers where bag_serial_no = '...';
--
-- To see what has been waived:
--   select waived_at::date, waived_by, reason, count(*)
--   from qms.bag_qc_waivers group by 1, 2, 3 order by 1 desc;
--
--
-- THE STANDING PROBLEM, WHICH THIS DOES NOT FIX -- DEFERRED BY AGREEMENT
-- ----------------------------------------------------------------------
-- The queue asks for a Final QC per BAG while QC samples per LOT. Every bag the
-- plan does not cover will keep arriving here, and waiving them one backlog at
-- a time is not a policy. The real fix is to decide what the queue should
-- require -- N bags per lot, or per pallet, or per tonne -- and then have
-- qc_required reflect that. It is a change to what the system ASKS FOR, not to
-- what it records, and it needs Quality in the room.
--
-- Agreed on 2026-09-02 to build this in a later session. The waiver clears the
-- backlog today without pretending the question is settled.
-- ============================================================================
