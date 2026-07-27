-- ============================================================
-- CNTP — unified notifications foundation
-- Run in: Supabase SQL Editor — STAGING (qjqkpockmujecjgmdple) AND
--         PRODUCTION (sxzjjcyuzyfneesnsjna).
-- ============================================================
--
-- Replaces the fragmented notification storage (maintenance.notifications +
-- axis.notifications + management_announcements/announcement_reads) with ONE
-- per-user feed in the shared schema. Every channel writes here via
-- lib/notifications/notify() (server-side, service_role). The bell reads only
-- this table: newest-first, mark read/unread, delete, and realtime push.
--
-- Safe cutover: the app tries shared.notifications and falls back to the old
-- tables if this migration hasn't run yet, so deploy order doesn't matter.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.notifications (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        NOT NULL,                 -- recipient (auth.users.id)
  source        text        NOT NULL DEFAULT 'system',-- maintenance|axis|roster|production|announcement|system
  kind          text,                                 -- assignment|breakdown|mention|roster_change|announcement|…
  title         text        NOT NULL,
  body          text,
  url           text,                                 -- deep link — the notification "opens" here
  urgent        boolean     NOT NULL DEFAULT false,
  from_name     text,                                 -- e.g. announcement author
  ref_table     text,                                 -- generalises axis.reference_table / maintenance.card_id
  ref_id        text,
  read_at       timestamptz,                          -- null = unread
  -- roster auto-dismiss linkage (a trigger clears these once the section submits)
  roster_period_id uuid,
  roster_section   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_recent_idx
  ON shared.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON shared.notifications(user_id) WHERE read_at IS NULL;

-- ── Row Level Security: a user sees and manages ONLY their own feed ──────────
-- Inserts come from notify() (service_role, bypasses RLS) — there is no
-- authenticated INSERT policy, so users can't write notifications to others.
ALTER TABLE shared.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_own ON shared.notifications;
CREATE POLICY notifications_select_own ON shared.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_update_own ON shared.notifications;
CREATE POLICY notifications_update_own ON shared.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_delete_own ON shared.notifications;
CREATE POLICY notifications_delete_own ON shared.notifications
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, UPDATE, DELETE ON shared.notifications TO authenticated;
GRANT ALL ON shared.notifications TO service_role;

-- ── Realtime: push new rows to the bell the moment they land ─────────────────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE shared.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already in the publication
  WHEN undefined_object THEN NULL;  -- publication not present in this project
END $$;

-- ── One-time backfill from the old tables (guarded so re-runs don't double up)─
INSERT INTO shared.notifications (user_id, source, kind, title, body, url, urgent, ref_id, read_at, roster_period_id, roster_section, created_at)
SELECT user_id, 'maintenance', kind, title, body, url, urgent, card_id::text, read_at, roster_period_id, roster_section, created_at
FROM   maintenance.notifications
WHERE  NOT EXISTS (SELECT 1 FROM shared.notifications WHERE source = 'maintenance');

INSERT INTO shared.notifications (user_id, source, kind, title, body, ref_table, ref_id, read_at, created_at)
SELECT recipient_id, 'axis', type, title, body, reference_table, reference_id::text, read_at, created_at
FROM   axis.notifications
WHERE  NOT EXISTS (SELECT 1 FROM shared.notifications WHERE source = 'axis');
