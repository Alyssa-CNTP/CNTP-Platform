-- ============================================================
-- AXIS — backfill PRJ-001..004 as historical records
-- Run in: Supabase SQL Editor (staging first, then production).
-- ============================================================
-- These 4 projects predate AXIS and only ever existed as OneDrive folders
-- (see the "PRJ-001 to PRJ-004 exist in OneDrive already" comment that used
-- to live in app/api/axis/requests/[id]/approve/route.ts's project-code
-- generator). They were never entered into axis.projects or
-- axis.project_requests, so they were invisible everywhere in AXIS.
--
-- Backfilled here as placeholders — Alyssa to fill in real name/description/
-- dates later via the Projects UI. status = 'historical' (not 'active') so
-- they're excluded from every .eq('status','active') dashboard/selector query.
-- Additive + idempotent (guarded by NOT EXISTS).
-- ============================================================

-- approved_by is NOT NULL on production's axis.projects (staging allows null —
-- schema drift between the two, per this repo's known lack of a baseline
-- migration for the axis schema). Backfilled with an IT staff member's id
-- rather than hardcoding a specific person, so this runs on either DB.
INSERT INTO axis.projects (project_code, name, description, status, priority, term, effort_size, approved_at, approved_by)
SELECT v.code, v.name, v.description, 'historical', 'mid', 'ongoing', 'M', now(),
  (SELECT user_id FROM shared.app_roles WHERE department = 'IT' LIMIT 1)
FROM (VALUES
  ('PRJ-001', 'PRJ-001 (historical — detail pending)', 'Pre-AXIS project. Existed only as a OneDrive folder before this system. Alyssa to fill in real name/description/dates.'),
  ('PRJ-002', 'PRJ-002 (historical — detail pending)', 'Pre-AXIS project. Existed only as a OneDrive folder before this system. Alyssa to fill in real name/description/dates.'),
  ('PRJ-003', 'PRJ-003 (historical — detail pending)', 'Pre-AXIS project. Existed only as a OneDrive folder before this system. Alyssa to fill in real name/description/dates.'),
  ('PRJ-004', 'PRJ-004 (historical — detail pending)', 'Pre-AXIS project. Existed only as a OneDrive folder before this system. Alyssa to fill in real name/description/dates.')
) AS v(code, name, description)
WHERE NOT EXISTS (SELECT 1 FROM axis.projects p WHERE p.project_code = v.code);

-- Matching project_requests rows so the submission ledger is complete too.
INSERT INTO axis.project_requests (title, description, business_justification, urgency, requesting_dept, status, submission_type, reviewed_by_name, resolution_note)
SELECT
  'PRJ-00' || n,
  'Historical placeholder — pre-dates AXIS.',
  'Pre-existing OneDrive project, backfilled for audit completeness.',
  'low', 'IT', 'approved', 'major_project',
  'System (historical backfill)',
  'Backfilled as a historical record; original request predates AXIS.'
FROM generate_series(1, 4) AS n
WHERE NOT EXISTS (
  SELECT 1 FROM axis.project_requests r WHERE r.title = 'PRJ-00' || n AND r.submission_type = 'major_project'
);

NOTIFY pgrst, 'reload schema';
