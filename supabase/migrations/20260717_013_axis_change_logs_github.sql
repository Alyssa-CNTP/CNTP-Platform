-- ============================================================
-- AXIS — change_logs: automatic GitHub PR feed support columns
-- Run in: Supabase SQL Editor (staging first, then production).
-- ============================================================
-- Merged GitHub PRs are ingested into this same table as source='github'
-- rows, alongside existing source='manual' entries — one unified timeline.
-- The 'source' column already exists (always 'manual' until now), so no
-- migration needed for that; these are the PR-specific fields.
-- Additive + idempotent.
-- ============================================================

ALTER TABLE axis.change_logs ADD COLUMN IF NOT EXISTS github_pr_number int;
ALTER TABLE axis.change_logs ADD COLUMN IF NOT EXISTS github_pr_url    text;
ALTER TABLE axis.change_logs ADD COLUMN IF NOT EXISTS github_author    text;
ALTER TABLE axis.change_logs ADD COLUMN IF NOT EXISTS github_avatar_url text;
ALTER TABLE axis.change_logs ADD COLUMN IF NOT EXISTS github_diff_stat jsonb;

-- Dedupe guard: a given PR should only ever be ingested once.
CREATE UNIQUE INDEX IF NOT EXISTS change_logs_github_pr_number_uidx
  ON axis.change_logs (github_pr_number) WHERE github_pr_number IS NOT NULL;

NOTIFY pgrst, 'reload schema';
