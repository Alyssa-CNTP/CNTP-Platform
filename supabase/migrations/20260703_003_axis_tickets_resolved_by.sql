-- ============================================================
-- AXIS — tickets: add resolved_by_name + resolved_at
-- Run in: Supabase SQL Editor (staging first, then production).
-- ============================================================
-- The ticket PATCH handler now captures who resolved a ticket
-- and when. These columns power the per-person resolved counts
-- on the dashboard and the resolved-by display in the detail panel.
-- Additive + idempotent.
-- ============================================================

ALTER TABLE axis.tickets
  ADD COLUMN IF NOT EXISTS resolved_by      uuid;

ALTER TABLE axis.tickets
  ADD COLUMN IF NOT EXISTS resolved_by_name text;

ALTER TABLE axis.tickets
  ADD COLUMN IF NOT EXISTS resolved_at      timestamptz;

NOTIFY pgrst, 'reload schema';
