-- ============================================================
-- Rename Production 'supervisor' role → 'production_supervisor'
-- Run in: Supabase SQL Editor (staging first, then production)
-- ============================================================
--
-- We split the single Production "supervisor" role into an explicit
-- 'production_supervisor' (factory floor — lands in the Supervisor Hub, keeps
-- count/capture sign-off powers) and a new 'warehouse_supervisor' (assigned via
-- the Users admin; does NOT auto-land in the hub).
--
-- The app code accepts 'supervisor' as a legacy alias for 'production_supervisor',
-- so this migration is non-breaking and can run any time. It only renames the
-- platform role in shared.app_roles — it does NOT touch the count domain's own
-- 'supervisor'/'admin' values (sc_count_entries.role etc.), which are unrelated.
--
-- Warehouse supervisors that were provisioned as 'supervisor' should afterwards be
-- reassigned to 'warehouse_supervisor' from Users & Roles.
-- ============================================================

UPDATE shared.app_roles
SET role = 'production_supervisor'
WHERE role = 'supervisor';
