-- ============================================================
-- CNTP Production Capture — Smart Checks Engine (compliance-grade)
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: migrations 001 (prod_sessions, set_updated_at), 006 (cleaning pattern)
-- ============================================================
--
-- Machine start-up / running / shut-down verification, built as a generic,
-- config-driven engine (lib/production/checks-config.ts) so Sieving is authored
-- first and other sections inherit it by config only. Mirrors the cleaning model:
--   • check_records  — one checks record per section/shift/date, with operator +
--                      supervisor re-authenticated sign-offs and an AI shift summary
--   • check_events   — APPEND-ONLY audit trail: every reading / confirm / exception /
--                      photo / auto-snapshot / signature is a permanent row. No
--                      UPDATE/DELETE granted to app roles → the trail can't be altered.
--   • check_specs    — machine-parameter ranges (VSD / scale / screen) as one
--                      supervisor-editable source of truth (product/quality ranges
--                      are resolved live from qms.customer_specs in code).
-- ============================================================

-- ── check_records — one checks record per section/shift ───────
CREATE TABLE IF NOT EXISTS production.check_records (
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

  ai_summary            text,        -- Gemini plain-English shift audit summary
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (section_id, date, shift)
);
CREATE INDEX IF NOT EXISTS check_records_section_date_idx ON production.check_records(section_id, date);

CREATE TRIGGER check_records_updated_at
  BEFORE UPDATE ON production.check_records
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

-- ── check_events — IMMUTABLE append-only audit trail ──────────
CREATE TABLE IF NOT EXISTS production.check_events (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id     uuid        NOT NULL REFERENCES production.check_records(id) ON DELETE CASCADE,

  phase         text        NOT NULL CHECK (phase IN ('startup','running','shutdown')),
  check_key     text        NOT NULL,
  check_label   text,
  kind          text        NOT NULL CHECK (kind IN ('confirm','number','text','scale','massbalance')),

  value_num     numeric,
  value_text    text,
  unit          text,
  status        text        NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','flagged','na','fail')),
  reason        text,

  spec_min      numeric,
  spec_max      numeric,
  production_idx integer,            -- which production (change-over) this snapshot belongs to
  photo_path    text,
  source        text        NOT NULL DEFAULT 'keypad' CHECK (source IN ('keypad','photo','auto','sign')),
  maintenance_card_id integer,       -- link to maintenance.job_cards raised from a failed check

  actor_id      uuid,
  actor_name    text,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS check_events_record_idx ON production.check_events(record_id);

-- ── check_specs — machine-parameter ranges (supervisor-editable) ──
CREATE TABLE IF NOT EXISTS production.check_specs (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id  text        NOT NULL,
  check_key   text        NOT NULL,
  min         numeric,
  max         numeric,
  target      numeric,                 -- e.g. scale tolerance (± kg)
  unit        text,
  note        text,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_id, check_key)
);

CREATE TRIGGER check_specs_updated_at
  BEFORE UPDATE ON production.check_specs
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

-- Seed sieving machine parameters (ranges editable later by supervisors).
INSERT INTO production.check_specs (section_id, check_key, min, max, target, unit, note) VALUES
  ('sieving', 'infeed_vsd',           10,   20,   NULL, 'Hz', 'VSD infeed speed — hourly reading'),
  ('sieving', 'scale_verification',   NULL, NULL, 0.1,  'kg', 'Actual must be within ± target kg of the standard'),
  ('sieving', 'indent_screen_speed',  NULL, NULL, NULL, 'rpm','Record actual; range set by engineering'),
  ('sieving', 'indent_screen_angle',  NULL, NULL, NULL, '°',  'Record actual; range set by engineering')
ON CONFLICT (section_id, check_key) DO NOTHING;

-- ── Grants ────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA production TO authenticated, service_role;
GRANT ALL          ON production.check_records TO authenticated, service_role;
GRANT ALL          ON production.check_specs   TO authenticated, service_role;
-- Audit log: INSERT + SELECT only for the app. No UPDATE/DELETE → the trail
-- cannot be modified or erased from the application layer.
GRANT SELECT, INSERT ON production.check_events TO authenticated;
GRANT ALL            ON production.check_events TO service_role;

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE production.check_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.check_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.check_specs   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_check_records" ON production.check_records;
CREATE POLICY "auth_all_check_records" ON production.check_records
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_all_check_specs" ON production.check_specs;
CREATE POLICY "auth_all_check_specs" ON production.check_specs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Immutable: authenticated may read and insert, but there is deliberately
-- NO update or delete policy, so those operations are denied.
DROP POLICY IF EXISTS "check_events_select" ON production.check_events;
CREATE POLICY "check_events_select" ON production.check_events
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "check_events_insert" ON production.check_events;
CREATE POLICY "check_events_insert" ON production.check_events
  FOR INSERT TO authenticated WITH CHECK (true);
