-- ══════════════════════════════════════════════════════════════════════════════
-- CNTP Ops — database migrations
-- Run these in the Supabase SQL editor (production schema)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. INVENTORY ITEMS ───────────────────────────────────────────────────────
-- Master item registry synced from Acumatica exports.
-- This replaces the hardcoded list in lib/data/sections.ts for the add-item
-- search — sections.ts still defines the DEFAULT items shown per section.

CREATE TABLE IF NOT EXISTS production.inventory_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id  text NOT NULL UNIQUE,   -- Acumatica base ID, e.g. "10LGEF"
  description   text NOT NULL,          -- Human-readable name from Acumatica
  item_class    text,                   -- e.g. "LEAF", "DUST", "STICK"
  item_class_id text,                   -- Acumatica class code
  uom           text DEFAULT 'KG',      -- unit of measure
  active        boolean NOT NULL DEFAULT true,
  imported_at   timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_items_inventory_id_idx
  ON production.inventory_items (inventory_id);

CREATE INDEX IF NOT EXISTS inventory_items_description_idx
  ON production.inventory_items USING gin(to_tsvector('english', description));

-- ── 2. PRODUCTION SESSIONS ───────────────────────────────────────────────────
-- One row per section per shift per day.

CREATE TABLE IF NOT EXISTS production.prod_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id     text NOT NULL,
  section_name   text NOT NULL,
  date           date NOT NULL,
  shift          text NOT NULL CHECK (shift IN ('morning','afternoon','night')),
  operator_names text[],
  supervisor_name text,
  status         text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','submitted','approved')),
  submitted_at   timestamptz,
  submitted_by   uuid REFERENCES auth.users(id),
  approved_by    uuid REFERENCES auth.users(id),
  approved_at    timestamptz,
  notes          text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  UNIQUE (section_id, date, shift)
);

-- ── 3. DEBAGGING (input bags) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production.prod_debagging (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES production.prod_sessions(id) ON DELETE CASCADE,
  sequence_no    integer NOT NULL,
  bag_serial_no  text,
  lot_number     text,
  product_type   text,
  variant        text CHECK (variant IN ('C','O','RC','RO')),
  kg_gross       numeric(10,3),
  kg_nett        numeric(10,3) NOT NULL,
  delivery_date  date,
  notes          text,
  created_at     timestamptz DEFAULT now()
);

-- ── 4. BAGGING (output bags) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production.prod_bagging (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES production.prod_sessions(id) ON DELETE CASCADE,
  output_group   text NOT NULL DEFAULT 'B',  -- B, C, or D for Refining; single for others
  sequence_no    integer NOT NULL,
  bag_serial_no  text,
  lot_number     text,
  product_type   text NOT NULL,
  inventory_id   text,
  variant        text CHECK (variant IN ('C','O','RC','RO')),
  kg             numeric(10,3) NOT NULL,
  bagging_time   time,
  created_at     timestamptz DEFAULT now()
);

-- ── 5. MASS BALANCE ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production.prod_mass_balance (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL UNIQUE REFERENCES production.prod_sessions(id) ON DELETE CASCADE,
  total_input_kg    numeric(10,3),
  total_output_b_kg numeric(10,3),
  total_output_c_kg numeric(10,3),
  total_output_d_kg numeric(10,3),
  balance_kg        numeric(10,3),    -- A - B - C - D
  yield_pct         numeric(5,2),
  within_tolerance  boolean,
  tolerance_kg      numeric(10,3) DEFAULT 15,
  calculated_at     timestamptz DEFAULT now()
);

-- ── 6. APP ROLES TABLE ───────────────────────────────────────────────────────
-- Stores which role each Supabase Auth user has in this app.
-- Created here because it does not exist yet in the database.

CREATE TABLE IF NOT EXISTS production.app_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('admin','supervisor','management','operator')),
  created_at timestamptz DEFAULT now()
);

-- ── 7. USER PROFILES VIEW ─────────────────────────────────────────────────────
-- Joins auth.users with production.app_roles to show real names and emails.

SET search_path TO production, public, auth;

CREATE OR REPLACE VIEW production.user_profiles AS
SELECT
  u.id,
  u.email,
  COALESCE(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1)
  ) AS display_name,
  r.role,
  r.created_at AS role_assigned_at
FROM auth.users u
LEFT JOIN production.app_roles r ON r.user_id = u.id
WHERE u.deleted_at IS NULL;

-- Grant read access to authenticated users
GRANT SELECT ON production.user_profiles TO authenticated;
