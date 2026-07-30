-- ============================================================
-- CNTP Production — Shift Report + Capture Ratings (Supervisor Hub redesign)
-- Run in: Supabase SQL Editor (staging first, then prod)
-- Depends on: 20260611_001_production_capture.sql, 20260613_001_timesheets.sql,
--             20260618_002_checks_engine.sql, 20260622_001_roster.sql
-- ============================================================
--
-- Two new records, both deliberately auditable rather than live-only:
--
--   production.shift_reports    — the generated end-of-shift report. Everything in
--     it is DERIVED from capture / checks / timesheets / maintenance, so the live
--     view is always rebuildable; `payload` is the frozen snapshot taken at
--     submit time so a later recapture can never silently rewrite a report the
--     production manager already signed. Status walks draft → submitted → approved
--     and every transition is written to shift_report_audit.
--
--   production.capture_ratings  — the supervisor's score for one rostered person on
--     one date+shift: `performance` (did they run the line well) and `accuracy`
--     (was the data they captured correct). Deliberately two separate 1–5 scores,
--     not one blended number, because they fail independently: a fast operator who
--     mis-keys weights and a careful operator on a slow line are different problems.
--     `system_accuracy_pct` is the machine's own opinion (mass-balance variance,
--     empty records, late submits) kept alongside the human score so the weekly
--     leaderboard can show both without one overwriting the other.
--
-- One rating per (date, shift, person). Re-rating updates in place; the audit
-- table keeps the history so a score can't be quietly revised after the week
-- closes.
-- ============================================================


-- ── production.shift_reports ─────────────────────────────────
CREATE TABLE IF NOT EXISTS production.shift_reports (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  date              date        NOT NULL,
  shift             text        NOT NULL CHECK (shift IN ('morning','afternoon','night')),

  status            text        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','submitted','approved')),

  -- Frozen snapshot of the assembled report (see lib/production/shift-report.ts
  -- for the shape). Written on every save; the copy that matters is the one
  -- present at submit/approve time.
  payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Free-text the supervisor adds on top of the generated content.
  supervisor_notes  text,

  generated_at      timestamptz NOT NULL DEFAULT now(),
  generated_by      uuid        REFERENCES auth.users(id),
  generated_by_name text,

  submitted_at      timestamptz,
  submitted_by      uuid        REFERENCES auth.users(id),
  submitted_by_name text,

  approved_at       timestamptz,
  approved_by       uuid        REFERENCES auth.users(id),
  approved_by_name  text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (date, shift)
);

CREATE INDEX IF NOT EXISTS shift_reports_date_idx   ON production.shift_reports(date DESC);
CREATE INDEX IF NOT EXISTS shift_reports_status_idx ON production.shift_reports(status);

DROP TRIGGER IF EXISTS shift_reports_updated_at ON production.shift_reports;
CREATE TRIGGER shift_reports_updated_at
  BEFORE UPDATE ON production.shift_reports
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();


