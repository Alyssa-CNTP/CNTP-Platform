-- ============================================================
-- CNTP Production — Operator timesheet stoppages (event ledger)
-- Run in: Supabase SQL Editor — STAGING first, then production.
-- Depends on: 20260613_001_timesheets.sql (prod_timesheets, capture_activity)
--             maintenance job_cards (20260625_001 and earlier)
-- ============================================================
--
-- WHY THIS TABLE EXISTS
--
-- Stoppages used to live only inside `prod_timesheets.breaks` — a jsonb array
-- written once, at sign-off, from React state. Three things followed from that:
--
--   1. They were lost. The array only reached the database when the operator
--      tapped "Confirm timesheet". Anything that re-mounted or re-derived the
--      component first (typing in the sign-off name field did exactly that)
--      silently reset it to the standard tea/lunch schedule. Start and end were
--      re-derived to the same values, so the sheet looked correct while every
--      logged stoppage was gone. That is the bug the floor reported as "it
--      doesn't save the other stoppages".
--   2. They were not queryable. "How much downtime did the Diamond Blender have
--      last month" cannot be answered by unnesting a jsonb blob per operator
--      per session, so breakdown time never reached a KPI.
--   3. They were not attributable. A breakdown stoppage carried free text and
--      nothing else — no machine, no link to the maintenance job card that was
--      raised for the same event.
--
-- So stoppages become what §6 of ARCHITECTURE.md says bag data is: an
-- append-only ledger, written as they happen, with a stable id. Nothing is
-- deleted — a mis-logged stoppage is VOIDED (voided_at set) so the correction
-- is itself part of the record. `prod_timesheets.breaks` stays, written at
-- confirm as a derived snapshot, because the shift report, the production order
-- detail and the supervisor analytics page all read it today.
--
-- ALL CHANGES ARE ADDITIVE. Existing rows and readers are untouched.
-- ============================================================

