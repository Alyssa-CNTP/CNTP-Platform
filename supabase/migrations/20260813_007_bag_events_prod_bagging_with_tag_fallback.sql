-- 20260813_007_bag_events_prod_bagging_with_tag_fallback.sql
--
-- Keep production.prod_bagging as the source of the bag-QC views (and
-- bagging_time as the time, in SAST) — as requested — but stop a physically
-- printed bag from ever being invisible to Quality when prod_bagging happens
-- not to have it.
--
-- Why this is needed. On production today (2026-08-13) the Sieving Tower
-- bagged and printed 21 bags — STFL-130826-001..010, STCL-130826-001..006 and
-- others — every one of them present in production.bag_tags, and NOT ONE of
-- them in production.prod_bagging (that table's last Sieving Tower row was
-- 2026-08-12, while Blender/Granule/Refining all wrote normally today). The
-- Quality sieving screen therefore showed 0 bags awaiting QC on the live site
-- while staging, with the same code, showed 10.
--
-- prod_bagging is not an append-only record of bags: it is a mirror of the
-- capture screen's draft_data, rewritten by persist() on every save. The
-- session's draft_data saved fine all day (prod_sessions.updated_at kept
-- advancing) while the bagging write that follows it did not land, so the
-- mirror silently drifted to empty for that section. That failure mode is
-- invisible to the operator — nothing in the capture UI looks wrong — and it
-- costs Quality the entire pending queue for the day.
--
-- Rather than depend on that write always succeeding, v_bag_events now reads
-- prod_bagging FIRST and falls back to bag_tags only for serials prod_bagging
-- does not have. So:
--   * prod_bagging remains the source and bagging_time remains the timestamp
--     for every bag it holds — nothing about the requested behaviour changes;
--   * a bag that was genuinely printed still reaches the QC queue even if the
--     mirror write for its session failed;
--   * the link is complete in both directions on the serial — every serial in
--     either table resolves to exactly one bag event, keyed on the serial.
--
-- bagging_id stays prod_bagging.id where the row exists (so sd_runs already
-- linked by bagging_id keep resolving), and md5(serial)::uuid for fallback
-- rows — deterministic and permanent, since the serial never changes. The
-- serial-number match in v_bag_qc_status covers a run that was signed off
-- against one id and later appears under the other.

BEGIN;

DROP VIEW IF EXISTS qms.v_pending_bag_qc     CASCADE;
DROP VIEW IF EXISTS qms.v_bag_qc_status      CASCADE;
DROP VIEW IF EXISTS qms.v_bag_inprocess_link CASCADE;
DROP VIEW IF EXISTS qms.v_bag_events         CASCADE;

CREATE OR REPLACE VIEW qms.v_bag_events AS
-- 1. prod_bagging — the source. bagging_time is the bag's real instant;
--    bag_date/bagged_at are it rendered as SAST wall-clock.
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
  b.created_at,
  'prod_bagging'::text                    AS bag_source
FROM production.prod_bagging b

UNION ALL

-- 2. Fallback: bags that were printed but whose prod_bagging mirror row is
--    missing. printed_at/created_at is the moment the operator secured the
--    bag, which is the same instant bagging_time would have carried.
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
  NULL::integer                           AS bag_no,       -- not tracked on bag_tags
  NULL::text                              AS output_group, -- not tracked on bag_tags
  (COALESCE(t.printed_at, t.created_at) AT TIME ZONE 'Africa/Johannesburg')::date AS bag_date,
  COALESCE(t.printed_at, t.created_at)    AS bagging_time,
  (COALESCE(t.printed_at, t.created_at) AT TIME ZONE 'Africa/Johannesburg')       AS bagged_at,
  t.created_at,
  'bag_tags_fallback'::text               AS bag_source
FROM production.bag_tags t
WHERE t.serial_number IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM production.prod_bagging b
     WHERE b.bag_serial_no = t.serial_number
  );

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
      -- the serial match also covers a run linked under the other id, so a
      -- bag that moves between the two branches keeps its sign-off
      fr.bagging_id = be.bagging_id
      OR (be.bag_serial_no IS NOT NULL
          AND upper(btrim(fr.serial_number)) = upper(btrim(be.bag_serial_no)))
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

NOTIFY pgrst, 'reload schema';
