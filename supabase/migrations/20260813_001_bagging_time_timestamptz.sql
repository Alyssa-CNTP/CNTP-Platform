-- 20260813_001_bagging_time_timestamptz.sql
--
-- Make production.prod_bagging.bagging_time a real timestamp of WHEN the bag was
-- created, instead of a bare time-of-day.
--
-- Why: persist() rebuilds every bag row on each save (explicit save, 30s
-- autosave, submit) with a delete + reinsert, so created_at is really "when the
-- session was last saved" — identical across the whole order and drifting
-- forward the whole time the screen stays open. bagging_time was a bare `time`,
-- so downstream (Quality's v_bag_events.bagged_at) had to glue it onto the
-- created_at DATE — which is the wrong date once a session is re-saved on a
-- later day. Every output bag already carries logged_at (the exact instant it
-- was secured, held in draft_data and therefore immutable), so we store that
-- verbatim in bagging_time and the timestamp stops drifting.
--
-- Ordering with the code deploy: the capture code that writes a full ISO instant
-- into bagging_time and the code that read it as HH:MM cannot both be valid for
-- one column type, so this ALTER and the matching app deploy must land close
-- together (a short capture-save window otherwise 400s). Run this first on the
-- target DB, then deploy the code.
--
-- Idempotency: guarded so re-running is a no-op once bagging_time is already
-- timestamptz.

BEGIN;

-- ── 1. Drop the QC-link views that depend on bagging_time ───────────────────
-- v_bag_events is the root; the rest hang off it. v_sd_inprocess is independent
-- of bagging_time and is intentionally left in place.
DROP VIEW IF EXISTS qms.v_pending_bag_qc     CASCADE;
DROP VIEW IF EXISTS qms.v_bag_qc_status      CASCADE;
DROP VIEW IF EXISTS qms.v_bag_inprocess_link CASCADE;
DROP VIEW IF EXISTS qms.v_bag_events         CASCADE;

-- ── 2. Convert the column ───────────────────────────────────────────────────
-- Existing bare-time values are read as SAST wall-clock on the row's (SAST)
-- created_at date and stored as the equivalent timestamptz, so already-captured
-- rows keep the same displayed time. New rows get the bag's logged_at instant.
DO $$
BEGIN
  IF (SELECT data_type
        FROM information_schema.columns
       WHERE table_schema = 'production'
         AND table_name  = 'prod_bagging'
         AND column_name = 'bagging_time') = 'time without time zone'
  THEN
    ALTER TABLE production.prod_bagging
      ALTER COLUMN bagging_time TYPE timestamptz
      USING (
        CASE WHEN bagging_time IS NOT NULL
          THEN (((created_at AT TIME ZONE 'Africa/Johannesburg')::date + bagging_time)
                 AT TIME ZONE 'Africa/Johannesburg')
        END
      );
  END IF;
END $$;

-- ── 3. Recreate the views ───────────────────────────────────────────────────
-- Identical to 20260807_001 except bagged_at / bag_date now come straight from
-- bagging_time (the real instant), converted to SAST wall-clock so the existing
-- display and run-ordering logic is unchanged; they fall back to created_at when
-- a bag has no bagging_time.
CREATE OR REPLACE VIEW qms.v_bag_events AS
SELECT
  b.id                                    AS bagging_id,
  b.bag_serial_no,
  b.lot_number,
  qms.norm_lot(b.lot_number)              AS lot_key,
  b.product_type                          AS prod_product_type,
  qms.norm_sd_product(b.product_type)     AS product,
  qms.sd_product_needs_qc(b.product_type) AS qc_required,
  b.variant,
  b.kg,
  b.session_id,
  b.batch_id,
  b.bag_no,
  b.output_group,
  (COALESCE(b.bagging_time, b.created_at) AT TIME ZONE 'Africa/Johannesburg')::date AS bag_date,
  b.bagging_time,
  (COALESCE(b.bagging_time, b.created_at) AT TIME ZONE 'Africa/Johannesburg')       AS bagged_at,
  b.created_at
FROM production.prod_bagging b;

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
      fr.bagging_id = be.bagging_id
      OR (fr.bagging_id IS NULL
          AND be.bag_serial_no IS NOT NULL
          AND upper(btrim(fr.serial_number)) = upper(btrim(be.bag_serial_no)))
     )
LEFT JOIN qms.v_bag_inprocess_link ln ON ln.bagging_id = be.bagging_id;

-- Only bags from 2026-08-13 onward ever surface as pending (20260812_002) --
-- the backlog before per-bag bagging_time existed is deliberately left as
-- historical, not retro-QC'd. Preserved here since this migration recreates
-- the view from scratch.
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
