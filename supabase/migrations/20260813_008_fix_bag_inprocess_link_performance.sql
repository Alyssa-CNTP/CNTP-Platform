-- 20260813_008_fix_bag_inprocess_link_performance.sql
--
-- qms.v_pending_bag_qc was taking ~20 SECONDS and being killed by the 8s
-- statement timeout, so the Quality sieving screen showed no bags awaiting QC
-- on the live site while staging looked fine.
--
-- How it presented: PostgREST returned HTTP 500 with
-- `proxy_status: PostgREST; error=57014` (57014 = query_canceled) on
-- GET /rest/v1/v_pending_bag_qc — 1800 of them in ~40 minutes. The Quality
-- screen reads that endpoint with `const { data } = await ...`, discarding the
-- error object, so a failing request renders exactly like an empty queue. The
-- data and the deployed code were both correct the whole time.
--
-- Cause: qms.v_bag_inprocess_link matched a bag to the in-process run that
-- preceded it using a CORRELATED subquery over production.prod_debagging:
--
--     ip.lot_key IN (SELECT qms.norm_lot(d.lot_number)
--                      FROM production.prod_debagging d
--                     WHERE d.session_id = be.session_id)
--
-- which the planner evaluated once per (bag event x in-process run) pair:
-- 822,617 sequential scans of prod_debagging, 3.29 MILLION buffer hits.
--
-- Fix: hoist it into a MATERIALIZED CTE computed once (prod_debagging is tiny —
-- ~123 rows), then probe it with EXISTS, which becomes a hashed subplan. Also
-- index prod_debagging(session_id) for the per-session lookups elsewhere.
--
-- This took production from 19,928ms to 7,926ms — still too close to the 8s
-- timeout, which 20260813_009 finishes off. Both are needed.

BEGIN;

CREATE INDEX IF NOT EXISTS prod_debagging_session_id_idx
  ON production.prod_debagging (session_id);

DROP VIEW IF EXISTS qms.v_pending_bag_qc     CASCADE;
DROP VIEW IF EXISTS qms.v_bag_qc_status      CASCADE;
DROP VIEW IF EXISTS qms.v_bag_inprocess_link CASCADE;

CREATE OR REPLACE VIEW qms.v_bag_inprocess_link AS
WITH session_lots AS MATERIALIZED (
  SELECT DISTINCT d.session_id, qms.norm_lot(d.lot_number) AS lot_key
  FROM production.prod_debagging d
  WHERE d.session_id IS NOT NULL
)
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
      ip.lot_key = be.lot_key
      OR EXISTS (
           SELECT 1 FROM session_lots sl
            WHERE sl.session_id = be.session_id
              AND sl.lot_key    = ip.lot_key
         )
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
      fr.bagging_id = be.bagging_id
      OR (be.bag_serial_no IS NOT NULL
          AND upper(btrim(fr.serial_number)) = upper(btrim(be.bag_serial_no)))
     )
LEFT JOIN qms.v_bag_inprocess_link ln ON ln.bagging_id = be.bagging_id;

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

NOTIFY pgrst, 'reload schema';
