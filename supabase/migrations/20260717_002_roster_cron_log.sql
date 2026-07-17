-- ============================================================
-- Shift Roster — cron run log (rotate / remind)
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260622_001_roster.sql
-- ============================================================
--
-- The rotate/remind GitHub Actions cron (.github/workflows/roster-rotate.yml)
-- previously left no trace inside the app of whether it actually ran, or what
-- it did (e.g. the Jul 8/12/13 401 outage was only visible in GitHub Actions
-- logs). This table gives the roster page something to show admins directly:
-- last run time + task + result payload (reminded count, pending sections,
-- rotated period name, etc).
--
-- Written only by the cron route itself, using the service-role client — no
-- authenticated-user policy is needed, so RLS defaults to deny-all for
-- `authenticated` and the table is reached only via admin-gated API routes.
-- ============================================================

CREATE TABLE IF NOT EXISTS production.roster_cron_log (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  task       text        NOT NULL CHECK (task IN ('rotate', 'remind')),
  ran_at     timestamptz NOT NULL DEFAULT now(),
  result     jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS roster_cron_log_task_ran_at_idx
  ON production.roster_cron_log(task, ran_at DESC);

ALTER TABLE production.roster_cron_log ENABLE ROW LEVEL SECURITY;
-- No policies: authenticated clients get nothing; only the service-role
-- (cron route + admin-gated insights route) can read/write, since it
-- bypasses RLS entirely.
