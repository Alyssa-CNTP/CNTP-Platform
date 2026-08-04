-- ============================================================
-- CNTP — Granule Line "Carry-over" ledger for leftover dust
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- Depends on: 20260611_001_production_capture.sql (production.prod_sessions)
-- ============================================================
--
-- The afternoon shift's mass-balance leftover (H − G) on the Granule Line is
-- dust that genuinely carries over to be fed into tomorrow's blend — today
-- that figure isn't tracked anywhere durable (production.prod_mass_balance is
-- one row per session, not a running ledger; see the capture page's own
-- comment on the bucket-elevator carryover, which is a same-day morning/
-- afternoon merge, not a persisted table either).
--
-- This is deliberately an APPEND-ONLY ledger (not a single mutable
-- current-balance row) so there's an audit trail of every carry-over that was
-- generated and every carry-over that was later consumed — and so it
-- generalizes to other sections later without a schema change, just a new
-- section_id value.
--
-- item_key is the exact dust type string ('SG Dust' / 'SF Dust') so SG and SF
-- leftovers are never summed together — a query always filters by the exact
-- item_key it cares about, never aggregates across item_key values.
-- ============================================================

CREATE TABLE IF NOT EXISTS production.dust_carryover_log (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id  text        NOT NULL,
  item_key    text        NOT NULL,
  kind        text        NOT NULL CHECK (kind IN ('generated','consumed')),
  kg          numeric     NOT NULL CHECK (kg > 0),
  date        date        NOT NULL,
  shift       text        NOT NULL,
  session_id  uuid        REFERENCES production.prod_sessions(id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Outstanding balance per (section_id, item_key) =
--   SUM(kg WHERE kind = 'generated') - SUM(kg WHERE kind = 'consumed')

CREATE INDEX IF NOT EXISTS dust_carryover_log_section_item_idx
  ON production.dust_carryover_log(section_id, item_key);

GRANT ALL ON production.dust_carryover_log TO authenticated, service_role;

ALTER TABLE production.dust_carryover_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_dust_carryover_log" ON production.dust_carryover_log;
CREATE POLICY "auth_all_dust_carryover_log" ON production.dust_carryover_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
