-- ─────────────────────────────────────────────────────────────────────────────
-- Management Announcements System
-- Allows management to broadcast messages to departments.
-- Departments can reply in threaded comments.
-- Reads table tracks per-user dismissal (unread badge logic).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS management_announcements (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text        NOT NULL,
  body                text        NOT NULL,
  from_user_id        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  from_name           text        NOT NULL,
  target_departments  text[]      NOT NULL DEFAULT '{}',
  pinned              boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid        NOT NULL REFERENCES management_announcements(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE(announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS announcement_comments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid        NOT NULL REFERENCES management_announcements(id) ON DELETE CASCADE,
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name       text        NOT NULL,
  department      text,
  body            text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE management_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_comments    ENABLE ROW LEVEL SECURITY;

-- Announcements: all authenticated users can read
CREATE POLICY "announcements_select"
  ON management_announcements FOR SELECT
  TO authenticated USING (true);

-- Announcements: any authenticated user can create (backend enforces role)
CREATE POLICY "announcements_insert"
  ON management_announcements FOR INSERT
  TO authenticated WITH CHECK (true);

-- Announcements: only the author can update
CREATE POLICY "announcements_update"
  ON management_announcements FOR UPDATE
  TO authenticated USING (from_user_id = auth.uid());

-- Reads: users fully own their own read records
CREATE POLICY "reads_all"
  ON announcement_reads FOR ALL
  TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Comments: all authenticated users can read
CREATE POLICY "comments_select"
  ON announcement_comments FOR SELECT
  TO authenticated USING (true);

-- Comments: any authenticated user can comment
CREATE POLICY "comments_insert"
  ON announcement_comments FOR INSERT
  TO authenticated WITH CHECK (true);

-- ── Performance indexes ────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_announcements_created
  ON management_announcements(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_user
  ON announcement_reads(user_id, announcement_id);

CREATE INDEX IF NOT EXISTS idx_announcement_comments_ann
  ON announcement_comments(announcement_id, created_at);
