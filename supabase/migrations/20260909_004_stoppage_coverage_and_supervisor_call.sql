-- ============================================================
-- CNTP Production — Stoppage coverage, the supervisor call, and
-- downtime keyed on the LINE rather than a machine
-- Run in: Supabase SQL Editor — STAGING first, then production.
-- Depends on: 20260909_002_timesheet_stoppages.sql (RUN THAT FIRST)
-- ============================================================
--
-- Three changes, all additive. Nothing here drops a column or deletes a row.
--
-- ── 1. Every cause of a stopped line, not just the mechanical ones ──────────
--
-- The kind CHECK allowed seven values, and four of the things that actually
-- stop a rooibos line were not among them: the system being down, a power
-- failure, waiting on material from upstream, and a quality hold. Every one of
-- those was arriving as `other` with a free-text note — which is exactly how
-- breakdowns and deep cleans used to arrive before 002, and exactly why neither
-- could be analysed. A shorter list does not mean fewer stoppages; it means
-- more unexplained ones.
--
-- `changeover` is RETIRED, not removed. It stays in the CHECK because rows
-- already carry it (historic `prod_timesheets.breaks`, and anything the
-- optional backfill in 002 imports). The application no longer offers it — see
-- RETIRED_STOPPAGE_KINDS in lib/core/timesheet/stoppages.ts. Dropping it from
-- the CHECK would make those rows unwritable and the backfill fail.
--
-- ── 2. Calling the supervisor is an action, not a hope ──────────────────────
--
-- A breakdown needs a supervisor's signature, and 002 gave the operator no way
-- to ASK for one — the screen said "awaiting supervisor confirmation" and then
-- nothing happened until somebody wandered past. `supervisor_requested_at`
-- records that the operator called for one, and `supervisor_request_count`
-- records how many times. That distinction matters: an operator who never asked
-- and an operator who asked four times and was ignored are different problems,
-- and a shift report that cannot tell them apart blames the wrong person.
--
-- ── 3. Downtime is per LINE, not per machine ────────────────────────────────
--
-- `v_machine_downtime` grouped on `machine`. The operator is no longer asked
-- which machine stopped — the section is the production order they already have
-- open, so asking again is a question with a wrong answer available — which
-- means `machine` is now almost always NULL and the view would group everything
-- into one nameless row. `v_line_downtime` replaces it, keyed on section+area
-- and split by CAUSE, because two hours lost to `no_material` is a different
-- problem from two hours lost to `breakdown`.
--
-- The `machine` column STAYS on the table. It is nullable, nothing writes it
-- today, and it is where a future refinement lands if the floor ever wants
-- machine-level attribution back.
-- ============================================================

-- ── 1. Widen the kind CHECK ───────────────────────────────────
ALTER TABLE production.timesheet_stoppages
  DROP CONSTRAINT IF EXISTS timesheet_stoppages_kind_check;
ALTER TABLE production.timesheet_stoppages
  ADD CONSTRAINT timesheet_stoppages_kind_check CHECK (kind = ANY (ARRAY[
    -- Breaks: scheduled, and never downtime.
    'tea', 'lunch', 'deep_clean',
    -- Mechanical.
    'breakdown', 'maintenance',
    -- Everything else that stops a line. A line stopped by the system being
    -- down produced exactly as little as one stopped by a bearing.
    'power', 'it_system', 'no_material', 'quality_hold',
    -- The catch-all, and the retired kind.
    'other',
    'changeover'
  ]::text[]));

-- ── 2. The supervisor call ────────────────────────────────────
ALTER TABLE production.timesheet_stoppages
  ADD COLUMN IF NOT EXISTS supervisor_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS supervisor_request_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN production.timesheet_stoppages.supervisor_requested_at IS
  'When the operator last called a supervisor to come and confirm this. NULL = never asked, which is a different problem from asked-and-ignored.';

-- The operator''s queue: breakdowns they have called a supervisor for and are
-- still waiting on.
CREATE INDEX IF NOT EXISTS timesheet_stoppages_supervisor_called_idx
  ON production.timesheet_stoppages(section_id, date DESC)
  WHERE supervisor_requested_at IS NOT NULL
    AND supervisor_verdict IS NULL
    AND voided_at IS NULL;

-- ── 3. Downtime per line, split by cause ──────────────────────
--
-- Rules baked in here rather than left to each caller:
--   * voided rows never count;
--   * a DISPUTED breakdown never counts — a supervisor signed to say the line
--     was not down, and leaving it in would make the signature decorative;
--   * an UNSIGNED one DOES count, and is reported separately as
--     `unattested_minutes`. Downtime is real until somebody says otherwise, and
--     suppressing it until a signature arrives would let the figure be improved
--     by nobody getting round to the paperwork;
--   * breaks and the Tuesday deep clean are NOT downtime — folding planned
--     cleaning in would make every Tuesday morning read as a breakdown;
--   * an OPEN stoppage is measured to now(), so a line that is down right now
--     already shows what it is costing instead of reading zero.
--
-- Shift reports do NOT read this view: they measure an open stoppage to the end
-- of the shift window instead of to now(), or a stoppage nobody closed would
-- report days of downtime against one shift. This is for live dashboards.
CREATE OR REPLACE VIEW production.v_line_downtime AS
SELECT
  s.section_id,
  s.area,
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
  array_remove(array_agg(DISTINCT s.machine), NULL)            AS machines,
  array_remove(array_agg(DISTINCT s.job_card_id), NULL)        AS job_card_ids
FROM production.timesheet_stoppages s
WHERE s.voided_at IS NULL
  AND s.kind = ANY (ARRAY[
        'breakdown', 'maintenance', 'power', 'it_system', 'no_material', 'quality_hold'
      ]::text[])
  AND COALESCE(s.supervisor_verdict, '') <> 'disputed'
GROUP BY s.section_id, s.area, s.date, s.shift, s.kind;

GRANT SELECT ON production.v_line_downtime TO authenticated, service_role;

-- The old view is left in place rather than dropped: it is harmless, it may be
-- open in somebody's SQL editor, and dropping a view that something unknown
-- selects from is a worse failure than an extra view nobody reads. It will
-- simply return fewer and fewer rows as `machine` stops being written.
COMMENT ON VIEW production.v_machine_downtime IS
  'SUPERSEDED by production.v_line_downtime. Groups on `machine`, which the capture screen no longer collects — the section is known from the production order, so the operator is not asked. Kept only so an existing query does not break.';
