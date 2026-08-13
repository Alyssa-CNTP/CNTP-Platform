-- 20260812_002_pending_bag_qc_cutover_date.sql
--
-- Only bags production makes from 2026-08-13 onward should ever surface as a
-- pending Final QC — the backlog before that (bagged before the per-bag
-- bagging_time fix in 20260812's Refining change landed) is being
-- deliberately left as historical, not retro-QC'd. Nothing destructive: no
-- data is touched, old bags stay visible/reprintable in the Runs table, just
-- excluded from the pending list / pop-up / dropdown.
--
-- (Applied live to staging and production ahead of this file being committed
-- — this file exists so the migration history matches the actual DB state.)
CREATE OR REPLACE VIEW qms.v_pending_bag_qc AS
SELECT *
FROM qms.v_bag_qc_status
WHERE qc_required
  AND NOT qc_done
  AND bag_date >= DATE '2026-08-13';
