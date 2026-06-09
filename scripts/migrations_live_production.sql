-- ══════════════════════════════════════════════════════════════════════════════
-- Live Production Barcode System — Migration
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor)
-- ══════════════════════════════════════════════════════════════════════════════

-- Operators: managed by supervisors/IT. Used for PIN-based session login.
-- PIN is stored as plain text for the prototype — hash before go-live.
CREATE TABLE IF NOT EXISTS production.operators (
  id           uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  name         text    NOT NULL,
  pin          text    NOT NULL,
  role         text    NOT NULL DEFAULT 'operator',  -- 'operator' | 'supervisor'
  section_ids  text[]  DEFAULT '{}',
  active       boolean DEFAULT true,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- Raw material bags: 500kg farm bags registered at the Sieving Tower.
-- No barcode on arrival — operator enters details from the physical tag.
CREATE TABLE IF NOT EXISTS production.raw_material_bags (
  id               uuid      DEFAULT gen_random_uuid() PRIMARY KEY,
  bag_number       text      NOT NULL,
  lot_number       text      NOT NULL,
  producer         text,
  date_of_receipt  date      NOT NULL DEFAULT CURRENT_DATE,
  grade            text,           -- 'A' | 'B' | 'C'
  variant          text      NOT NULL DEFAULT 'CON',  -- 'CON' | 'ORG' | 'RA CON' | 'RA ORG'
  dry              boolean   DEFAULT false,
  third_party      boolean   DEFAULT false,
  weight_kg        numeric   NOT NULL,
  leaf_shade       text,
  bulk_density     text,
  pa_level         text,           -- 'Low' | 'High'
  serial_number    text      UNIQUE,  -- system-generated when registered at sieving
  session_id       text,
  registered_by    uuid,
  created_at       timestamptz DEFAULT now()
);

-- Serial sequences: used for upgradeable DB-side serial number generation.
-- Prototype uses client-side generation. Upgrade: call this table from an API route.
CREATE TABLE IF NOT EXISTS production.serial_sequences (
  section_id  text NOT NULL,
  date        date NOT NULL DEFAULT CURRENT_DATE,
  last_seq    integer DEFAULT 0,
  PRIMARY KEY (section_id, date)
);

-- Timesheets: line start/stop, downtime, failure areas, and production details per session.
CREATE TABLE IF NOT EXISTS production.timesheets (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id        text        NOT NULL UNIQUE,  -- FK to prod_sessions.id
  section_id        text        NOT NULL,
  date              date        NOT NULL DEFAULT CURRENT_DATE,
  shift             text        NOT NULL,
  line_start        time,
  line_stop         time,
  downtime_minutes  integer,
  material_produced text,
  speed_setting     text,
  invertor_setting  text,       -- pasteuriser only
  failure_areas     text[],     -- multi-select from predefined list
  updated_at        timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now()
);

-- ── Seed operator data (update names and PINs before go-live) ────────────────
-- INSERT INTO production.operators (name, pin, role, section_ids, active) VALUES
--   ('Operator One',   '1234', 'operator',   ARRAY['sieving','refining1'], true),
--   ('Operator Two',   '5678', 'operator',   ARRAY['granule','blender'], true),
--   ('Operator Three', '4321', 'operator',   ARRAY['pasteuriser'], true),
--   ('Supervisor One', '9999', 'supervisor', ARRAY['sieving','refining1','refining2','granule','blender','pasteuriser'], true);
