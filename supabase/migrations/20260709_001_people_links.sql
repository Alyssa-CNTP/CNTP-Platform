-- ============================================================
-- People links — production.employees as the canonical person
-- Run in: Supabase SQL Editor (staging first, then production)
-- ============================================================
--
-- CNTP has three "person" surfaces that only partly link today:
--   - production.employees   (Staff Directory — the Shift Roster's source)
--   - production.operators   (PIN login for the Capture floor app)
--   - shared.app_roles       (email login + role/permissions)
--
-- The only existing link is employees.operator_id -> operators.id (one
-- direction). shared.app_roles has no link to an employee at all, so a
-- login account and a staff record can silently drift apart, and there is
-- no single place to trace "who is this login/PIN actually for".
--
-- This migration adds the missing links and backfills them from what
-- already exists. It does not change any RLS or application behaviour —
-- the new columns are additive and nullable.
-- ============================================================

-- ── production.operators.employee_id ──────────────────────────────────────
-- Authoritative direction going forward: an operator points at its employee.
ALTER TABLE production.operators
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES production.employees(id) ON DELETE SET NULL;

-- One operator per employee (an employee has at most one PIN identity).
CREATE UNIQUE INDEX IF NOT EXISTS operators_employee_idx
  ON production.operators(employee_id) WHERE employee_id IS NOT NULL;

-- Backfill from the existing reverse link on employees.
UPDATE production.operators o
SET employee_id = e.id
FROM production.employees e
WHERE e.operator_id = o.id
  AND o.employee_id IS NULL;

-- ── shared.app_roles.employee_id ───────────────────────────────────────────
-- Soft link only (shared is authenticated-only via PostgREST; no cross-schema
-- FK — production.employees is not reachable from a constraint in `shared`).
ALTER TABLE shared.app_roles
  ADD COLUMN IF NOT EXISTS employee_id uuid;

CREATE INDEX IF NOT EXISTS app_roles_employee_idx
  ON shared.app_roles(employee_id) WHERE employee_id IS NOT NULL;

-- Backfill for floor-operator logins: app_roles.user_id = operators.user_id,
-- and the operator is now linked to its employee (from the backfill above).
UPDATE shared.app_roles ar
SET employee_id = o.employee_id
FROM production.operators o
WHERE o.user_id = ar.user_id
  AND o.employee_id IS NOT NULL
  AND ar.employee_id IS NULL;
