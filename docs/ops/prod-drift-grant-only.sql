-- ============================================================
-- Grant-only fix — for objects the audit reports as present = true with
-- auth_select false/null. Safe to run whole: objects that don't exist here are
-- skipped, and re-granting something already granted is a no-op.
-- Run in: Supabase SQL Editor, on the database the audit was run against.
-- ============================================================
--
-- A PostgREST 404 has two causes needing opposite fixes. If the object is
-- missing, run the migration that creates it. If it exists but no API role can
-- select from it, it never enters PostgREST's schema cache and the API reports
-- it as not found — the object is fine, only the privilege is missing, and
-- re-running a CREATE would change nothing.
--
-- Why this case is live here: 20260623_003_employee_leave.sql issues no GRANTs
-- at all (it predates the convention), and the ALTER DEFAULT PRIVILEGES in
-- 20260611_005_grants.sql only covers objects created by the same role that ran
-- that statement — anything created by a different role misses out.
--
-- Plain `GRANT` has no IF EXISTS, so a missing object would abort the whole
-- script. The loop below grants only what is actually there, which is what makes
-- this runnable before knowing exactly which objects landed.
-- ============================================================

DO $$
DECLARE
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'production') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA production TO authenticated, service_role';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      -- Tables get ALL (the app reads and writes them); views get SELECT, and
      -- need their own grant — they do not inherit from the tables they read.
      ('production.employee_leave',        'ALL'),
      ('production.employee_leave_active', 'SELECT'),
      ('production.roster_change_log',     'ALL'),
      ('production.shift_reports',         'ALL'),
      ('production.shift_report_audit',    'ALL'),
      ('production.capture_ratings',       'ALL'),
      ('production.capture_rating_audit',  'ALL'),
      ('production.v_capture_scoreboard',  'SELECT'),
      ('public.job_cards_pasteuriser',     'ALL'),
      ('public.count_drafts',              'ALL')
    ) AS t(obj, priv)
  LOOP
    IF to_regclass(r.obj) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON %s TO authenticated, service_role', r.priv, r.obj);
      RAISE NOTICE 'granted % on %', r.priv, r.obj;
    ELSE
      RAISE NOTICE 'skipped % — does not exist on this database', r.obj;
    END IF;
  END LOOP;
END $$;

-- PostgREST caches the schema; without this it keeps reporting 404 for anything
-- it could not see when it last loaded.
NOTIFY pgrst, 'reload schema';

-- Re-run audit section 1 afterwards: auth_select should be true for every row
-- that is present.
