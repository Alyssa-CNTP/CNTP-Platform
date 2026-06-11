-- ============================================================
-- CNTP Production Capture — Operators table (floor operators)
-- Run in: Supabase SQL Editor (staging first, then production)
-- ============================================================
--
-- The floor-operator registry. Each operator logs in with name + 4-digit PIN
-- (no Microsoft email); user_id / auth_email link to the hidden Supabase auth
-- account provisioned by /api/production/operators.
--
-- This supersedes migration 003 (which only ADDed the auth columns) — run THIS
-- one; it creates the table complete. 003 is then a harmless no-op.
-- ============================================================

CREATE TABLE IF NOT EXISTS production.operators (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name           text        NOT NULL,
  display_name   text,
  operator_code  text,
  role           text        NOT NULL DEFAULT 'floor_operator'
                   CHECK (role IN ('floor_operator','production_supervisor')),
  section_ids    text[]      NOT NULL DEFAULT '{}',
  pin            text        NOT NULL,
  active         boolean     NOT NULL DEFAULT true,

  -- Link to the hidden Supabase auth account
  user_id        uuid,
  auth_email     text,

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS operators_user_id_idx
  ON production.operators(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS operators_auth_email_idx
  ON production.operators(auth_email) WHERE auth_email IS NOT NULL;

ALTER TABLE production.operators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_operators" ON production.operators;
CREATE POLICY "authenticated_all_operators"
  ON production.operators FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
