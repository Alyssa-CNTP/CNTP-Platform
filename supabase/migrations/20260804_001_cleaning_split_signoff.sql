-- ============================================================
-- CNTP — Cleaning: separate cleaner sign-off from the operator's
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- Depends on: 20260611_006_cleaning.sql (production.cleaning_records)
-- ============================================================
--
-- Cleaning tasks are now split by who is actually responsible for them
-- (lib/production/cleaning-config.ts's `responsible` field, unchanged here) —
-- an operator ticks off their own tasks, and tasks reserved for a dedicated
-- cleaner ("General cleaner") are only actionable once a rostered cleaner
-- signs in on their own PIN (audit requirement: an operator must not be able
-- to tick a cleaner's task on the cleaner's behalf).
--
-- Operator and cleaner sign off at different times (the cleaner may show up
-- well after the operator has moved on to Capture), so cleaning_records needs
-- a second, independent signature slot alongside the existing operator one.
-- `status`/`operator_*` columns and their CHECK constraint are untouched —
-- a section with no cleaner-only tasks never waits on a cleaner signature.
-- ============================================================

ALTER TABLE production.cleaning_records
  ADD COLUMN IF NOT EXISTS cleaner_id              uuid,
  ADD COLUMN IF NOT EXISTS cleaner_name             text,
  ADD COLUMN IF NOT EXISTS cleaner_signed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cleaner_exceptions_count integer NOT NULL DEFAULT 0;

-- cleaning_logs' action CHECK needs a 'cleaner_sign' value alongside the
-- existing 'operator_sign' so the audit trail can tell the two signatures
-- apart at a glance (actor_id/actor_name already do, but the action itself
-- reading "operator_sign" for a cleaner's signature would be misleading).
ALTER TABLE production.cleaning_logs
  DROP CONSTRAINT IF EXISTS cleaning_logs_action_check;

ALTER TABLE production.cleaning_logs
  ADD CONSTRAINT cleaning_logs_action_check
  CHECK (action IN (
    'area_confirmed','task_exception','station_scan',
    'photo','operator_sign','cleaner_sign','supervisor_verify'
  ));
