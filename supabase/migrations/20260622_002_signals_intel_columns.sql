-- 20260622_002_signals_intel_columns.sql
-- Adds structured-intelligence columns to sales.signals for the Alara pipeline.
--
-- The live "CNTP Signal Engine" (Ollama Tier 1 -> Gemini Tier 2) emits per signal:
--   * sales_angle — one concrete next action for CNTP
--   * urgency     — low | medium | high
--   * tier        — 1 (Ollama only) or 2 (escalated to Gemini)
--   * intel       — catch-all JSON: target_segment, competitor_mentioned, and the
--                   full Tier-2 analysis object.
--
-- Before this, the pipeline wrote these as top-level columns that did not exist
-- (insert failed: "Could not find the 'sales_angle' column ... in the schema
-- cache") and overloaded `sections` (a text[] of app-tab tags) with a JSON object,
-- which broke the SignalDrawer's tag rendering. `sections` is now left to the app.

alter table sales.signals
  add column if not exists sales_angle text,
  add column if not exists urgency     text,
  add column if not exists tier        int,
  add column if not exists intel       jsonb not null default '{}'::jsonb;

-- urgency is kept as free text (not an enum/check) so an unexpected model variant
-- never rejects an otherwise-good row. The UI normalises low|medium|high.

-- Refresh PostgREST's schema cache so the new columns are writable immediately.
notify pgrst, 'reload schema';
