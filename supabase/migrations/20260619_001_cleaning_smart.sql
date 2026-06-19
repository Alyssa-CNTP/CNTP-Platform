-- ============================================================
-- CNTP Production Capture — Smart cleaning enhancements
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: migration 006 (cleaning)
-- ============================================================
--
-- Additive upgrades to the existing (compliance-grade) cleaning capture:
--   • cleaning_records.ai_summary — Gemini plain-English shift cleaning summary
--   • cleaning_task_state         — last-done timestamp per weekly/monthly task,
--                                   so those tasks surface only when actually due
--                                   (daily tasks always show). Keeps the audit
--                                   trail (cleaning_logs) untouched.
-- ============================================================

ALTER TABLE production.cleaning_records
  ADD COLUMN IF NOT EXISTS ai_summary text;

-- ── cleaning_task_state — frequency-aware "due" tracking ──────
CREATE TABLE IF NOT EXISTS production.cleaning_task_state (
  section_id    text        NOT NULL,
  task_key      text        NOT NULL,
  last_done_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (section_id, task_key)
);

GRANT ALL ON production.cleaning_task_state TO authenticated, service_role;

ALTER TABLE production.cleaning_task_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_cleaning_task_state" ON production.cleaning_task_state;
CREATE POLICY "auth_all_cleaning_task_state" ON production.cleaning_task_state
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
