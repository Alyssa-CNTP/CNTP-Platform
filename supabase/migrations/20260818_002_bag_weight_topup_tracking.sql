-- ============================================================
-- Half-filled ("open") bags: top up weight across shift/day
-- boundaries on the SAME serial, instead of hand-writing a
-- corrected weight on the printed label while the database and
-- barcode stay wrong, or minting a duplicate serial for the
-- same physical bag.
-- ============================================================
--
-- is_open marks a bag as still being filled. It is a separate column
-- rather than a new bag_tags.status value on purpose: status='in_stock'
-- already drives several "available to consume downstream" picker
-- queries across the capture screens (Refining/Blender/Granule/
-- Pasteuriser all filter .eq('status','in_stock') to build their input
-- lists) — widening that enum risks silently changing what counts as
-- available. A separate flag is additive: every existing status-based
-- query keeps working unchanged, and callers that need to exclude
-- still-filling bags add is_open = false explicitly.
--
-- scan_events already is the per-bag audit ledger (every capture
-- component already inserts a 'bagging_out' row at creation with the
-- initial weight) — this just adds 'topped_up' as a new action so a
-- later weight addition is its own permanent, dated ledger row. The
-- convention already established for this table (see markBagConsumed's
-- 'debagging_in' rows) is that weight_kg on a scan_events row holds the
-- delta for that action, not a running total — 'topped_up' follows the
-- same convention, so day/month reporting can sum scan_events.weight_kg
-- by scanned_at date to attribute each kg to the date it was actually
-- added, and that attribution never changes when a report is re-run
-- later, even after further top-ups.
--
-- v_pending_bag_qc excludes open bags: QC shouldn't sign off a bag that
-- isn't finished filling yet. It naturally reappears once closed.
--
-- qms.v_bag_events and qms.v_bag_qc_status are NOT touched by this migration.
-- Both were substantially rewritten since this feature was first drafted
-- (20260813_007 switched the bag-event source from bag_tags to prod_bagging
-- with a bag_tags fallback; 20260813_008/009 rewrote the in-process match as
-- a LATERAL subquery to fix a query that was timing out production at ~20s).
-- Adding is_open to qms.v_bag_events via `t.is_open`/`be.*` propagation would
-- require recreating qms.v_bag_qc_status too, and CREATE OR REPLACE VIEW only
-- allows new columns at the very end of a view's own output — is_open would
-- land in the middle of v_bag_qc_status's existing columns (between the
-- be.* block and fr.id), which Postgres rejects. Simplest and safest: leave
-- both views exactly as they are, and pull is_open into v_pending_bag_qc
-- directly via its own join to bag_tags instead.
-- ============================================================

ALTER TABLE production.bag_tags
  ADD COLUMN IF NOT EXISTS is_open boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS bag_tags_open_idx
  ON production.bag_tags(is_open) WHERE is_open;

ALTER TABLE production.scan_events DROP CONSTRAINT scan_events_action_check;
ALTER TABLE production.scan_events ADD CONSTRAINT scan_events_action_check
  CHECK (action IN (
    'debagging_in','bagging_out',
    'stock_count','dispatch','reprint','void',
    'topped_up'
  ));

-- Same WHERE conditions as the current qms.v_pending_bag_qc (20260813_009),
-- plus the is_open exclusion via a join that doesn't change this view's
-- output column list at all (still `vqs.*`), so nothing downstream can break.
CREATE OR REPLACE VIEW qms.v_pending_bag_qc AS
SELECT vqs.*
FROM qms.v_bag_qc_status vqs
LEFT JOIN production.bag_tags bt ON bt.serial_number = vqs.bag_serial_no
WHERE vqs.qc_required
  AND NOT vqs.qc_done
  AND vqs.bag_date >= DATE '2026-08-13'
  AND COALESCE(bt.is_open, false) IS NOT TRUE
ORDER BY vqs.bagged_at DESC;

GRANT SELECT ON qms.v_pending_bag_qc TO anon, authenticated, service_role;
