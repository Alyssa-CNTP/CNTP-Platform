-- ============================================================
-- CNTP Production Capture — Cleaning (compliance-grade)
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: migrations 001, 004
-- ============================================================
--
-- Compliance-grade cleaning capture (21 CFR Part 11 / cGMP intent):
--  • cleaning_stations  — QR/barcode registry for equipment/rooms (proof of presence)
--  • cleaning_records   — one cleaning event per section/shift/date, with operator
--                         + supervisor re-authenticated sign-offs
--  • cleaning_logs      — APPEND-ONLY audit trail: every confirm / exception / scan /
--                         photo / signature is a permanent row. No UPDATE/DELETE
--                         granted to app roles, so the trail itself can't be altered.
--
-- Cleaning task definitions (with daily/weekly/monthly frequency) live in code
-- (lib/production/cleaning-config.ts) and are referenced here by task_key.
-- ============================================================

-- ── cleaning_stations — QR-tagged equipment / rooms ───────────
CREATE TABLE IF NOT EXISTS production.cleaning_stations (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id  text        NOT NULL,
  area        text        NOT NULL,           -- e.g. 'Sieving', 'De-bagging', 'Bagging'
  qr_code     text        NOT NULL UNIQUE,    -- printed on the station label
  label       text        NOT NULL,           -- human-readable name
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cleaning_stations_section_idx ON production.cleaning_stations(section_id);

-- ── cleaning_records — one cleaning event per section/shift ───
CREATE TABLE IF NOT EXISTS production.cleaning_records (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id            uuid        REFERENCES production.prod_sessions(id) ON DELETE SET NULL,
  section_id            text        NOT NULL,
  date                  date        NOT NULL,
  shift                 text        NOT NULL CHECK (shift IN ('morning','afternoon','night')),

  status                text        NOT NULL DEFAULT 'in_progress'
                          CHECK (status IN ('in_progress','operator_signed','supervisor_verified')),

  -- Re-authenticated electronic signatures (PIN placeholder; upgradeable)
  operator_id           uuid,
  operator_name         text,
  operator_signed_at    timestamptz,
  supervisor_name       text,
  supervisor_verified_at timestamptz,

  exceptions_count      integer     NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (section_id, date, shift)
);
CREATE INDEX IF NOT EXISTS cleaning_records_section_date_idx ON production.cleaning_records(section_id, date);

CREATE TRIGGER cleaning_records_updated_at
  BEFORE UPDATE ON production.cleaning_records
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

-- ── cleaning_logs — IMMUTABLE append-only audit trail ─────────
CREATE TABLE IF NOT EXISTS production.cleaning_logs (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id   uuid        NOT NULL REFERENCES production.cleaning_records(id) ON DELETE CASCADE,
  action      text        NOT NULL
                CHECK (action IN (
                  'area_confirmed','task_exception','station_scan',
                  'photo','operator_sign','supervisor_verify'
                )),
  area        text,
  task_key    text,
  detail      jsonb       NOT NULL DEFAULT '{}',   -- reason, qr_code, photo ref, etc.
  actor_id    uuid,
  actor_name  text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cleaning_logs_record_idx ON production.cleaning_logs(record_id);

-- ── Grants ────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA production TO authenticated, service_role;
GRANT ALL          ON production.cleaning_stations TO authenticated, service_role;
GRANT ALL          ON production.cleaning_records  TO authenticated, service_role;
-- Audit log: INSERT + SELECT only for the app. No UPDATE/DELETE → the trail
-- cannot be modified or erased from the application layer.
GRANT SELECT, INSERT ON production.cleaning_logs   TO authenticated;
GRANT ALL            ON production.cleaning_logs   TO service_role;

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE production.cleaning_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.cleaning_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.cleaning_logs     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_cleaning_stations" ON production.cleaning_stations;
CREATE POLICY "auth_all_cleaning_stations" ON production.cleaning_stations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_all_cleaning_records" ON production.cleaning_records;
CREATE POLICY "auth_all_cleaning_records" ON production.cleaning_records
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Immutable: authenticated may read and insert, but there is deliberately
-- NO update or delete policy, so those operations are denied.
DROP POLICY IF EXISTS "cleaning_logs_select" ON production.cleaning_logs;
CREATE POLICY "cleaning_logs_select" ON production.cleaning_logs
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "cleaning_logs_insert" ON production.cleaning_logs;
CREATE POLICY "cleaning_logs_insert" ON production.cleaning_logs
  FOR INSERT TO authenticated WITH CHECK (true);
