-- 20260813_006_prod_bagging_reliable_source.sql
--
-- Makes production.prod_bagging a complete, reliable source again and re-points
-- the QC views at it (per explicit request: "use prod_bagging as the source
-- table and bagging_time as the time" + "link forward and backward to the
-- serial so all bag serial numbers are linked").
--
-- Backstory: 20260813_003 moved the QC views to production.bag_tags because
-- persist() (app capture page) does DELETE ... WHERE session_id = ? then
-- reinserts prod_bagging from whatever is in draft_data at that instant, on
-- every save. Any bag not in that instant's draft_data — because a later save
-- raced it, or a session was never resaved after a code deploy, etc. — is
-- permanently gone from prod_bagging even though it was physically bagged and
-- printed (bag_tags still has it). Confirmed: 237 bag_tags rows presently have
-- no matching prod_bagging row (0 prod_bagging rows lack a bag_tags row, so the
-- loss is strictly one-directional, prod_bagging losing bag_tags' bags).
--
-- This migration:
--   1. Backfills every bag_tags row missing from prod_bagging, so the two
--      tables agree in both directions as of right now.
--   2. Adds a (session_id, bag_serial_no) uniqueness guarantee so a serialed
--      bag can be upserted instead of blindly deleted+reinserted going
--      forward (the app-side persist() fix that accompanies this migration
--      relies on this constraint via onConflict).
--   3. Re-points qms.v_bag_events (and the views built on it) at prod_bagging,
--      reading bagging_time and converting to Africa/Johannesburg (SAST) at
--      display time, same pattern as before — the column has been timestamptz
--      since 20260813_001.
--
-- Note: a hard FK from prod_bagging.bag_serial_no -> bag_tags.serial_number is
-- NOT added here — 3 legacy pre-"ST" serials (from before the current serial
-- format) exist twice in prod_bagging globally (different sessions), which a
-- global FK+unique wouldn't tolerate. The (session_id, bag_serial_no) unique
-- constraint below is the practical guarantee we need without disturbing that
-- old data.

BEGIN;

-- ── 1. Backfill bag_tags rows missing from prod_bagging ─────────────────────
-- bag_no is NOT NULL with no default; backfilled rows get sequential numbers
-- continuing after whatever the session already has, so they never collide.
WITH missing AS (
  SELECT t.*, ROW_NUMBER() OVER (PARTITION BY t.session_id ORDER BY COALESCE(t.printed_at, t.created_at)) AS rn
  FROM production.bag_tags t
  WHERE t.serial_number IS NOT NULL
    AND t.session_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM production.prod_bagging b WHERE b.bag_serial_no = t.serial_number
    )
), session_max AS (
  SELECT session_id, COALESCE(MAX(bag_no), 0) AS max_bag_no
  FROM production.prod_bagging
  GROUP BY session_id
)
INSERT INTO production.prod_bagging (
  id, session_id, bag_no, output_group, bag_serial_no, lot_number,
  product_type, acumatica_id, variant, kg, bagging_time, created_at,
  batch_id, work_centre
)
SELECT
  gen_random_uuid(), m.session_id,
  COALESCE(sm.max_bag_no, 0) + m.rn,
  NULL, m.serial_number, m.lot_number,
  m.product_type, m.acumatica_id, m.variant, m.weight_kg,
  COALESCE(m.printed_at, m.created_at), COALESCE(m.printed_at, m.created_at),
  m.batch_id,
  CASE m.section_id
    WHEN 'blender'   THEN 'Blender'
    WHEN 'granule'    THEN 'Granule Line'
    WHEN 'refining1'  THEN 'Refining 1'
    WHEN 'refining2'  THEN 'Refining 2'
    WHEN 'sieving'    THEN 'Sieving Tower'
    ELSE NULL
  END
FROM missing m
LEFT JOIN session_max sm ON sm.session_id = m.session_id;

-- ── 2. Uniqueness for safe upserts going forward ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prod_bagging_session_serial_uniq'
  ) THEN
    ALTER TABLE production.prod_bagging
      ADD CONSTRAINT prod_bagging_session_serial_uniq
      UNIQUE (session_id, bag_serial_no);
  END IF;
END $$;

-- ── 3. Re-point the QC views at prod_bagging ─────────────────────────────────
DROP VIEW IF EXISTS qms.v_pending_bag_qc     CASCADE;
DROP VIEW IF EXISTS qms.v_bag_qc_status      CASCADE;
DROP VIEW IF EXISTS qms.v_bag_inprocess_link CASCADE;
DROP VIEW IF EXISTS qms.v_bag_events         CASCADE;

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