-- ── The ledger ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production.timesheet_stoppages (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id    uuid        NOT NULL
                  REFERENCES production.prod_sessions(id) ON DELETE CASCADE,
  operator_id   uuid        REFERENCES auth.users(id),
  operator_name text        NOT NULL,
  section_id    text        NOT NULL,
  -- The PRODUCTION RUN date + shift, copied from the session. Denormalised on
  -- purpose: every KPI query filters on them, and a run that crosses midnight
  -- must not be split by the wall-clock date of `started_at`.
  date          date        NOT NULL,
  shift         text        NOT NULL,

  kind          text        NOT NULL,
  started_at    timestamptz NOT NULL,
  -- NULL = still running. The tracker is live, so a stoppage exists before it
  -- has an end; worked-minutes treats an open stoppage as running up to "now"
  -- (or to sign-off), never as zero.
  ended_at      timestamptz,
  notes         text,

  -- Machine attribution, for per-machine downtime analysis. `machine` is the
  -- maintenance module's own machine string so the two agree; `area` is its
  -- area label. Both nullable: tea and lunch have no machine.
  machine       text,
  area          text,
  -- The maintenance job card this stoppage is the production-side record of.
  -- bigint, matching maintenance.job_cards.id (integer identity). Deliberately
  -- NOT a foreign key across schemas: a cancelled or purged card must not take
  -- the production record of the downtime with it.
  job_card_id   bigint,

  -- Where the row came from:
  --   operator     — the operator logged it on the tracker
  --   standard     — the scheduled tea/lunch, materialised so it can be edited
  --   maintenance  — created from a maintenance job card the operator accepted
  source        text        NOT NULL DEFAULT 'operator',

  -- ── Supervisor attestation (breakdowns) ─────────────────────
  -- A breakdown is the one stoppage kind that moves a number somebody is
  -- measured on: it removes time from production KPIs and puts downtime
  -- against a named machine. So it is the one kind that is not self-certifying
  -- — a supervisor signs that it actually happened, the way a job card is
  -- verified rather than just closed.
  --
  -- 'disputed' is a first-class verdict, not an absence of one. A supervisor
  -- who believes the line was not actually down has to be able to say so
  -- ON THE RECORD; leaving them only "sign" or "don't sign" makes an unsigned
  -- breakdown ambiguous between disputed and simply not-yet-seen, and the KPI
  -- then cannot tell the difference either.
  supervisor_verdict     text,
  supervisor_name        text,
  supervisor_user_id     uuid REFERENCES auth.users(id),
  -- The Staff Directory employee whose stored signature was applied — the same
  -- "Verify & Sign" identity job cards and shift reports use, so one person has
  -- one signature across the platform rather than a per-screen scrawl.
  supervisor_employee_id text,
  supervisor_signed_at   timestamptz,
  supervisor_note        text,

  -- When the maintenance manager was told. Set once; its presence is what stops
  -- a re-render, a reload or a second operator re-notifying for the same
  -- stoppage. A notification you cannot tell you already sent gets sent every
  -- poll.
  notified_at   timestamptz,

  -- Append-only correction. A voided row stays; it just stops counting.
  voided_at     timestamptz,
  voided_by     text,
  void_reason   text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Named constraints so a later widening is a DROP + ADD, the way the job-card
-- status check is widened in 20260625_001 rather than replaced blind.
ALTER TABLE production.timesheet_stoppages
  DROP CONSTRAINT IF EXISTS timesheet_stoppages_kind_check;
ALTER TABLE production.timesheet_stoppages
  ADD CONSTRAINT timesheet_stoppages_kind_check CHECK (kind = ANY (ARRAY[
    'tea', 'lunch', 'deep_clean', 'breakdown', 'maintenance', 'changeover', 'other'
  ]::text[]));

ALTER TABLE production.timesheet_stoppages
  DROP CONSTRAINT IF EXISTS timesheet_stoppages_source_check;
ALTER TABLE production.timesheet_stoppages
  ADD CONSTRAINT timesheet_stoppages_source_check CHECK (source = ANY (ARRAY[
    'operator', 'standard', 'maintenance'
  ]::text[]));

-- An end before the start is a clock/typo error, not a negative stoppage.
ALTER TABLE production.timesheet_stoppages
  DROP CONSTRAINT IF EXISTS timesheet_stoppages_window_check;
ALTER TABLE production.timesheet_stoppages
  ADD CONSTRAINT timesheet_stoppages_window_check
  CHECK (ended_at IS NULL OR ended_at >= started_at);

-- NULL = not yet attested. See the column comment above for why 'disputed' is
-- a stored verdict rather than the absence of a signature.
ALTER TABLE production.timesheet_stoppages
  DROP CONSTRAINT IF EXISTS timesheet_stoppages_verdict_check;
ALTER TABLE production.timesheet_stoppages
  ADD CONSTRAINT timesheet_stoppages_verdict_check
  CHECK (supervisor_verdict IS NULL
         OR supervisor_verdict = ANY (ARRAY['confirmed', 'disputed']::text[]));

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS timesheet_stoppages_session_idx
  ON production.timesheet_stoppages(session_id, started_at);
CREATE INDEX IF NOT EXISTS timesheet_stoppages_date_idx
  ON production.timesheet_stoppages(date DESC, section_id);
-- Per-machine downtime analysis: the KPI query's access path.
CREATE INDEX IF NOT EXISTS timesheet_stoppages_machine_idx
  ON production.timesheet_stoppages(machine, date DESC)
  WHERE machine IS NOT NULL AND voided_at IS NULL;
-- "Is this job card already on someone's timesheet?" — the de-dupe check the
-- maintenance prompt runs before offering a card again.
CREATE INDEX IF NOT EXISTS timesheet_stoppages_job_card_idx
  ON production.timesheet_stoppages(job_card_id)
  WHERE job_card_id IS NOT NULL;
-- The supervisor's queue: breakdowns still waiting to be signed.
CREATE INDEX IF NOT EXISTS timesheet_stoppages_attestation_idx
  ON production.timesheet_stoppages(section_id, date DESC)
  WHERE kind = 'breakdown' AND supervisor_verdict IS NULL AND voided_at IS NULL;

-- ── updated_at trigger (reuses production.set_updated_at from 001) ──
DROP TRIGGER IF EXISTS timesheet_stoppages_updated_at ON production.timesheet_stoppages;
CREATE TRIGGER timesheet_stoppages_updated_at
  BEFORE UPDATE ON production.timesheet_stoppages
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

-- ── Row Level Security + grants (matches prod_timesheets) ─────
ALTER TABLE production.timesheet_stoppages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_timesheet_stoppages" ON production.timesheet_stoppages;
CREATE POLICY "authenticated_all_timesheet_stoppages"
  ON production.timesheet_stoppages FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON production.timesheet_stoppages TO authenticated, service_role;

-- ── Shift-level operator note on the timesheet ────────────────
-- Per-stoppage notes explain one stoppage. This is the operator's note about
-- the shift as a whole, which the production summary shows alongside the
-- handover note. Additive; nothing reads it until the summary does.
ALTER TABLE production.prod_timesheets
  ADD COLUMN IF NOT EXISTS notes text;

-- ============================================================
-- KPI VIEW — downtime per machine
-- ============================================================
--
-- Answers "how has this machine behaved" on its own, which is what the request
-- asks for: breakdown time for the machine, not for the line it sits on.
--
-- Rules baked in here rather than left to each caller:
--   * voided rows never count;
--   * only unplanned/maintenance kinds count as downtime — tea, lunch and
--     deep clean are planned absences of production, not machine failures, and
--     folding them in would make every Tuesday morning look like a breakdown;
--   * an OPEN stoppage is measured to now(), so a breakdown in progress already
--     shows the time it has cost instead of reading zero;
--   * a DISPUTED breakdown is excluded. A supervisor who signed to say the line
--     was not actually down has overruled the claim, and leaving it in the
--     figure would make the signature decorative. Breakdowns not yet signed DO
--     count — downtime is real until somebody says otherwise, and suppressing
--     it until a signature arrives would let a KPI be improved by nobody
--     getting round to the paperwork. `unattested_minutes` says how much of the
--     total is still unsigned so a reader can see the exposure.
CREATE OR REPLACE VIEW production.v_machine_downtime AS
SELECT
  s.machine,
  s.area,
  s.section_id,
  s.date,
  s.shift,
  s.kind,
  count(*)                                                     AS events,
  sum(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at)) / 60.0)::numeric(10,1)
                                                               AS downtime_minutes,
  sum(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at)) / 60.0)
    FILTER (WHERE s.kind = 'breakdown' AND s.supervisor_verdict IS NULL)::numeric(10,1)
                                                               AS unattested_minutes,
  count(*) FILTER (WHERE s.kind = 'breakdown' AND s.supervisor_verdict = 'confirmed')
                                                               AS attested_events,
  count(*) FILTER (WHERE s.ended_at IS NULL)                   AS still_open,
  min(s.started_at)                                            AS first_started_at,
  max(COALESCE(s.ended_at, s.started_at))                      AS last_ended_at,
  array_remove(array_agg(DISTINCT s.job_card_id), NULL)        AS job_card_ids
