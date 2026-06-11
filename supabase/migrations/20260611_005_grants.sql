-- ============================================================
-- CNTP Production Capture — Table grants
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: migrations 001, 002, 004
-- ============================================================
--
-- Fixes "permission denied for table ..." — newly created tables in the custom
-- `production` schema don't automatically grant privileges to the API roles.
-- RLS (BYPASSRLS for service_role) does NOT replace table-level GRANTs, so we
-- grant them explicitly here for both the authenticated app and the service-role
-- API routes (operator provisioning, floor login list).
-- ============================================================

GRANT USAGE ON SCHEMA production TO authenticated, service_role;

GRANT ALL ON production.operators          TO authenticated, service_role;
GRANT ALL ON production.shift_assignments  TO authenticated, service_role;
GRANT ALL ON production.prod_sessions       TO authenticated, service_role;
GRANT ALL ON production.bag_tags            TO authenticated, service_role;
GRANT ALL ON production.prod_debagging      TO authenticated, service_role;
GRANT ALL ON production.prod_bagging        TO authenticated, service_role;
GRANT ALL ON production.prod_mass_balance   TO authenticated, service_role;
GRANT ALL ON production.session_signatures  TO authenticated, service_role;
GRANT ALL ON production.scan_events         TO authenticated, service_role;

-- Future tables in this schema inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA production
  GRANT ALL ON TABLES TO authenticated, service_role;
