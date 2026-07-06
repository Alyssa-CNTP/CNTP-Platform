-- ============================================================
-- CNTP Production Capture — Shift Takeovers (16h00 hand-over audit)
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260611_001_production_capture.sql
-- ============================================================
--
-- When 16h00 passes and a morning capture session is still open (not signed
-- off), the incoming afternoon operator must PIN in to keep capturing. Each
-- confirmation is recorded here so there is an audit trail of WHO captured and
-- WHEN after the shift changed — even though the session row still belongs to
-- the morning shift.
--
-- This is a single CREATE — safe to run as one execution (no cross-table lock).
-- ============================================================

CREATE TABLE IF NOT EXISTS production.shift_takeovers (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id     uuid        NOT NULL
                   REFERENCES production.prod_sessions(id) ON DELETE CASCADE,
  section_id     text        NOT NULL,
  date           date        NOT NULL,
  from_shift     text        NOT NULL,   -- shift the session belongs to (e.g. morning)
  to_shift       text        NOT NULL,   -- incoming shift (e.g. afternoon)

  -- The operator who confirmed by PIN. operator_id references the Capture
  -- operator record (floor operators have no auth user), name kept for audit.
  operator_id    uuid        REFERENCES production.operators(id),
  operator_name  text        NOT NULL,
  -- true = PIN matched an operator rostered to this section for the incoming
  -- shift; false = fallback match against any active operator (flagged).
  rostered       boolean     NOT NULL DEFAULT true,

  taken_over_at  timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_takeovers_session_idx
  ON production.shift_takeovers(session_id);

ALTER TABLE production.shift_takeovers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_shift_takeovers" ON production.shift_takeovers;
CREATE POLICY "authenticated_all_shift_takeovers"
  ON production.shift_takeovers FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