FROM production.timesheet_stoppages s
WHERE s.voided_at IS NULL
  AND s.kind = ANY (ARRAY['breakdown', 'maintenance']::text[])
  AND COALESCE(s.supervisor_verdict, '') <> 'disputed'
GROUP BY s.machine, s.area, s.section_id, s.date, s.shift, s.kind;

GRANT SELECT ON production.v_machine_downtime TO authenticated, service_role;

-- ============================================================
-- BACKFILL (OPTIONAL, MANUAL) — historic breaks → ledger rows
-- ============================================================
--
-- Left commented for the same reason the worked-minutes recompute in
-- 20260717_008 is: it rewrites history and should be eyeballed first. The
-- ledger works without it — it just starts empty, and the KPI view only knows
-- about stoppages logged from this deploy forward.
--
-- Historic rows carry no machine and no job card, so they can never be
-- attributed to a machine; they are only worth importing so a stoppage count
-- per shift is continuous across the cutover. Run STEP 1 alone first.
/*
-- STEP 1 — PREVIEW. How many rows, of which kinds?
SELECT b->>'type' AS kind, count(*) AS rows
FROM production.prod_timesheets t
CROSS JOIN LATERAL jsonb_array_elements(t.breaks) AS b
WHERE t.confirmed = true
  AND b->>'start' IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;

-- STEP 2 — APPLY. Wrapped so a surprising count can be rolled back.
BEGIN;

INSERT INTO production.timesheet_stoppages
  (session_id, operator_id, operator_name, section_id, date, shift,
   kind, started_at, ended_at, notes, source)
SELECT
  t.session_id, t.operator_id, t.operator_name,
  COALESCE(t.section_id, 'unknown'), t.date, COALESCE(t.shift, 'morning'),
  CASE WHEN b->>'type' = ANY (ARRAY['tea','lunch','changeover','maintenance','other'])
       THEN b->>'type' ELSE 'other' END,
  (b->>'start')::timestamptz,
  NULLIF(b->>'end', '')::timestamptz,
  NULLIF(b->>'notes', ''),
  'standard'
FROM production.prod_timesheets t
CROSS JOIN LATERAL jsonb_array_elements(t.breaks) AS b
WHERE t.confirmed = true
  AND t.date IS NOT NULL
  AND b->>'start' IS NOT NULL
  -- Idempotent: skip a session whose stoppages are already in the ledger.
  AND NOT EXISTS (
    SELECT 1 FROM production.timesheet_stoppages x
    WHERE x.session_id = t.session_id AND x.operator_name = t.operator_name
  );

-- Check the row count against STEP 1, then:
--   COMMIT;
--   ROLLBACK;
*/
