-- ============================================================
-- AXIS — notifications + project_requests resolution fields
-- Run in: Supabase SQL Editor (staging first, then production).
-- ============================================================
--
-- 1. axis.notifications: add read_at so the bell can mark items read.
--    The table exists but was never queryable from the UI because
--    read_at was absent, making unread state impossible to track.
--
-- 2. axis.project_requests: add resolution tracking fields so the
--    consideration board can display who resolved a request and what
--    was done, including a link to the GitHub PR.
--
-- All changes are additive + idempotent.
-- ============================================================

-- ── 1. axis.notifications: read_at ───────────────────────────────────────────

ALTER TABLE axis.notifications
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- Add id + created_at if they are somehow missing (belt-and-suspenders).
-- PostgREST needs a PK to do .select('id,...').
-- If the column already exists this is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'axis' AND table_name = 'notifications' AND column_name = 'id'
  ) THEN
    ALTER TABLE axis.notifications ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'axis' AND table_name = 'notifications' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE axis.notifications ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- RLS: users may only read and update their own notifications.
ALTER TABLE axis.notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'axis' AND tablename = 'notifications' AND policyname = 'notifications_own_read'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY notifications_own_read ON axis.notifications
        FOR SELECT USING (recipient_id = auth.uid());
    $policy$;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'axis' AND tablename = 'notifications' AND policyname = 'notifications_own_update'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY notifications_own_update ON axis.notifications
        FOR UPDATE USING (recipient_id = auth.uid());
    $policy$;
  END IF;
END $$;

-- ── 2. axis.project_requests: resolution fields ──────────────────────────────

-- Who resolved it (name stored so we don't need a join on every page load)
ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS reviewed_by_name text;

-- Free-text summary of what was done / why it was approved or rejected
ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS resolution_note text;

-- GitHub PR URL for the change that delivered the request
ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS github_pr_url text;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
