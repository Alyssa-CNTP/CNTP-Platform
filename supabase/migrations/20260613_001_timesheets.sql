-- ============================================================
-- CNTP Production Capture — Operator timesheets (auto-derive)
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: migrations 001 (prod_sessions), 004 (operators), 005 (grants)
-- ============================================================
--
-- Timesheets are derived from capture activity rather than punched manually:
--   first action = shift start · 5–30 min gap = tea break · >30 min gap = lunch
--   · last action = shift end. The operator confirms (with light edits) at sign-off.
--
-- There is no per-operator timestamp stream today (scan_events omits operator/
-- session and the structured rows are rewritten on every autosave), so we add a
-- dedicated append-only heartbeat (`capture_activity`) that the capture page
-- writes on real edits. `prod_timesheets` stores the confirmed result.
-- ============================================================

-- ── capture_activity ──────────────────────────────────────────
-- Append-only heartbeat. One row per (throttled) operator action during capture.
CREATE TABLE production.capture_activity (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id    uuid        NOT NULL
                  REFERENCES production.prod_sessions(id) ON DELETE CASCADE,
  operator_id   uuid        REFERENCES auth.users(id),
  section_id    text,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

-- ── prod_timesheets ───────────────────────────────────────────
-- The derived + operator-confirmed timesheet. One row per session per operator.
CREATE TABLE production.prod_timesheets (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      uuid        NOT NULL
                    REFERENCES production.prod_sessions(id) ON DELETE CASCADE,
  operator_id     uuid        REFERENCES auth.users(id),
  operator_name   text        NOT NULL,
  section_id      text,
  date            date,
  shift           text,
  shift_start     timestamptz,
  shift_end       timestamptz,
  breaks          jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- [{type:'tea'|'lunch',start,end}]
  worked_minutes  integer,
  derived_data    jsonb,      -- raw auto-derived snapshot, kept for audit
  confirmed       boolean     NOT NULL DEFAULT false,
  confirmed_by    text,
  confirmed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, operator_name)
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX capture_activity_session_idx  ON production.capture_activity(session_id, occurred_at);
CREATE INDEX prod_timesheets_session_idx   ON production.prod_timesheets(session_id);
CREATE INDEX prod_timesheets_date_idx      ON production.prod_timesheets(date DESC);

-- ── updated_at trigger (reuses production.set_updated_at from 001) ──
CREATE TRIGGER prod_timesheets_updated_at
  BEFORE UPDATE ON production.prod_timesheets
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE production.capture_activity  ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.prod_timesheets   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_capture_activity"
  ON production.capture_activity FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all_prod_timesheets"
  ON production.prod_timesheets FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── Grants (table-level GRANTs are not covered by RLS) ────────
GRANT ALL ON production.capture_activity  TO authenticated, service_role;
GRANT ALL ON production.prod_timesheets   TO authenticated, service_role;
