-- ============================================================
-- CNTP Supervisor Hub — line messages (supervisor ↔ operator comms)
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: migration 001 (production schema), 005 (grant pattern)
-- ============================================================
--
-- Per-line communication for the supervisor hub. A "channel" is a production
-- section; `section_id IS NULL` is the general / all-lines channel. Text-only
-- in v1 (attachments/mentions can be added later, mirroring maintenance chat).
-- Soft-deleted via `deleted_at` so the thread keeps an audit trail.
-- ============================================================

CREATE TABLE production.line_messages (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id   text,                              -- NULL = general / all-lines
  author_id    uuid        REFERENCES auth.users(id),
  author_name  text        NOT NULL,
  author_role  text,                              -- display only (dept/role)
  body         text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  edited_at    timestamptz,
  deleted_at   timestamptz
);

CREATE INDEX line_messages_section_idx ON production.line_messages(section_id, created_at);
CREATE INDEX line_messages_recent_idx  ON production.line_messages(created_at DESC);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE production.line_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_line_messages"
  ON production.line_messages FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── Grants (table-level GRANTs are not covered by RLS) ────────
GRANT ALL ON production.line_messages TO authenticated, service_role;
