-- ============================================================
-- Bag-to-bag weight transfers: every "top-up" must name the source bag
-- the material physically came from. There is no such thing as loose
-- weight added to an existing tagged bag with no traceable origin.
-- ============================================================
--
-- This maps onto the standard industrial pattern for this exact problem:
--   - production.bag_tags   = the Physical Container (parent/state) --
--     one row per physical bag: its current total weight and open/closed
--     state right now.
--   - production.scan_events = the Weight Increment Log (child/delta) --
--     one immutable row per event that changed a bag's weight, never
--     rewritten after the fact. Reporting is event-sourced: it sums
--     delta rows by the date they actually happened, never re-derives a
--     day's total from a bag's current (possibly since-changed) state.
--
-- 'topped_up' and 'drawn_down' are the two sides of one transfer,
-- always written as a pair: the receiving bag gets 'topped_up'
-- (weight_kg = the amount received), the depleted bag gets 'drawn_down'
-- (weight_kg = the same amount, removed). related_serial_number on each
-- row points at the other bag, so either row alone tells you what it
-- was paired with.
--
-- Because every top-up now has a source, it is NEVER new production --
-- it's material that was already counted the day the source bag was
-- first bagged (its own 'bagging_out' row). Production/reporting
-- queries sum 'bagging_out' only; 'topped_up'/'drawn_down' are
-- traceability records, not tonnage. Including 'topped_up' in a
-- production sum would double-count the same kg: once on the day it was
-- produced, again on the day it's moved between containers.
--
-- Also repairs a real bug: the previous migration's ADD CONSTRAINT
-- dropped 'qc_check' (added by 20260818_001 for the Quality sieving
-- page) because a conflict-resolution edit was made but never staged
-- before the commit that shipped to staging. Restored here.
-- ============================================================

ALTER TABLE production.scan_events
  ADD COLUMN IF NOT EXISTS related_serial_number text
    REFERENCES production.bag_tags(serial_number);

CREATE INDEX IF NOT EXISTS scan_events_related_serial_idx
  ON production.scan_events(related_serial_number);

ALTER TABLE production.scan_events DROP CONSTRAINT scan_events_action_check;
ALTER TABLE production.scan_events ADD CONSTRAINT scan_events_action_check
  CHECK (action IN (
    'debagging_in','bagging_out',
    'stock_count','dispatch','reprint','void','qc_check',
    'topped_up','drawn_down'
  ));
