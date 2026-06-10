-- =============================================================================
-- Fix grants for service_role + add missing columns
-- Run in: Staging Supabase SQL Editor
-- =============================================================================

-- Grant service_role access to all schemas (needed for migration script)
GRANT USAGE ON SCHEMA qms TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA qms TO service_role;
GRANT USAGE ON SCHEMA workspace TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA workspace TO service_role;
GRANT USAGE ON SCHEMA axis TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA axis TO service_role;

-- sd_runs missing columns
ALTER TABLE qms.sd_runs ADD COLUMN IF NOT EXISTS run_timestamp timestamptz;

-- granule_samples missing columns
ALTER TABLE qms.granule_samples ADD COLUMN IF NOT EXISTS bag_serial text;

-- granule_tastings missing columns
ALTER TABLE qms.granule_tastings ADD COLUMN IF NOT EXISTS aroma integer;

-- customer_specs missing columns
ALTER TABLE qms.customer_specs ADD COLUMN IF NOT EXISTS dust_max numeric;
ALTER TABLE qms.customer_specs ADD COLUMN IF NOT EXISTS dust_min numeric;
