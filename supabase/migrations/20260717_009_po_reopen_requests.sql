-- ============================================================
-- CNTP Supervisor Hub — Production Order reopen requests
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260611_001_production_capture.sql (production.prod_sessions)
-- ============================================================
--
-- The Supervisor Hub's simplified "Productions" (PO history) tab does not let a
-- supervisor reopen a submitted/approved session directly (that direct action
-- still exists on /production/orders for whoever holds can_edit_session). In
-- the Hub, a supervisor instead SUBMITS A REQUEST with a reason; a Production
-- Manager or IT (can_approve_reopen_request) approves or rejects it. Approval
-- sets prod_sessions.status back to 'draft' — same effect as the direct
-- "Reopen for edits" action, just gated behind a second person's sign-off.
-- ============================================================

CREATE TABLE IF NOT EXISTS production.po_reopen_requests (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id         uuid        NOT NULL
                       REFERENCES production.prod_sessions(id) ON DELETE CASCADE,
  section_id         text        NOT NULL,
  date               date        NOT NULL,
  shift              text        NOT NULL,

  requested_by       uuid        REFERENCES auth.users(id),
  requested_by_name  text,
  reason             text        NOT NULL,

  status             text        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by         uuid        REFERENCES auth.users(id),
  decided_by_name    text,
  decision_note      text,
  decided_at         timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS po_reopen_requests_session_idx ON production.po_reopen_requests(session_id);
CREATE INDEX IF NOT EXISTS po_reopen_requests_status_idx  ON production.po_reopen_requests(status);

-- Reuses the same updated_at trigger function every other production table uses.
DROP TRIGGER IF EXISTS po_reopen_requests_updated_at ON production.po_reopen_requests;
CREATE TRIGGER po_reopen_requests_updated_at
  BEFORE UPDATE ON production.po_reopen_requests
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

ALTER TABLE production.po_reopen_requests ENABLE ROW LEVEL SECURITY;

-- Matches the permissive RLS pattern used by capture_activity / shift_takeovers —
-- the real gate is the API route's permission check (can_approve_reopen_request),
-- not row-level policy.
DROP POLICY IF EXISTS "authenticated_all_po_reopen_requests" ON production.po_reopen_requests;
CREATE POLICY "authenticated_all_po_reopen_requests"
  ON production.po_reopen_requests FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON production.po_reopen_requests TO authenticated, service_role;
