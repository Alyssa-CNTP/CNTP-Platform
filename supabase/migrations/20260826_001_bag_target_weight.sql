-- 20260826_001_bag_target_weight.sql
--
-- Half-bag Top-up: "pre-print" a target weight. An operator picking the bag
-- they're about to top up can now optionally record what its FINAL weight
-- should be (e.g. "this one needs to reach 300kg") and print a label
-- reflecting that target right away, without needing to actually add
-- weight in the same visit — the tag itself then tells whoever handles the
-- bag next how much more it still needs.
--
-- A bag's target is a property of the bag for its whole lifetime (until it
-- reaches that weight or is closed), not a one-off event, so this is a real
-- column rather than something encoded into a scan_events note the way
-- HALF_BAG_TOPUP's batch marker is — it needs to be readable back at any
-- point without replaying history.

BEGIN;

ALTER TABLE production.bag_tags
  ADD COLUMN IF NOT EXISTS target_weight_kg numeric;

ALTER TABLE production.bag_tags
  ADD CONSTRAINT bag_tags_target_weight_kg_check
  CHECK (target_weight_kg IS NULL OR target_weight_kg > 0);

COMMENT ON COLUMN production.bag_tags.target_weight_kg IS
  'Optional final weight this bag is meant to reach once fully topped up. Set from Half-bag Top-up''s "pre-print" step; NULL means no target has been declared.';

COMMIT;

NOTIFY pgrst, 'reload schema';
