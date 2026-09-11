-- ============================================================
-- CNTP Production — Operator shift clock (login → logout presence ledger)
-- Run in: Supabase SQL Editor — STAGING first, then production.
-- Depends on: nothing. Purely additive; no existing table or reader changes.
-- ============================================================
--
-- WHY THIS TABLE EXISTS
--
-- An operator's timesheet START was derived from `production.capture_activity`,
-- and every row in that table is written by ONE screen —
-- `/production/capture/[section]`. So the timesheet did not begin when the
-- operator began. It began when they first opened the capture page, and if
-- they never reached Sign-off it never began at all: the fallback was the
-- earliest SCHEDULED break, which reads 10:30 on a morning shift.
--
-- The floor reported it as "timesheets only start working when I go into the
-- capture page and the sign off module".
--
-- The operator's real clock is their LOGIN. They sign in at the start of the
-- shift and out at the end, and that holds whichever screen they use in
-- between — it is not capture's fact to own. So presence gets its own ledger,
-- written from the app shell for every signed-in floor user.
--
-- WHY INTERVALS AND NOT TWO COLUMNS
--
-- A production day holds more than one login: the tablet is locked and
-- reopened, the app's 60-minute inactivity sign-out fires while the operator
-- is inside a machine, they sign out for an appointment and come back. A
-- single mutable `shift_start` column would have each of those overwrite the
-- last — the read-modify-write failure of ARCHITECTURE.md §1B, applied to
-- somebody's paid hours.
--
-- So one row per login/logout pair, appended, never rewritten. The shift start
-- is the earliest `opened_at` of the day and cannot move; the shift end is the
-- latest close. Derivation lives in `lib/core/timesheet/shift-clock.ts` and is
-- unit-tested there.
--
-- ALL CHANGES ARE ADDITIVE.
-- ============================================================

