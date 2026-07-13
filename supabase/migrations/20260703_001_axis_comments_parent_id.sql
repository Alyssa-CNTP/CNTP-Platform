-- ============================================================
-- AXIS — comments: add threading + soft-delete columns
-- Run in: Supabase SQL Editor (staging project first, then production).
-- Depends on: axis.comments (must already exist)
-- ============================================================
--
-- The comments API (app/api/axis/comments/route.ts) references parent_id,
-- edited_at, and deleted_at but these columns were never added to axis.comments.
-- PostgREST rejects every comment fetch/post with:
--   "Could not find the 'parent_id' column of 'comments' in the schema cache"
-- This breaks the consideration board comment panel for all IT users.
--
-- Additive + idempotent: ADD COLUMN IF NOT EXISTS, no data overwritten.
-- ============================================================

-- Threading: replies reference the root comment id (single-level)
ALTER TABLE axis.comments
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES axis.comments(id) ON DELETE CASCADE;

-- Soft-delete: body is scrubbed on read when this is set
ALTER TABLE axis.comments
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Edit tracking
ALTER TABLE axis.comments
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- @-mention user ids (uuid array)
ALTER TABLE axis.comments
  ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';

-- Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';
