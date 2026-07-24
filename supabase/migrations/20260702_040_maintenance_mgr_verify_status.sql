-- 20260702_040_maintenance_mgr_verify_status.sql
-- Verification chain: add a maintenance-manager final sign-off stage.
-- Flow: in_progress → qc_check → verify (originator) → mgr_verify (manager) → complete.
-- Additive/idempotent: widens the job_cards status CHECK to allow 'mgr_verify'.
-- Existing rows and statuses are untouched. (Applied to the staging DB.)

alter table maintenance.job_cards drop constraint if exists job_cards_status_check;
alter table maintenance.job_cards add constraint job_cards_status_check
  check (status = any (array[
    'raised','clarify','assigned','in_progress','qc_check','verify','mgr_verify','complete','cancelled'
  ]::text[]));
