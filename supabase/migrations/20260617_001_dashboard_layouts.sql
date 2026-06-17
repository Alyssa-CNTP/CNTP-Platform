-- ============================================================
-- CNTP — dashboard_layouts: per-user, per-department dashboard layouts
-- Run in: Supabase SQL Editor (staging first, then production)
-- Re-runnable (IF NOT EXISTS / idempotent).
-- ============================================================
--
-- Backs the user-editable dashboards (Production first, other departments later).
-- One row per (user, dashboard) holds the ordered list of widgets that user has
-- arranged. No row → the app falls back to the code-defined default layout for
-- that dashboard, so a fresh user is never shown a blank page. "Reset to default"
-- simply deletes the row.
--
--   dashboard_key — which dashboard the layout belongs to, e.g. 'production'.
--   widgets       — ordered jsonb array of widget instances:
--                     [{ "instanceId": "...", "type": "kpi-yield", "span": "sm" }, ...]
--                   Array order IS the display order. `span` is one of
--                   sm | md | lg | full (see lib/dashboard/types.ts).
--
-- Read + written client-side by each user via RLS (own row only) — same model as
-- shared.user_preferences.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.dashboard_layouts (
  user_id       uuid        NOT NULL,
  dashboard_key text        NOT NULL,
  widgets       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dashboard_key)
);

-- ── Grants ──────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA shared TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shared.dashboard_layouts TO authenticated;

-- ── RLS — each user manages only their own layouts ───────────────────────────
ALTER TABLE shared.dashboard_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_layouts_own_select ON shared.dashboard_layouts;
CREATE POLICY dashboard_layouts_own_select ON shared.dashboard_layouts
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS dashboard_layouts_own_insert ON shared.dashboard_layouts;
CREATE POLICY dashboard_layouts_own_insert ON shared.dashboard_layouts
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS dashboard_layouts_own_update ON shared.dashboard_layouts;
CREATE POLICY dashboard_layouts_own_update ON shared.dashboard_layouts
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS dashboard_layouts_own_delete ON shared.dashboard_layouts;
CREATE POLICY dashboard_layouts_own_delete ON shared.dashboard_layouts
  FOR DELETE TO authenticated USING (user_id = auth.uid());
