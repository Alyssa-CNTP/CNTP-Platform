-- ============================================================
-- CNTP Supervisor Roster — whole-site shift layout
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260611_001_production_capture.sql (production.set_updated_at)
-- ============================================================
--
-- The roster is the monthly "Shift Layout": every role on site (production,
-- store, QC, cleaning, maintenance, H&S) across two shifts — Day (07h00–16h00)
-- and Night (16h00–01h00) — for a given date range, with skill tags on each
-- person.
--
-- This is ADDITIVE and stands entirely apart from the production-capture
-- section-assignment flow (production.shift_assignments). Nothing here alters
-- that table, its data, or its logic.
-- ============================================================

-- ── Role catalogue (the rows of the sheet) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS production.roster_roles (
  key         text        PRIMARY KEY,         -- stable slug, e.g. 'sieving_tower'
  name        text        NOT NULL,
  category    text        NOT NULL DEFAULT 'production',
  sort_order  integer     NOT NULL DEFAULT 0,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Roster periods (one date-range block — a week on the sheet) ───────────────
CREATE TABLE IF NOT EXISTS production.roster_periods (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text        NOT NULL,            -- e.g. '22–26 June'
  start_date  date        NOT NULL,
  end_date    date        NOT NULL,
  day_label   text        NOT NULL DEFAULT '07h00 till 16h00',
  night_label text        NOT NULL DEFAULT '16h00 till 01h00',
  notes       text,
  created_by  uuid        REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS roster_periods_dates_idx
  ON production.roster_periods(start_date, end_date);

-- ── Roster entries (a person placed in a role + shift within a period) ────────
CREATE TABLE IF NOT EXISTS production.roster_entries (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id   uuid        NOT NULL REFERENCES production.roster_periods(id) ON DELETE CASCADE,
  role_key    text        NOT NULL,            -- references roster_roles.key (loose)
  shift       text        NOT NULL CHECK (shift IN ('day','night')),
  operator_id uuid        REFERENCES production.operators(id) ON DELETE SET NULL,  -- linked employee
  person_name text        NOT NULL,            -- denormalised display name (also the fallback if unlinked)
  tags        text[]      NOT NULL DEFAULT '{}',  -- skill codes: FL, ER, FF…
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Additive for any environment where the table predates the employee link.
ALTER TABLE production.roster_entries
  ADD COLUMN IF NOT EXISTS operator_id uuid REFERENCES production.operators(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS roster_entries_period_idx
  ON production.roster_entries(period_id);
CREATE INDEX IF NOT EXISTS roster_entries_period_role_shift_idx
  ON production.roster_entries(period_id, role_key, shift);
CREATE INDEX IF NOT EXISTS roster_entries_operator_idx
  ON production.roster_entries(operator_id);

-- ── updated_at triggers (reuse function from migration 001) ───────────────────
DROP TRIGGER IF EXISTS roster_periods_updated_at ON production.roster_periods;
CREATE TRIGGER roster_periods_updated_at
  BEFORE UPDATE ON production.roster_periods
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

DROP TRIGGER IF EXISTS roster_entries_updated_at ON production.roster_entries;
CREATE TRIGGER roster_entries_updated_at
  BEFORE UPDATE ON production.roster_entries
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

-- ── Row Level Security (matches the existing production-schema pattern) ───────
ALTER TABLE production.roster_roles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.roster_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.roster_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_roster_roles"   ON production.roster_roles;
CREATE POLICY "authenticated_all_roster_roles"
  ON production.roster_roles   FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_all_roster_periods" ON production.roster_periods;
CREATE POLICY "authenticated_all_roster_periods"
  ON production.roster_periods FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_all_roster_entries" ON production.roster_entries;
CREATE POLICY "authenticated_all_roster_entries"
  ON production.roster_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Seed the role catalogue (full site roster, in sheet order) ────────────────
INSERT INTO production.roster_roles (key, name, category, sort_order) VALUES
  ('rooibos_supervisor', 'Rooibos Supervisor',          'production',  10),
  ('pasteuriser_op',     'Pasteuriser Operator',        'production',  20),
  ('bagging_vacuum',     'Bagging / Vacuum',            'production',  30),
  ('scanning_boxes',     'Scanning Boxes',              'production',  40),
  ('granule_operator',   'Granule Operator',            'production',  50),
  ('granule',            'Granule',                     'production',  60),
  ('refining_1',         'Refining 1',                  'production',  70),
  ('sieving_tower',      'Sieving Tower',               'production',  80),
  ('blender',            'Blender',                     'production',  90),
  ('refining_2',         'Refining 2',                  'production', 100),
  ('rosehip',            'Rosehip',                     'production', 110),
  ('store_supervisor',   'Store Supervisor',            'store',      200),
  ('store_operator',     'Store Operator',              'store',      210),
  ('forklift_driver',    'Forklift Driver',             'store',      220),
  ('qc_supervisor',      'QC Supervisor',               'qc',         300),
  ('qc',                 'QC',                          'qc',         310),
  ('lab_analyst',        'Lab Analyst',                 'qc',         320),
  ('incoming_goods_qc',  'Incoming Goods QC Inspector', 'qc',         330),
  ('cleaner_operator',   'Cleaner Operator',            'cleaning',   400),
  ('cleaner',            'Cleaner',                     'cleaning',   410),
  ('maintenance_tech',   'Maintenance Tech',            'maintenance',500),
  ('maintenance_asst',   'Maintenance Assistant',       'maintenance',510),
  ('hs_assistant',       'H&S Assistant',               'hs',         600)
ON CONFLICT (key) DO NOTHING;