CREATE TABLE IF NOT EXISTS production.operator_shift_clock (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,

  -- The auth user. NOT NULL: presence is a person's, and a row we cannot
  -- attribute is not evidence of anyone's shift.
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Their `production.operators` row, where one exists. Nullable because a
  -- supervisor or manager on the floor has a login and a shift but is not
  -- necessarily a rostered operator.
  operator_id   uuid        REFERENCES production.operators(id),
  -- The name the TIMESHEET is keyed on — `operators.display_name || name`
  -- where there is an operators row, else the app_roles full name. Resolved
  -- server-side and denormalised, so the clock and `prod_timesheets` /
  -- `timesheet_stoppages` agree about who this is without a join through two
  -- schemas at read time.
  operator_name text        NOT NULL,

  -- The PRODUCTION RUN day and shift the login belongs to, resolved through
  -- the same 07h00→01h00 rule as everything else (ARCHITECTURE.md §9): a login
  -- at 00h30 belongs to the run that started the previous 07h00. NEVER the
  -- wall-clock date of `opened_at`.
  date          date        NOT NULL,
  shift         text        NOT NULL CHECK (shift IN ('morning','afternoon','night')),
  -- Where they were working, if known at login (from `shared.app_roles`).
  -- Advisory only — a timesheet is matched on person + day + shift, never on
  -- this, because an operator moved to another line mid-shift is ordinary.
  section_id    text,

  opened_at     timestamptz NOT NULL DEFAULT now(),
  -- NULL = still signed in.
  closed_at     timestamptz,
  -- Why it closed. 'stale' means no heartbeat for long enough that the tab is
  -- gone (flat battery, tablet reboot) — such a row is closed at its LAST
  -- HEARTBEAT, never at the moment the sweep noticed, or a dead tablet would
  -- bill the rest of the day.
  close_reason  text        CHECK (close_reason IN ('signed_out','idle_timeout','stale','supervisor')),

  -- The heartbeat. This is what makes an abandoned session recoverable to the
  -- right time rather than to now or to zero.
  last_seen_at  timestamptz NOT NULL DEFAULT now(),

  -- How the login arrived, for diagnosing a device that never clocks in.
  device        text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT operator_shift_clock_closes_after_open
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

-- The read the timesheet does on every load: one person, one run day.
CREATE INDEX IF NOT EXISTS operator_shift_clock_person_day_idx
  ON production.operator_shift_clock (user_id, date, shift, opened_at);

-- The same read keyed on the denormalised name, for the timesheet paths that
-- only know who signed off and not which auth user they are.
CREATE INDEX IF NOT EXISTS operator_shift_clock_name_day_idx
  ON production.operator_shift_clock (operator_name, date, shift, opened_at);

-- AT MOST ONE OPEN INTERVAL PER PERSON PER RUN DAY.
--
-- This is the concurrency guard, and it is the reason clock-in can be a plain
-- "find or create" without a transaction: two tabs opening at once cannot both
-- insert, so a reload or a second device joins the interval that exists
-- instead of starting a second one. Partial, so CLOSED rows are unconstrained
-- — a day legitimately holds several of those.
CREATE UNIQUE INDEX IF NOT EXISTS operator_shift_clock_one_open_idx
  ON production.operator_shift_clock (user_id, date, shift)
  WHERE closed_at IS NULL;

-- The sweep's read: open rows that have gone quiet.
CREATE INDEX IF NOT EXISTS operator_shift_clock_open_idx
  ON production.operator_shift_clock (last_seen_at)
  WHERE closed_at IS NULL;

COMMENT ON TABLE production.operator_shift_clock IS
  'Login → logout presence ledger. One row per sign-in; the timesheet derives '
  'shift start (earliest open) and end (latest close) from it. Append-only: '
  'never rewrite opened_at, and never collapse a day to a single row.';

-- ── Sweep: close intervals whose tab is gone ──────────────────
--
-- Called by the shift-clock API route on read, and safe to run from a cron.
-- The close stamp is `last_seen_at` — the last moment there is evidence for —
-- NOT now(). 90 minutes is deliberately longer than the app's own 60-minute
-- inactivity sign-out: that sign-out closes the row properly whenever the tab
-- is alive to fire it, and this must not race it and close live shifts out
-- from under operators who are simply working away from the tablet.
CREATE OR REPLACE FUNCTION production.close_stale_shift_clocks(
  p_stale_minutes int DEFAULT 90
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = production, public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE production.operator_shift_clock
     SET closed_at    = last_seen_at,
         close_reason = 'stale',
         updated_at   = now()
   WHERE closed_at IS NULL
     AND last_seen_at < now() - make_interval(mins => p_stale_minutes);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ── updated_at trigger (reuses production.set_updated_at) ─────
DROP TRIGGER IF EXISTS operator_shift_clock_updated_at ON production.operator_shift_clock;
CREATE TRIGGER operator_shift_clock_updated_at
  BEFORE UPDATE ON production.operator_shift_clock
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

-- ── Row Level Security + grants ───────────────────────────────
--
-- READ-ONLY to authenticated, unlike the sibling timesheet tables. Writes go
-- through the service role in app/api/production/shift-clock only.
--
-- That asymmetry is the point, not an oversight: every other timesheet table
-- holds what the operator SAYS happened and they must be able to correct it.
-- This one holds when they actually signed in, it decides paid hours, and the
-- entire reason for anchoring the clock to the login is that nobody types it.
-- A browser that could UPDATE `opened_at` would hand that back.
ALTER TABLE production.operator_shift_clock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_operator_shift_clock" ON production.operator_shift_clock;
CREATE POLICY "authenticated_read_operator_shift_clock"
  ON production.operator_shift_clock FOR SELECT TO authenticated
  USING (true);

GRANT USAGE ON SCHEMA production TO authenticated;
GRANT SELECT ON production.operator_shift_clock TO authenticated;
GRANT ALL    ON production.operator_shift_clock TO service_role;
GRANT EXECUTE ON FUNCTION production.close_stale_shift_clocks(int) TO service_role;
