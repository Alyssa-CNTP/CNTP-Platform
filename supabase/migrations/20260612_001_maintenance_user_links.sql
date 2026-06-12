-- ============================================================
-- CNTP Maintenance — link job cards & roster to real app users
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: existing maintenance.* tables + shared.app_roles
-- Re-runnable (all changes are ADD COLUMN IF NOT EXISTS).
-- ============================================================
--
-- Historically the maintenance module stored people as free-text names
-- (assigned_to / technician / qc_name) against a hardcoded list of
-- technicians. We are moving to real Supabase auth users (one row per
-- person in shared.app_roles, department = 'Maintenance').
--
-- These columns hold the authoritative user id. The existing *_to / *_name
-- text columns are kept as a denormalised display label; new writes set both.
-- They are nullable so existing rows (and the hardcoded-name fallback) keep
-- working until every person has been onboarded as a user.
-- ============================================================

-- ── Job cards: who raised it, who it's assigned to ──────────────────────────
ALTER TABLE maintenance.job_cards
  ADD COLUMN IF NOT EXISTS assigned_user_id  uuid,
  ADD COLUMN IF NOT EXISTS raised_by_user_id uuid;

CREATE INDEX IF NOT EXISTS job_cards_assigned_user_idx
  ON maintenance.job_cards(assigned_user_id) WHERE assigned_user_id IS NOT NULL;

-- ── Duty roster: which user is on duty for a slot ───────────────────────────
ALTER TABLE maintenance.duty_roster
  ADD COLUMN IF NOT EXISTS technician_user_id uuid;

CREATE INDEX IF NOT EXISTS duty_roster_technician_user_idx
  ON maintenance.duty_roster(technician_user_id) WHERE technician_user_id IS NOT NULL;

-- ── Technician planner slots: which user the slot is for ────────────────────
ALTER TABLE maintenance.tech_schedule
  ADD COLUMN IF NOT EXISTS technician_user_id uuid;

-- ── Area → QC officer mapping ───────────────────────────────────────────────
ALTER TABLE maintenance.area_qc
  ADD COLUMN IF NOT EXISTS qc_user_id uuid;

-- ── Phone number on app_roles — used for urgent WhatsApp/SMS breakdown alerts ─
ALTER TABLE shared.app_roles
  ADD COLUMN IF NOT EXISTS phone text;
