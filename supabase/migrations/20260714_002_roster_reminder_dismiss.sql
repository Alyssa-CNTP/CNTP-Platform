-- ============================================================
-- CNTP Shift Roster — auto-dismiss reminder notifications on submit
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260706_003_roster_section_status.sql,
--             20260612_002_maintenance_notifications_chat.sql
-- ============================================================
--
-- Roster reminders are sent per (user, section) — see doRemind() in
-- app/api/production/roster/cron/route.ts. Once that section is
-- submitted, the reminder is stale and should vanish from the
-- recipient's bell rather than linger as a "still pending" nudge.
-- Tagging each notification row with which roster section it's about
-- lets a DB trigger clear it the moment that section is signed off,
-- regardless of whether the submit happened from the UI or a future
-- automation path.

ALTER TABLE maintenance.notifications
  ADD COLUMN IF NOT EXISTS roster_period_id uuid,
  ADD COLUMN IF NOT EXISTS roster_section   text;

CREATE INDEX IF NOT EXISTS notifications_roster_idx
  ON maintenance.notifications(roster_period_id, roster_section)
  WHERE roster_period_id IS NOT NULL;

-- SECURITY DEFINER: runs as the (superuser-owned) function, bypassing
-- maintenance.notifications' RLS so it can delete reminders addressed to
-- OTHER users, not just the person who just submitted. Same pattern as
-- public.roster_submitter_candidates() in the previous migration.
CREATE OR REPLACE FUNCTION production.dismiss_roster_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = production, maintenance
AS $$
BEGIN
  IF NEW.status = 'submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'submitted') THEN
    DELETE FROM maintenance.notifications
     WHERE kind = 'roster_reminder'
       AND roster_period_id = NEW.period_id
       AND roster_section = NEW.section;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS roster_section_status_dismiss_reminders ON production.roster_section_status;
CREATE TRIGGER roster_section_status_dismiss_reminders
  AFTER INSERT OR UPDATE OF status ON production.roster_section_status
  FOR EACH ROW EXECUTE FUNCTION production.dismiss_roster_reminders();
