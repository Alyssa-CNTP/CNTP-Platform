-- ============================================================
-- HR Training / LMS layer — courses, lessons, assessments
-- Run in: Supabase SQL Editor (staging first, then production).
-- Depends on: 20260702_001_competency_matrix.sql (production.sops,
--             production.employees, production.employee_competencies,
--             production.competency_history, production.set_updated_at)
-- ============================================================
--
-- New tables live in a dedicated `hr` schema — the training/LMS content
-- domain is separate from `production`, which keeps owning competency
-- *state* (employee_competencies/competency_history). The grading engine
-- (app/api/training/attempts) reads course content from `hr` and writes
-- competency results cross-schema into `production`.
--
-- IMPORTANT — manual step after running this file: add `hr` to the
-- project's Exposed schemas (Supabase dashboard → API settings) on both
-- staging and production, the same way production/shared/axis already are.
-- Without that, PostgREST/supabase-js cannot reach these tables.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS hr;

GRANT USAGE ON SCHEMA hr TO authenticated, service_role, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA hr GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA hr GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

-- ── 1. hr.training_courses ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr.training_courses (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  slug           text        NOT NULL,
  title          text        NOT NULL,
  description    text,
  area           text        NOT NULL DEFAULT 'production'
                   CHECK (area IN ('production','rosehip','stores','quality','laboratory',
                                   'hygiene','maintenance','food_safety','other')),
  status         text        NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','active','archived')),
  pass_threshold numeric(3,2) NOT NULL DEFAULT 0.80 CHECK (pass_threshold > 0 AND pass_threshold <= 1),
  sort_order     integer     NOT NULL DEFAULT 0,
  active         boolean     NOT NULL DEFAULT true,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS training_courses_slug_idx ON hr.training_courses(lower(slug));
CREATE INDEX IF NOT EXISTS training_courses_status_idx     ON hr.training_courses(status) WHERE active;

DROP TRIGGER IF EXISTS training_courses_updated_at ON hr.training_courses;
CREATE TRIGGER training_courses_updated_at
  BEFORE UPDATE ON hr.training_courses
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

ALTER TABLE hr.training_courses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_training_courses" ON hr.training_courses;
CREATE POLICY "authenticated_all_training_courses"
  ON hr.training_courses FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 2. hr.training_lessons — embedded YouTube lessons per course ───────────

CREATE TABLE IF NOT EXISTS hr.training_lessons (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id        uuid        NOT NULL REFERENCES hr.training_courses(id) ON DELETE CASCADE,
  title            text        NOT NULL,
  youtube_id       text,
  body             text,
  duration_seconds integer,
  sort_order       integer     NOT NULL DEFAULT 0,
  required         boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_lessons_course_idx ON hr.training_lessons(course_id, sort_order);

DROP TRIGGER IF EXISTS training_lessons_updated_at ON hr.training_lessons;
CREATE TRIGGER training_lessons_updated_at
  BEFORE UPDATE ON hr.training_lessons
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

ALTER TABLE hr.training_lessons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_training_lessons" ON hr.training_lessons;
CREATE POLICY "authenticated_all_training_lessons"
  ON hr.training_lessons FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 3. hr.training_questions — the final assessment ─────────────────────────

CREATE TABLE IF NOT EXISTS hr.training_questions (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id         uuid        NOT NULL REFERENCES hr.training_courses(id) ON DELETE CASCADE,
  sort_order        integer     NOT NULL DEFAULT 0,
  prompt            text        NOT NULL,
  kind              text        NOT NULL
                      CHECK (kind IN ('single_choice','multi_choice','true_false',
                                      'numeric','matching','short_text')),
  points            numeric     NOT NULL DEFAULT 1,
  explanation       text,
  image_url         text,
  numeric_answer    numeric,
  numeric_tolerance numeric,
  manual_review     boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_questions_course_idx ON hr.training_questions(course_id, sort_order);

DROP TRIGGER IF EXISTS training_questions_updated_at ON hr.training_questions;
CREATE TRIGGER training_questions_updated_at
  BEFORE UPDATE ON hr.training_questions
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

ALTER TABLE hr.training_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_training_questions" ON hr.training_questions;
CREATE POLICY "authenticated_all_training_questions"
  ON hr.training_questions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 4. hr.training_question_options ─────────────────────────────────────────
-- is_correct / match_key are graded server-side only — the learner-facing
-- API route MUST strip these columns before sending options to the browser.

CREATE TABLE IF NOT EXISTS hr.training_question_options (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id uuid        NOT NULL REFERENCES hr.training_questions(id) ON DELETE CASCADE,
  label       text        NOT NULL,
  is_correct  boolean     NOT NULL DEFAULT false,
  match_key   text,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_options_question_idx ON hr.training_question_options(question_id, sort_order);

ALTER TABLE hr.training_question_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_training_options" ON hr.training_question_options;
CREATE POLICY "authenticated_all_training_options"
  ON hr.training_question_options FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 5. hr.course_sops — course → one or many SOP competencies ──────────────

CREATE TABLE IF NOT EXISTS hr.course_sops (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id  uuid        NOT NULL REFERENCES hr.training_courses(id) ON DELETE CASCADE,
  sop_id     uuid        NOT NULL REFERENCES production.sops(id)     ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, sop_id)
);

CREATE INDEX IF NOT EXISTS course_sops_sop_idx ON hr.course_sops(sop_id);

ALTER TABLE hr.course_sops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_course_sops" ON hr.course_sops;
CREATE POLICY "authenticated_all_course_sops"
  ON hr.course_sops FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 6. hr.training_assignments — who must do which course ──────────────────

CREATE TABLE IF NOT EXISTS hr.training_assignments (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid        NOT NULL REFERENCES production.employees(id) ON DELETE CASCADE,
  course_id   uuid        NOT NULL REFERENCES hr.training_courses(id)  ON DELETE CASCADE,
  assigned_by uuid,
  due_date    date,
  reason      text,
  status      text        NOT NULL DEFAULT 'assigned'
                CHECK (status IN ('assigned','in_progress','completed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, course_id)
);

CREATE INDEX IF NOT EXISTS training_assignments_employee_idx ON hr.training_assignments(employee_id);
CREATE INDEX IF NOT EXISTS training_assignments_due_idx      ON hr.training_assignments(due_date) WHERE status <> 'completed';

DROP TRIGGER IF EXISTS training_assignments_updated_at ON hr.training_assignments;
CREATE TRIGGER training_assignments_updated_at
  BEFORE UPDATE ON hr.training_assignments
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

ALTER TABLE hr.training_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_training_assignments" ON hr.training_assignments;
CREATE POLICY "authenticated_all_training_assignments"
  ON hr.training_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 7. hr.training_attempts — the audit record of every quiz attempt ───────

CREATE TABLE IF NOT EXISTS hr.training_attempts (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id   uuid        NOT NULL REFERENCES production.employees(id) ON DELETE CASCADE,
  course_id     uuid        NOT NULL REFERENCES hr.training_courses(id)  ON DELETE CASCADE,
  attempt_no    integer     NOT NULL DEFAULT 1,
  started_at    timestamptz NOT NULL DEFAULT now(),
  submitted_at  timestamptz,
  auto_score    numeric(3,2),
  final_score   numeric(3,2),
  passed        boolean,
  needs_review  boolean     NOT NULL DEFAULT false,
  answers       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  pin_attested  boolean     NOT NULL DEFAULT false,
  submitted_by  uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_attempts_employee_idx ON hr.training_attempts(employee_id, course_id);
CREATE INDEX IF NOT EXISTS training_attempts_review_idx   ON hr.training_attempts(needs_review) WHERE needs_review AND reviewed_at IS NULL;

ALTER TABLE hr.training_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_training_attempts" ON hr.training_attempts;
CREATE POLICY "authenticated_all_training_attempts"
  ON hr.training_attempts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 8. hr.lesson_progress ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr.lesson_progress (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid        NOT NULL REFERENCES production.employees(id) ON DELETE CASCADE,
  lesson_id   uuid        NOT NULL REFERENCES hr.training_lessons(id)  ON DELETE CASCADE,
  watched     boolean     NOT NULL DEFAULT false,
  watched_at  timestamptz,
  UNIQUE (employee_id, lesson_id)
);

ALTER TABLE hr.lesson_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_lesson_progress" ON hr.lesson_progress;
CREATE POLICY "authenticated_all_lesson_progress"
  ON hr.lesson_progress FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 9. production.sops — per-SOP practical sign-off requirement ────────────
-- Theory-only SOPs (false) auto-advance to 'competent' on a passing assessment.
-- Hands-on machine SOPs (true) advance to 'assessed' and wait for a
-- supervisor practical sign-off before 'competent' (see /training/signoff).

ALTER TABLE production.sops
  ADD COLUMN IF NOT EXISTS requires_practical_signoff boolean NOT NULL DEFAULT false;

-- ── 10. Grants ───────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA hr TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA hr TO service_role;
