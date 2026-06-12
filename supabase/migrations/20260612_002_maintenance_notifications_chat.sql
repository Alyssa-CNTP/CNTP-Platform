-- ============================================================
-- CNTP Maintenance — per-user notifications + job-card chat
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: existing maintenance.* tables + migration 20260612_001
-- Re-runnable (IF NOT EXISTS / idempotent).
-- ============================================================
--
-- Two new tables, both in the `maintenance` schema (NOT `shared`):
--   • notifications — the per-user feed shown in the NotificationBell. Lives in
--     `maintenance` (not `shared`) on purpose: notifications are written on behalf
--     of OTHER users (e.g. a manager assigning a card to a technician). The
--     service_role server client writes them (bypassing RLS); each user reads
--     only their own rows via RLS. The service_role has PostgREST access to
--     `maintenance` (granted below) but NOT to `shared`.
--   • card_messages — the WhatsApp-style chat thread per job card. Kept separate
--     from the immutable job_card_logs audit trail.
-- ============================================================

-- ── Per-user notification feed ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance.notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid    NOT NULL,                 -- recipient (auth.users.id)
  kind        text    NOT NULL,                 -- assignment | breakdown | mention | qc_bounce | verify_bounce
  title       text    NOT NULL,
  body        text,
  card_id     bigint  REFERENCES maintenance.job_cards(id) ON DELETE CASCADE,
  url         text,                             -- deep link, e.g. /maintenance/job-cards/123
  urgent      boolean NOT NULL DEFAULT false,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON maintenance.notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS notifications_card_idx
  ON maintenance.notifications(card_id);

GRANT USAGE ON SCHEMA maintenance TO authenticated, service_role;
GRANT ALL ON maintenance.notifications TO authenticated, service_role;
ALTER TABLE maintenance.notifications ENABLE ROW LEVEL SECURITY;
-- Each user may read + mark-read ONLY their own notifications.
-- Inserts come from the service_role server client (bypasses RLS).
DROP POLICY IF EXISTS notifications_own_select ON maintenance.notifications;
CREATE POLICY notifications_own_select ON maintenance.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS notifications_own_update ON maintenance.notifications;
CREATE POLICY notifications_own_update ON maintenance.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Job-card chat thread ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance.card_messages (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id      bigint NOT NULL REFERENCES maintenance.job_cards(id) ON DELETE CASCADE,
  author_id    uuid,                            -- auth.users.id (null for system)
  author_name  text NOT NULL,                   -- denormalised for display
  body         text,                            -- may be empty for a photo-only message
  mentions     uuid[]  NOT NULL DEFAULT '{}',   -- mentioned user ids
  attachments  jsonb   NOT NULL DEFAULT '[]',   -- [{ path, name, size, mime }]
  created_at   timestamptz NOT NULL DEFAULT now(),
  edited_at    timestamptz,
  deleted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS card_messages_card_idx
  ON maintenance.card_messages(card_id, created_at);

GRANT ALL ON maintenance.card_messages TO authenticated, service_role;
ALTER TABLE maintenance.card_messages ENABLE ROW LEVEL SECURITY;
-- Anyone signed in may read the thread; a user may only write as themselves.
DROP POLICY IF EXISTS card_messages_read ON maintenance.card_messages;
CREATE POLICY card_messages_read ON maintenance.card_messages
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS card_messages_write ON maintenance.card_messages;
CREATE POLICY card_messages_write ON maintenance.card_messages
  FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());

-- ── Private storage bucket for chat photos ──────────────────────────────────
-- Private: all access is via server-minted signed URLs (service_role). Photos
-- are auto-deleted server-side when a job card is closed/verified.
INSERT INTO storage.buckets (id, name, public)
VALUES ('maintenance-card-photos', 'maintenance-card-photos', false)
ON CONFLICT (id) DO NOTHING;
