-- ============================================================
-- AXIS — tickets: routing/anonymity redesign support columns
-- Run in: Supabase SQL Editor (staging first, then production).
-- ============================================================
-- Ticket auto-routing (hardcoded name matching) is being removed in favour
-- of manual assignment + a real assignee picker. These columns support that
-- redesign plus the new 4-tab Submit Request flow:
--   submitter_department — auto-captured department of whoever raised the
--     ticket (mirrors project_requests.requesting_dept), shown in the queue.
--   is_anonymous          — true for tickets created from an anonymous
--     Suggestion submission; UI must not show created_by/created_by_name.
--   request_id            — links a ticket back to the project_requests row
--     it was created from (feature_change / suggestion only).
-- Additive + idempotent.
-- ============================================================

ALTER TABLE axis.tickets
  ADD COLUMN IF NOT EXISTS submitter_department text;

ALTER TABLE axis.tickets
  ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false;

ALTER TABLE axis.tickets
  ADD COLUMN IF NOT EXISTS request_id uuid;

NOTIFY pgrst, 'reload schema';
