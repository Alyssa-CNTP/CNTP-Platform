-- 20260625_001_maintenance_jobcard_overhaul.sql
-- Maintenance job-card overhaul. All changes are ADDITIVE / non-destructive.
--
--  • urgency      — manager-set urgency label applied at allocation
--                   (low | medium | high | critical). Display priority still
--                   falls back to the derived priorityOf() when null.
--  • started_at   — split "accept" from "start". The work timer now runs from
--                   started_at (set when the technician taps "Start job"),
--                   while accepted_at records the earlier acceptance.
--  • cancelled_*  — a job card can be cancelled (managers only). We widen the
--                   status CHECK to allow the new terminal 'cancelled' state.

ALTER TABLE maintenance.job_cards
  ADD COLUMN IF NOT EXISTS urgency      text,
  ADD COLUMN IF NOT EXISTS started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text;

-- Widen the status check to include the new 'cancelled' terminal state.
ALTER TABLE maintenance.job_cards DROP CONSTRAINT IF EXISTS job_cards_status_check;
ALTER TABLE maintenance.job_cards ADD CONSTRAINT job_cards_status_check
  CHECK (status = ANY (ARRAY[
    'raised', 'clarify', 'assigned', 'in_progress',
    'qc_check', 'verify', 'complete', 'cancelled'
  ]::text[]));

-- Optional urgency sanity check (NULL allowed — falls back to derived priority).
ALTER TABLE maintenance.job_cards DROP CONSTRAINT IF EXISTS job_cards_urgency_check;
ALTER TABLE maintenance.job_cards ADD CONSTRAINT job_cards_urgency_check
  CHECK (urgency IS NULL OR urgency = ANY (ARRAY['low','medium','high','critical']::text[]));
