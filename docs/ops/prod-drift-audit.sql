-- ============================================================
-- Schema drift audit — read-only. Safe to run on either database.
-- Run in: Supabase SQL Editor, on PRODUCTION (sxzjjcyuzyfneesnsjna) first,
--         then on STAGING (qjqkpockmujecjgmdple) to compare.
-- ============================================================
--
-- Why: the live production site logs PostgREST 404s and 400s for objects the
-- app queries. A 404 from PostgREST is NOT only "table missing" — it is also
-- what you get when the table exists but no API role can see it (it never
-- enters the schema cache), so the audit reports existence AND the
-- `authenticated` role's SELECT privilege side by side. A 400 is different
-- again: the table is there but a *column* in the select list isn't.
--
-- Nothing here writes. Run each section and keep the output.
-- ============================================================


-- ── 1. Objects the app queries that production has been 404ing ──────────────
-- `present` false  → the migration named in `closed_by` was never applied here.
-- `present` true but `auth_select` false → applied, but ungranted: the fix is
-- the GRANT + `NOTIFY pgrst, 'reload schema'`, not re-creating anything.
-- `dependency` rows must all be present before the migration that needs them
-- can be applied at all (FKs and the trigger function resolve at apply time).
WITH expected(obj, kind, role_in_fix, closed_by) AS (
  VALUES
    ('production.employee_leave',          'table', 'target',     '20260623_003_employee_leave.sql'),
    ('production.employee_leave_active',   'view',  'target',     '20260623_003_employee_leave.sql'),
    ('production.employees',               'table', 'dependency', '20260623_001_staff_directory.sql'),

    ('production.roster_change_log',       'table', 'target',     '20260730_002_roster_daily_changes.sql'),
    ('production.roster_periods',          'table', 'dependency', '20260622_001_roster.sql'),
    ('production.roster_section_status',   'table', 'dependency', '20260706_003_roster_section_status.sql'),

    ('production.shift_reports',           'table', 'target',     '20260730_001_shift_report_and_capture_ratings.sql'),
    ('production.shift_report_audit',      'table', 'target',     '20260730_001_shift_report_and_capture_ratings.sql'),
    ('production.capture_ratings',         'table', 'target',     '20260730_001_shift_report_and_capture_ratings.sql'),
    ('production.capture_rating_audit',    'table', 'target',     '20260730_001_shift_report_and_capture_ratings.sql'),
    ('production.v_capture_scoreboard',    'view',  'target',     '20260730_001_shift_report_and_capture_ratings.sql'),

    ('public.job_cards_pasteuriser',       'table', 'target',     '20260729_002_job_cards_pasteuriser_workflow.sql'),
    ('public.count_drafts',                'table', 'target',     '20260821_001_count_drafts.sql')
)
SELECT
  e.obj,
  e.kind,
  e.role_in_fix,
  to_regclass(e.obj) IS NOT NULL                                     AS present,
  has_table_privilege('authenticated', to_regclass(e.obj), 'SELECT') AS auth_select,
  has_table_privilege('service_role',  to_regclass(e.obj), 'SELECT') AS svc_select,
  e.closed_by
FROM expected e
ORDER BY e.role_in_fix DESC, e.obj;


-- ── 2. The columns behind the job_cards_pasteuriser 400 ────────────────────
-- The capture assign page selects all of these. PostgREST 400s the whole query
-- if any one of them is absent, so a single missing column takes out the
-- pasteuriser approval queue entirely.
WITH needed(col) AS (
  VALUES ('status'), ('sent_for_approval_at'), ('approved_by'), ('approved_at'),
         ('rejected_reason'), ('blend_ratio_lines'), ('final_ratio_lines'),
         ('bom_output_item_id'), ('created_by')
)
SELECT
  n.col,
  EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name   = 'job_cards_pasteuriser'
      AND c.column_name  = n.col
  ) AS present
FROM needed n
ORDER BY present, n.col;


-- ── 3. Full object list, for a staging↔production diff ─────────────────────
-- Run on both databases and compare the two outputs — this is what catches the
-- drift nobody has hit yet, rather than only the five symptoms already seen in
-- the browser console.
SELECT table_schema || '.' || table_name AS obj, table_type
FROM information_schema.tables
WHERE table_schema IN ('public', 'production', 'qms', 'sales', 'hr')
ORDER BY 1;


-- ── 4. Full column list, same purpose, one level deeper ────────────────────
-- Column-level drift is what produces 400s (section 2 is just the one case we
-- already know about). Diff this between the databases too.
SELECT table_schema || '.' || table_name || '.' || column_name AS col, data_type
FROM information_schema.columns
WHERE table_schema IN ('public', 'production', 'qms', 'sales', 'hr')
ORDER BY 1;
