-- ============================================================
-- CNTP Production Capture — Shift Assignments (roster)
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260611_001_production_capture.sql
-- ============================================================
--
-- A supervisor rosters which operators work which section on a
-- given date + shift. When an operator opens the capture tablet
-- the matching assignment autofills the session header; they only
-- confirm identity with their PIN and start capturing.
--
-- One assignment per (date, shift, section). Re-assigning upserts.
-- ============================================================

DROP TABLE IF EXISTS production.shift_assignments CASCADE;

CREATE TABLE production.shift_assignments (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  date               date        NOT NULL,
  shift              text        NOT NULL
                       CHECK (shift IN ('morning','afternoon','night')),
  section_id         text        NOT NULL
                       CHECK (section_id IN (
                         'sieving','refining1','refining2',
                         'granule','blender','pasteuriser'
                       )),

  -- Rostered operators — references production.operators(id).
  -- Array (not FK) because a section can have two operators on a shift.
  operator_ids       uuid[]      NOT NULL DEFAULT '{}',

  -- Pre-filled session header values the supervisor sets at assignment time.
  lot_number         text,
  variant            text
                       CHECK (variant IN (
                         'Conventional','Organic',
                         'RA-Conventional','RA-Organic','FT-ORG'
                       )),
  production_orders  text[],
  notes              text,

  assigned_by        uuid        REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (date, shift, section_id)
);

CREATE INDEX shift_assignments_date_shift_idx
  ON production.shift_assignments(date, shift);

-- ── updated_at trigger (reuses function from migration 001) ────
CREATE TRIGGER shift_assignments_updated_at
  BEFORE UPDATE ON production.shift_assignments
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

-- ── Row Level Security ─────────────────────────────────────────
ALTER TABLE production.shift_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_shift_assignments"
  ON production.shift_assignments FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
