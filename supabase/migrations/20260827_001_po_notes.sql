-- ============================================================
-- CNTP Production Orders — timestamped note log
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260611_001_production_capture.sql (production.prod_sessions)
-- ============================================================
--
-- A lightweight, append-only note log on a production order — distinct from
-- prod_sessions.comments (the single "Handover & operator notes" field an
-- operator writes during capture, which the next save overwrites). Anyone
-- can add a note from /production/orders or the order detail page; author
-- and timestamp are stamped server-side (never client-supplied) so the log
-- stays trustworthy. Modeled on po_reopen_requests, minus the approval
-- workflow — there's nothing to decide here, just a record kept.
-- ============================================================

CREATE TABLE IF NOT EXISTS production.po_notes (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id         uuid        NOT NULL
                       REFERENCES production.prod_sessions(id) ON DELETE CASCADE,
  section_id         text        NOT NULL,
  date               date        NOT NULL,
  shift              text        NOT NULL,

  note               text        NOT NULL,
  created_by         uuid        REFERENCES auth.users(id),
  created_by_name    text,

  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS po_notes_session_idx ON production.po_notes(session_id);
CREATE INDEX IF NOT EXISTS po_notes_section_date_idx ON production.po_notes(section_id, date);

ALTER TABLE production.po_notes ENABLE ROW LEVEL SECURITY;

-- Matches the permissive RLS pattern used by po_reopen_requests / capture_activity —
-- the real gate is the API route (server-verified author), not row-level policy.
DROP POLICY IF EXISTS "authenticated_all_po_notes" ON production.po_notes;
CREATE POLICY "authenticated_all_po_notes"
  ON production.po_notes FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON production.po_notes TO authenticated, service_role;

-- Realtime, so the order detail page's live channel picks up a new note the
-- moment it's added — same pattern as bag_tags/prod_bagging. Guarded so
-- re-running the migration is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'production'
      AND tablename = 'po_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE production.po_notes;
  END IF;
END $$;
