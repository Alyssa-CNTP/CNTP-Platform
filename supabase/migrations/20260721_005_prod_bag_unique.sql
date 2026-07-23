-- ============================================================
-- CNTP Production — Duplicate-bag guard (safety net behind the app fix)
-- Run in: Supabase SQL Editor (staging first, then prod)
-- Depends on: 20260611_001_production_capture.sql
-- ============================================================
--
-- The 20s autosave/flush could overlap a manual save; persist() does
-- delete-then-insert on prod_bagging/prod_debagging, and interleaved that
-- doubled every output row. The real fix is app-side (persist() is now
-- serialised). This is the belt-and-suspenders: a UNIQUE (session_id, bag_no)
-- so a future race can never duplicate again — the second insert just fails
-- instead of writing a copy. buildBag/buildDebag number bags with a single
-- per-session counter, so (session_id, bag_no) is naturally unique.
--
-- Re-runs the dedupe defensively first (in case new dupes formed since the
-- one-time cleanup) — the unique index won't build while duplicates exist.
-- ============================================================

-- ── prod_bagging ──────────────────────────────────────────────
DELETE FROM production.prod_bagging a
USING production.prod_bagging b
WHERE a.ctid > b.ctid
  AND a.session_id = b.session_id
  AND a.bag_no = b.bag_no
  AND COALESCE(a.output_group,'') = COALESCE(b.output_group,'')
  AND COALESCE(a.bag_serial_no,'') = COALESCE(b.bag_serial_no,'')
  AND a.kg = b.kg
  AND COALESCE(a.product_type,'') = COALESCE(b.product_type,'');

CREATE UNIQUE INDEX IF NOT EXISTS prod_bagging_session_bag_uidx
  ON production.prod_bagging (session_id, bag_no);

-- ── prod_debagging ────────────────────────────────────────────
DELETE FROM production.prod_debagging a
USING production.prod_debagging b
WHERE a.ctid > b.ctid
  AND a.session_id = b.session_id
  AND a.bag_no = b.bag_no
  AND COALESCE(a.bag_serial_no,'') = COALESCE(b.bag_serial_no,'')
  AND COALESCE(a.kg_nett,0) = COALESCE(b.kg_nett,0)
  AND COALESCE(a.product_type,'') = COALESCE(b.product_type,'');

CREATE UNIQUE INDEX IF NOT EXISTS prod_debagging_session_bag_uidx
  ON production.prod_debagging (session_id, bag_no);
