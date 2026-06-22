-- ============================================================
-- CNTP Production Capture — Operator login accounts
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: production.operators (existing) + migration 001/002
-- ============================================================
--
-- Floor operators log in with name + 4-digit PIN (no Microsoft / email).
-- Behind the scenes each operator is backed by a Supabase auth user with a
-- synthetic email; the server provisions it with the service role. These two
-- columns link the operator record to that hidden auth user.
-- ============================================================

ALTER TABLE production.operators
  ADD COLUMN IF NOT EXISTS user_id    uuid,
  ADD COLUMN IF NOT EXISTS auth_email text;

CREATE UNIQUE INDEX IF NOT EXISTS operators_user_id_idx
  ON production.operators(user_id) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS operators_auth_email_idx
  ON production.operators(auth_email) WHERE auth_email IS NOT NULL;
