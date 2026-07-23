-- 20260702_030_maintenance_checklist_verify.sql
-- Per-checklist verification — a technician submits a completed checklist to the
-- maintenance manager, who marks it verified. Additive, idempotent (safe to run
-- alongside the JoJo migration which declares the same columns).
--
--  • submitted_at / submitted_by — technician sent it to the manager
--  • verified_at  / verified_by  — maintenance manager verified it

alter table maintenance.checklist_completions
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by text,
  add column if not exists verified_at  timestamptz,
  add column if not exists verified_by  text;
