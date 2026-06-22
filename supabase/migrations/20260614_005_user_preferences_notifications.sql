-- ============================================================
-- CNTP — user_preferences: add notification preferences
-- Run in: Supabase SQL Editor (staging first, then production)
-- Re-runnable (IF NOT EXISTS / idempotent).
-- ============================================================
--
-- shared.user_preferences is the per-user settings row (theme, language).
-- It is read + written by each user client-side via RLS (own row only).
--
-- This migration:
--   • Ensures the table exists with the columns the app already uses.
--   • Adds a `notifications` jsonb column holding channel opt-outs, e.g.
--       { "email": false, "urgent": false }
--     Absent / true  → the channel is delivered (default-on).
--     false          → the user has muted that channel.
--     In-app feed notifications are always delivered and are NOT controlled here.
--   • Grants service_role SELECT so the server notify() pipeline can read every
--     recipient's preferences (bypassing RLS) before sending email / urgent.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.user_preferences (
  user_id     uuid PRIMARY KEY,
  theme       text,
  language    text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- New column — channel opt-outs. Default '{}' = everything on.
ALTER TABLE shared.user_preferences
  ADD COLUMN IF NOT EXISTS notifications jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── Grants ──────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA shared TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON shared.user_preferences TO authenticated;
-- service_role reads recipient prefs server-side in lib/notifications (RLS bypassed).
GRANT SELECT ON shared.user_preferences TO service_role;

-- ── RLS — each user manages only their own row ───────────────────────────────
ALTER TABLE shared.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_preferences_own_select ON shared.user_preferences;
CREATE POLICY user_preferences_own_select ON shared.user_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_preferences_own_insert ON shared.user_preferences;
CREATE POLICY user_preferences_own_insert ON shared.user_preferences
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_preferences_own_update ON shared.user_preferences;
CREATE POLICY user_preferences_own_update ON shared.user_preferences
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