-- ── production.shift_report_audit ────────────────────────────
-- Append-only. One row per state change or note edit, so "who signed this off,
-- and what did it say when they did" is answerable months later.
CREATE TABLE IF NOT EXISTS production.shift_report_audit (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id    uuid        NOT NULL REFERENCES production.shift_reports(id) ON DELETE CASCADE,
  action       text        NOT NULL
                 CHECK (action IN ('generated','regenerated','saved','submitted','approved','reopened')),
  from_status  text,
  to_status    text,
  actor_id     uuid        REFERENCES auth.users(id),
  actor_name   text,
  note         text,
  -- Snapshot of the payload as it stood at this transition. Only populated for
  -- submitted/approved (the transitions that need to be provable); saves would
  -- otherwise duplicate the whole report on every keystroke-driven autosave.
  payload      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shift_report_audit_report_idx ON production.shift_report_audit(report_id, created_at DESC);


-- ── production.capture_ratings ───────────────────────────────
CREATE TABLE IF NOT EXISTS production.capture_ratings (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  date                date        NOT NULL,
  shift               text        NOT NULL CHECK (shift IN ('morning','afternoon','night')),

  -- Who is being rated. employee_id is the Staff Directory front door (see the
  -- staff-identity-links work); operator_id and person_name are denormalized so a
  -- rating still reads correctly if a person is later offboarded.
  employee_id         uuid,
  operator_id         uuid,
  person_name         text        NOT NULL,
  role_key            text,                     -- roster role they were on
  section_id          text,                     -- line they ran, when known

  performance         smallint    CHECK (performance BETWEEN 1 AND 5),
  accuracy            smallint    CHECK (accuracy    BETWEEN 1 AND 5),
  note                text,

  -- The system's own accuracy read for this person/date/shift, snapshotted when
  -- the rating was saved. Never edited by hand — it exists so the leaderboard can
  -- show "supervisor said 5, the data says 78%" instead of picking a winner.
  system_accuracy_pct numeric,
  system_signals      jsonb       NOT NULL DEFAULT '{}'::jsonb,

  rated_by            uuid        REFERENCES auth.users(id),
  rated_by_name       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- One rating per person per shift. person_name (not employee_id) is the
  -- identity here because rostered crew occasionally has no employees row yet;
  -- employee_id is still stored and preferred everywhere it exists.
  UNIQUE (date, shift, person_name)
);

CREATE INDEX IF NOT EXISTS capture_ratings_date_idx     ON production.capture_ratings(date DESC);
CREATE INDEX IF NOT EXISTS capture_ratings_employee_idx ON production.capture_ratings(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS capture_ratings_person_idx   ON production.capture_ratings(person_name);

DROP TRIGGER IF EXISTS capture_ratings_updated_at ON production.capture_ratings;
CREATE TRIGGER capture_ratings_updated_at
  BEFORE UPDATE ON production.capture_ratings
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();


-- ── production.capture_rating_audit ──────────────────────────
-- Append-only history of every score written, so a revision is visible rather
-- than replacing the record silently.
CREATE TABLE IF NOT EXISTS production.capture_rating_audit (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  rating_id    uuid        REFERENCES production.capture_ratings(id) ON DELETE CASCADE,
  date         date        NOT NULL,
  shift        text        NOT NULL,
  person_name  text        NOT NULL,
  performance  smallint,
  accuracy     smallint,
  note         text,
  actor_id     uuid        REFERENCES auth.users(id),
  actor_name   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS capture_rating_audit_rating_idx ON production.capture_rating_audit(rating_id, created_at DESC);
CREATE INDEX IF NOT EXISTS capture_rating_audit_date_idx   ON production.capture_rating_audit(date DESC);


-- ── production.v_capture_scoreboard ─────────────────────────
-- One row per person per ISO week — the "who captured best this week" board.
-- Kept as a view (not a materialized one) because the volume is a few hundred
-- rows a week and a supervisor rating a shift should see the board move at once.
CREATE OR REPLACE VIEW production.v_capture_scoreboard AS
SELECT
  date_trunc('week', r.date)::date            AS week_start,
  r.person_name,
  max(r.employee_id::text)::uuid              AS employee_id,
  count(*)                                    AS shifts_rated,
  round(avg(r.performance)::numeric, 2)       AS avg_performance,
  round(avg(r.accuracy)::numeric, 2)          AS avg_accuracy,
  -- Combined score out of 100: the two human scores weighted equally. Accuracy
  -- is NOT weighted higher here on purpose — the point of showing both columns is
  -- that a supervisor can see which half is dragging, not have it averaged away.
  round((avg(r.performance) + avg(r.accuracy)) / 2 * 20, 1) AS score_pct,
  round(avg(r.system_accuracy_pct)::numeric, 1) AS avg_system_accuracy_pct,
  array_remove(array_agg(DISTINCT r.section_id), NULL) AS sections
FROM production.capture_ratings r
WHERE r.performance IS NOT NULL OR r.accuracy IS NOT NULL
GROUP BY 1, 2;


-- ── Grants + RLS ────────────────────────────────────────────
GRANT ALL ON production.shift_reports        TO authenticated, service_role;
GRANT ALL ON production.shift_report_audit   TO authenticated, service_role;
GRANT ALL ON production.capture_ratings      TO authenticated, service_role;
GRANT ALL ON production.capture_rating_audit TO authenticated, service_role;
GRANT SELECT ON production.v_capture_scoreboard TO authenticated, service_role;

ALTER TABLE production.shift_reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.shift_report_audit   ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.capture_ratings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.capture_rating_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_shift_reports" ON production.shift_reports;
CREATE POLICY "authenticated_all_shift_reports"
  ON production.shift_reports FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_all_shift_report_audit" ON production.shift_report_audit;
CREATE POLICY "authenticated_all_shift_report_audit"
  ON production.shift_report_audit FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_all_capture_ratings" ON production.capture_ratings;
CREATE POLICY "authenticated_all_capture_ratings"
  ON production.capture_ratings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_all_capture_rating_audit" ON production.capture_rating_audit;
CREATE POLICY "authenticated_all_capture_rating_audit"
  ON production.capture_rating_audit FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
