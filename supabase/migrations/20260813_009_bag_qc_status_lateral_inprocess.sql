-- 20260813_009_bag_qc_status_lateral_inprocess.sql
--
-- Finishes the fix started in 20260813_008. That migration took
-- qms.v_pending_bag_qc from 19,928ms to 7,926ms — still under the 8s statement
-- timeout only by a hair, so the Quality sieving screen would have started
-- failing again with HTTP 500 (PostgREST error=57014) as soon as the day's data
-- grew a little more.
--
-- Remaining cost: v_bag_qc_status joined the fully-materialised
-- v_bag_inprocess_link, so the in-process match was computed for EVERY bag
-- event crossed with EVERY in-process run — ~966,000 lot-normalisation
-- comparisons (each one several regexp_replace + upper calls) — before
-- v_pending_bag_qc's filter cut the result down to a handful of rows.
--
-- Fix: resolve the in-process match with LATERAL ... ORDER BY run_at DESC
-- LIMIT 1 instead. The lookup then runs only for the rows that actually
-- survive the qc_required / NOT qc_done / bag_date filter — 4 rows on
-- production rather than 1,678 — and picks the same "most recent in-process run
-- at or before this bag" that the DISTINCT ON did.
--
-- qms.v_bag_inprocess_link is deliberately left in place and unchanged (as
-- rewritten by 008) for any other consumer; it is simply no longer on the hot
-- path for the pending-QC queue.
--
-- Measured after this migration:
--   production  19,928ms -> 150ms   (4 pending rows, 3.29M buffers -> 981)
--   staging                  77ms   (10 pending rows)

BEGIN;

DROP VIEW IF EXISTS qms.v_pending_bag_qc CASCADE;
DROP VIEW IF EXISTS qms.v_bag_qc_status  CASCADE;

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
LEFT JOIN LATERAL (
  SELECT ip.run_id      AS inprocess_run_id,
         ip.run_at      AS inprocess_at,
         ip.pass_status AS inprocess_pass_status,
         ip.violations  AS inprocess_violations,
         ip.qc_name     AS inprocess_qc_name,
         ip.lot_number  AS inprocess_lot_number
  FROM qms.v_sd_inprocess ip
  WHERE ip.product  = be.product
    AND ip.run_at IS NOT NULL
    AND ip.run_at <= be.bagged_at
    AND (
         ip.lot_key = be.lot_key
         OR EXISTS (
              SELECT 1
              FROM production.prod_debagging d
              WHERE d.session_id = be.session_id
                AND qms.norm_lot(d.lot_number) = ip.lot_key
            )
        )
  ORDER BY ip.run_at DESC
  LIMIT 1
) ln ON true;

CREATE OR REPLACE VIEW qms.v_pending_bag_qc AS
SELECT *
FROM qms.v_bag_qc_status
WHERE qc_required
  AND NOT qc_done
  AND bag_date >= DATE '2026-08-13'
ORDER BY bagged_at DESC;

GRANT SELECT ON qms.v_bag_qc_status, qms.v_pending_bag_qc
  TO anon, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
