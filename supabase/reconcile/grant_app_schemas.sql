-- Restore Supabase API role grants on production's app schemas.
-- The schema rebuilds used pg_dump --no-privileges, which stripped the grants that let
-- anon/authenticated/service_role reach these schemas via the data API (PostgREST).
-- This re-applies them to match staging. Idempotent and safe to re-run.
-- (RLS still governs row access where policies exist; qms has none, matching staging.)
DO $$
DECLARE s text;
BEGIN
  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE nspname IN ('public','qms','maintenance','acumatica','production','axis',
                      'shared','workspace','sales','logistics','marketing','fields',
                      'agriculture','dispatch','stores')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('GRANT ALL ON ALL TABLES    IN SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('GRANT ALL ON ALL FUNCTIONS IN SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES    TO anon, authenticated, service_role', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON SEQUENCES TO anon, authenticated, service_role', s);
  END LOOP;
END $$;

-- nudge PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
