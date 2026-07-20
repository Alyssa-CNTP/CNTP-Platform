-- ============================================================
-- AXIS — project_requests: 4-tab Submit Request redesign
-- Run in: Supabase SQL Editor (staging first, then production).
-- ============================================================
-- Submit Request now has 4 types instead of 3:
--   feature_change  (new) — "Changes to current/new feature", routes to Tickets
--   major_project   (new) — renamed from the old 'feature_request', routes to
--                            the Consideration board (same concept, new name)
--   code_contribution      — unchanged, routes to the Consideration board
--   suggestion             — unchanged type, now anonymous, routes to Tickets
--
-- submission_type has no CHECK constraint (validated app-side in a Set), so
-- adding 'feature_change' needs no enum migration — just new columns, plus a
-- one-time rename of existing 'feature_request' rows to 'major_project' so
-- historical data keeps showing up under its new name everywhere (the
-- Consideration board, dashboards, etc.) instead of silently vanishing.
-- Additive + idempotent.
-- ============================================================

ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS page_module text;

ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false;

UPDATE axis.project_requests
  SET submission_type = 'major_project'
  WHERE submission_type = 'feature_request';

NOTIFY pgrst, 'reload schema';
