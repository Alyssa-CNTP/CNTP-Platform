-- ============================================================
-- Retain a voided output bag as an audit-safe row instead of orphaning it.
-- ============================================================
--
-- Every "remove output bag" button across the capture sections (Sieving,
-- Granule, Blender, Refining) only ever removed the bag from the session's
-- own local capture state (draft_data.productions[].data.outputs) — the
-- corresponding production.bag_tags row, already written the moment the bag
-- was added, was never touched. A bag deleted from a capture record kept
-- silently sitting in bag_tags with status='in_stock', looking like real,
-- available inventory to every other screen that reads bag_tags (Quality's
-- pending-QC queue, Stock Control, Orders) even though the record it came
-- from says it doesn't exist. Confirmed live: two bags removed from a
-- reopened 2026-08-17 Sieving session stayed 'in_stock' in bag_tags.
--
-- Fix (app-side, this migration only widens the schema to allow it): when a
-- bag is removed from a capture session, flip bag_tags.status to 'voided'
-- (never hard-delete — scan_events.serial_number has an ON DELETE CASCADE FK
-- to bag_tags, so deleting the row would silently erase its whole audit
-- trail) and log a 'void' scan_event. Every other screen's existing
-- status-filtered queries then naturally exclude it without needing to
-- change anything there.
-- ============================================================

ALTER TABLE production.bag_tags DROP CONSTRAINT bag_tags_status_check;
ALTER TABLE production.bag_tags ADD CONSTRAINT bag_tags_status_check
  CHECK (status IN (
    'in_stock','in_process','consumed',
    'dispatched','on_hold','rejected','voided'
  ));

ALTER TABLE production.bag_tags ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE production.bag_tags ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES auth.users(id);

-- 'qc_check' isn't in the original migration's list but is already live on
-- staging (app/(app)/quality/sieving/page.tsx inserts it) — schema drift
-- discovered the hard way when this ALTER failed there. Included here, not
-- touching that Quality code at all, just not breaking it.
ALTER TABLE production.scan_events DROP CONSTRAINT scan_events_action_check;
ALTER TABLE production.scan_events ADD CONSTRAINT scan_events_action_check
  CHECK (action IN (
    'debagging_in','bagging_out',
    'stock_count','dispatch','reprint','void','qc_check'
  ));
