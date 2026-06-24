-- ============================================================
-- CNTP Shared Staff Directory — production.employees
-- Run in: Supabase SQL Editor (staging first, then production).
-- Depends on: 20260611_001_production_capture.sql (production.set_updated_at),
--             20260611_004_operators.sql, 20260622_001_roster.sql
-- ============================================================
--
-- A SINGLE company-wide people registry that every module can reference:
-- production operators (Capture), maintenance technicians, cleaners, store, QC,
-- H&S. It lives in the `production` schema purely to reuse that schema's
-- working RLS/grants — it is NOT production-only in meaning.
--
-- This migration is ADDITIVE. It does not change Capture (`production.operators`)
-- or Maintenance (`maintenance.duty_roster`) behaviour — those keep working
-- exactly as before. Cross-module consumption (roster -> capture/maintenance)
-- is a later phase. Here we only: create the registry, link the roster to it,
-- and backfill an employee row for every existing operator.
-- ============================================================

CREATE TABLE IF NOT EXISTS production.employees (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name          text        NOT NULL,                       -- canonical full name
  display_name  text,                                       -- short/preferred name
  department    text        NOT NULL DEFAULT 'production'   -- production|store|qc|cleaning|maintenance|hs|admin
                  CHECK (department IN ('production','store','qc','cleaning','maintenance','hs','admin')),
  job_title     text,                                       -- e.g. 'Sieving Tower', 'Maintenance Tech'
  skills        text[]      NOT NULL DEFAULT '{}',           -- cert/skill codes: FL, ER, FF, FA…
  phone         text,                                       -- E.164 where known (for WhatsApp/SMS later)
  active        boolean     NOT NULL DEFAULT true,
  -- Link to the Capture operator record, when this person is also a floor operator.
  operator_id   uuid        REFERENCES production.operators(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One employee row per linked operator; case-insensitive name lookup support.
CREATE UNIQUE INDEX IF NOT EXISTS employees_operator_idx
  ON production.employees(operator_id) WHERE operator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS employees_name_lower_idx
  ON production.employees(lower(name));
CREATE INDEX IF NOT EXISTS employees_department_idx
  ON production.employees(department) WHERE active;

DROP TRIGGER IF EXISTS employees_updated_at ON production.employees;
CREATE TRIGGER employees_updated_at
  BEFORE UPDATE ON production.employees
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

ALTER TABLE production.employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_employees" ON production.employees;
CREATE POLICY "authenticated_all_employees"
  ON production.employees FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Link the roster to the directory ─────────────────────────────────────────
ALTER TABLE production.roster_entries
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES production.employees(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS roster_entries_employee_idx
  ON production.roster_entries(employee_id);

-- ── Backfill: every existing Capture operator becomes an employee ────────────
-- Production operators map straight in (department = production, linked by
-- operator_id). Re-runnable: only inserts operators not yet represented.
INSERT INTO production.employees (name, display_name, department, skills, active, operator_id)
SELECT o.name, o.display_name, 'production', '{}'::text[], o.active, o.id
FROM production.operators o
WHERE NOT EXISTS (
  SELECT 1 FROM production.employees e WHERE e.operator_id = o.id
);
