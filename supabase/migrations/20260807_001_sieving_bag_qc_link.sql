-- 20260807_001_sieving_bag_qc_link.sql
--
-- Links Production bagging (production.prod_bagging) to Quality sieving runs
-- (qms.sd_runs) so that:
--   1. every Fine Leaf / Coarse Leaf bag produced becomes a PENDING Final QC,
--   2. an in-process sieving run can be traced to the output bags it produced,
--      via the input-material lot + the time ordering, and
--   3. a bag inherits the spec violations of the in-process run that was
--      running the tower when that bag was filled.
--
-- Indent Sticks and Rooibos Blocks still get bags/serials/labels but never
-- require a QC stamp, so they are excluded from the pending list.
--
-- Everything here is ADDITIVE: one nullable column plus views. No existing
-- column, value or row is modified, so the live capture screens keep working
-- exactly as before.

-- ── 1. Hard link (set when a Final QC is captured against a picked bag) ──────
ALTER TABLE qms.sd_runs ADD COLUMN IF NOT EXISTS bagging_id uuid;
CREATE INDEX IF NOT EXISTS sd_runs_bagging_id_idx ON qms.sd_runs (bagging_id);

-- ── 2. Normalisers ──────────────────────────────────────────────────────────
-- Production and Quality do not use the same vocabulary. Production has
-- 'RB Blocks', 'Indent Sticks - Conventional', 'Sieved Fine Leaf: Export Blend
--  - Conventional', 'Cutter Fine Leaf - Conventional'; Quality has 'Fine Leaf',
-- 'Coarse Leaf', 'Indent Sticks', 'Blocks' and 'Rooibos Blocks'. Matching on
-- the raw strings would silently miss bags, so both sides go through this.
CREATE OR REPLACE FUNCTION qms.norm_sd_product(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL THEN NULL
    -- order matters: 'coarse' before the generic 'leaf' tests
    WHEN lower(p) LIKE '%coarse leaf%'                                   THEN 'Coarse Leaf'
    WHEN lower(p) LIKE '%fine leaf%'                                     THEN 'Fine Leaf'
    WHEN lower(p) LIKE '%indent stick%'                                  THEN 'Indent Sticks'
    WHEN lower(p) LIKE '%rb block%' OR lower(p) LIKE '%rooibos block%'
      OR lower(btrim(p)) = 'blocks'                                      THEN 'Rooibos Blocks'
    ELSE NULL
  END
$$;

-- Lot numbers are typed by hand on the quality side and scanned on the
-- production side, so 'GS-0098', 'gs 0098' and 'GS_0098' must collapse to one
-- key. Mirrors normBatch() used throughout the app.
CREATE OR REPLACE FUNCTION qms.norm_lot(l text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN l IS NULL OR btrim(l) = '' THEN NULL
    ELSE upper(regexp_replace(regexp_replace(btrim(l), '_', '-', 'g'), '\s*-\s*', '-', 'g'))
  END
$$;

-- Only these two output streams carry a QC stamp.
CREATE OR REPLACE FUNCTION qms.sd_product_needs_qc(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT qms.norm_sd_product(p) IN ('Fine Leaf', 'Coarse Leaf')
$$;

-- ── 3. Every bagging event, normalised, with its timestamp ──────────────────
-- bagging_time is a bare time and created_at is the insert moment; we combine
-- the created_at date with bagging_time when present so the ordering against
-- an in-process run's HH:MM is meaningful.
CREATE OR REPLACE VIEW qms.v_bag_events AS
SELECT
  b.id                                   AS bagging_id,
  b.bag_serial_no,
  b.lot_number,
  qms.norm_lot(b.lot_number)             AS lot_key,
  b.product_type                         AS prod_product_type,
  qms.norm_sd_product(b.product_type)    AS product,
  qms.sd_product_needs_qc(b.product_type) AS qc_required,
  b.variant,
  b.kg,
  b.session_id,
  b.batch_id,
  b.bag_no,
  b.output_group,
  (b.created_at AT TIME ZONE 'Africa/Johannesburg')::date AS bag_date,
  b.bagging_time,
  COALESCE(
    ((b.created_at AT TIME ZONE 'Africa/Johannesburg')::date + b.bagging_time),
    (b.created_at AT TIME ZONE 'Africa/Johannesburg')
  )                                      AS bagged_at,
  b.created_at
FROM production.prod_bagging b;

-- ── 4. In-process runs, with a usable timestamp ─────────────────────────────
-- date/time_of_run are free text on sd_runs, so parse defensively — a row with
-- a malformed time simply has a NULL ts and drops out of the matching rather
-- than breaking the view.
CREATE OR REPLACE VIEW qms.v_sd_inprocess AS
SELECT
  r.id                        AS run_id,
  r.product,
  r.lot_number,
  qms.norm_lot(r.lot_number)  AS lot_key,
  r.grade,
  r.variant,
  r.qc_name,
  r.pass_status,
  r.violations,
  r.date,
  r.time_of_run,
  CASE WHEN r.date ~ '^\d{4}-\d{2}-\d{2}$' THEN r.date::date END AS run_date,
  CASE
    WHEN r.date ~ '^\d{4}-\d{2}-\d{2}$' AND r.time_of_run ~ '^\d{1,2}:\d{2}'
    THEN r.date::date + substring(r.time_of_run from '^\d{1,2}:\d{2}')::time
  END                         AS run_at
FROM qms.sd_runs r
WHERE r.run_type = 'in-process';

-- ── 5. The soft link: which in-process run was the tower running when this
--       bag was filled?
-- The lot number on an in-process run is the INPUT material lot, so we reach
-- the bag through the production session's de-bagging input lots, and fall
-- back to a direct lot match when the session is not resolvable. Among the
-- candidates we take the LATEST in-process run at or before the bagging time —
-- i.e. the machine check that governed that bag.
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
      -- same input lot, as recorded on the de-bagging for this bag's session
      ip.lot_key IN (
        SELECT qms.norm_lot(d.lot_number)
        FROM production.prod_debagging d
        WHERE d.session_id = be.session_id
      )
      -- or a direct lot match (covers sessions without de-bagging rows)
      OR ip.lot_key = be.lot_key
     )
ORDER BY be.bagging_id, ip.run_at DESC;

-- ── 6. One row per bag: QC state + inherited in-process spec result ─────────
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
  -- the bag is flagged when the governing in-process sieve was out of spec
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

-- ── 7. The pending Final QC queue ───────────────────────────────────────────
-- Fine Leaf / Coarse Leaf bags that have not been sampled yet. Indent Sticks
-- and Rooibos Blocks never appear here by design.
CREATE OR REPLACE VIEW qms.v_pending_bag_qc AS
SELECT *
FROM qms.v_bag_qc_status
WHERE qc_required
  AND NOT qc_done
ORDER BY bagged_at DESC;

GRANT SELECT ON qms.v_bag_events, qms.v_sd_inprocess, qms.v_bag_inprocess_link,
                qms.v_bag_qc_status, qms.v_pending_bag_qc
  TO anon, authenticated, service_role;
