-- 20260813_004_reapply_bag_events_from_bag_tags.sql
--
-- Re-applies 20260813_003 verbatim.
--
-- Why this file exists: on production, 20260813_001 was hand-run AFTER 003
-- (001's own header instructs hand-running it, and the db-migrate workflow is
-- disabled). Section 3 of 001 recreates the QC views from
-- production.prod_bagging, which silently reverted both of 003's fixes — the
-- bag_tags source and the 2026-08-13 pending-QC cutover filter. The visible
-- symptom was the Final QC "bag awaiting QC" dropdown going back to missing
-- ~44% of bags, and the pending queue jumping from 8 to 847.
--
-- Running this restores the correct state. It is idempotent — safe to re-run
-- any time the views look wrong. Check with:
--   SELECT pg_get_viewdef('qms.v_bag_events'::regclass, true);
-- It must read FROM production.bag_tags, and v_pending_bag_qc must still carry
-- the bag_date >= DATE '2026-08-13' filter.
BEGIN;

DROP VIEW IF EXISTS qms.v_pending_bag_qc     CASCADE;
DROP VIEW IF EXISTS qms.v_bag_qc_status      CASCADE;
DROP VIEW IF EXISTS qms.v_bag_inprocess_link CASCADE;
DROP VIEW IF EXISTS qms.v_bag_events         CASCADE;

CREATE OR REPLACE VIEW qms.v_bag_events AS
SELECT
  md5(t.serial_number)::uuid              AS bagging_id,
  t.serial_number                         AS bag_serial_no,
  t.lot_number,
  qms.norm_lot(t.lot_number)              AS lot_key,
  t.product_type                          AS prod_product_type,
  qms.norm_sd_product(t.product_type)     AS product,
  qms.sd_product_needs_qc(t.product_type) AS qc_required,
  t.variant,
  t.weight_kg                             AS kg,
  t.session_id,
  t.batch_id,
  NULL::integer                           AS bag_no,          -- not tracked on bag_tags
  NULL::text                              AS output_group,    -- not tracked on bag_tags
  (COALESCE(t.printed_at, t.created_at) AT TIME ZONE 'Africa/Johannesburg')::date AS bag_date,
  COALESCE(t.printed_at, t.created_at)    AS bagging_time,
  (COALESCE(t.printed_at, t.created_at) AT TIME ZONE 'Africa/Johannesburg')       AS bagged_at,
  t.created_at
FROM production.bag_tags t;

CREATE OR REPLACE VIEW qms.v_bag_inprocess_link AS
SELECT DISTINCT ON (be.bagging_id)
  be.bagging_id,
  ip.run_id       AS inprocess_run_id,
  ip.run_at       AS inprocess_at,
  ip.pass_status  AS inprocess_pass_status,
  ip.violations   AS inprocess_violations,
  ip.qc_name      AS inprocess_qc_name,
  ip.lot_number   AS inprocess_lot_number
FROM qms.v_bag_events be
JOIN qms.v_sd_inprocess ip
  ON ip.product = be.product
 AND ip.run_at IS NOT NULL
 AND ip.run_at <= be.bagged_at
 AND (
      ip.lot_key IN (
        SELECT qms.norm_lot(d.lot_number)
        FROM production.prod_debagging d
        WHERE d.session_id = be.session_id
      )
      OR ip.lot_key = be.lot_key
     )
ORDER BY be.bagging_id, ip.run_at DESC;

CREATE OR REPLACE VIEW qms.v_bag_qc_status AS
SELECT
  be.*,
  fr.id            AS final_run_id,
  fr.qc_name       AS final_qc_name,
  fr.bulk_density  AS final_bulk_density,
  fr.leaf_shade    AS final_leaf_shade,
  fr.created_at    AS final_qc_at,
  (fr.id IS NOT NULL) AS qc_done,
  ln.inprocess_run_id,
  ln.inprocess_at,
  ln.inprocess_qc_name,
  ln.inprocess_pass_status,
  ln.inprocess_violations,
  COALESCE(ln.inprocess_pass_status = 'Fail', false) AS inprocess_out_of_spec
FROM qms.v_bag_events be
LEFT JOIN qms.sd_runs fr
  ON fr.run_type = 'final'
 AND (
      -- new links use the serial-derived id; the serial match also covers
      -- runs linked under the old prod_bagging uuid, so nothing is orphaned
      fr.bagging_id = be.bagging_id
      OR upper(btrim(fr.serial_number)) = upper(btrim(be.bag_serial_no))
     )
LEFT JOIN qms.v_bag_inprocess_link ln ON ln.bagging_id = be.bagging_id;

-- Only bags from 2026-08-13 onward ever surface as pending — the backlog
-- before that is deliberately left as historical, not retro-QC'd.
CREATE OR REPLACE VIEW qms.v_pending_bag_qc AS
SELECT *
FROM qms.v_bag_qc_status
WHERE qc_required
  AND NOT qc_done
  AND bag_date >= DATE '2026-08-13'
ORDER BY bagged_at DESC;

GRANT SELECT ON qms.v_bag_events, qms.v_bag_inprocess_link,
                qms.v_bag_qc_status, qms.v_pending_bag_qc
  TO anon, authenticated, service_role;

COMMIT;
