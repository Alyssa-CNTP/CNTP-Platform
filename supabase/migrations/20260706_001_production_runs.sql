-- ============================================================
-- CNTP Production Capture — Production Runs (cross-shift continuity)
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260611_001_production_capture.sql
-- ============================================================
--
-- A production run is one production order (PO + variant + grade) that
-- can span several shifts of the same production day (07h00–01h00).
-- Operators change at shift hand-over but, while PO/variant/grade stay
-- the same, the run continues and the mass balance is carried forward.
--
-- Each shift still writes its own prod_sessions + prod_mass_balance row
-- ("respectively"); the run row holds the durable full-day rollup.
--
-- ⚠ RUN PART 1 AND PART 2 AS TWO SEPARATE EXECUTIONS. ⚠
-- The SQL editor runs a script as ONE transaction. If PART 2's
-- ALTER prod_sessions (which needs a brief exclusive lock, and a lock on
-- production_runs for its FK) runs while PART 1 still holds production_runs
-- exclusively, it deadlocks with the live app reading prod_sessions.
-- Committing PART 1 first releases that lock and breaks the cycle.
-- Highlight PART 1, Run. Then highlight PART 2, Run.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PART 1 — create production_runs (run this on its own, first)
-- ════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS production.production_runs (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id         text        NOT NULL
                       CHECK (section_id IN (
                         'sieving','refining1','refining2',
                         'granule','blender','pasteuriser'
                       )),

  -- The 07h00 date the run opened. The post-midnight night tail
  -- (23h00–01h00) still carries the opening day so it rolls up together.
  production_day     date        NOT NULL,

  -- Run anchor: all three must match for a shift to continue the run.
  production_order   text,
  variant            text
                       CHECK (variant IN (
                         'Conventional','Organic',
                         'RA-Conventional','RA-Organic','FT-ORG'
                       )),
  grade              text,       -- destination letter A/B/C (null for refining)
  lot_number         text,

  status             text        NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','closed')),

  -- Persisted full-day rollup — recomputed on each linked session save by
  -- summing the prod_mass_balance rows of every session sharing this run.
  total_input_kg     numeric     NOT NULL DEFAULT 0,
  total_output_kg    numeric     NOT NULL DEFAULT 0,
  balance_kg         numeric     GENERATED ALWAYS AS (total_input_kg - total_output_kg) STORED,
  tolerance_kg       numeric     NOT NULL DEFAULT 15,

  opened_at          timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz,
  created_by         uuid        REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- At most ONE open run per natural key per production day. Closed runs may
-- repeat the key (e.g. the afternoon deliberately starts a separate run on the
-- same product). COALESCE so nullable anchor columns still de-duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS production_runs_open_key_idx
  ON production.production_runs (
    section_id, production_day,
    COALESCE(production_order, ''), COALESCE(variant, ''), COALESCE(grade, '')
  )
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS production_runs_section_day_idx
  ON production.production_runs(section_id, production_day);
CREATE INDEX IF NOT EXISTS production_runs_status_idx
  ON production.production_runs(status);

-- updated_at trigger (reuses function from migration 001).
DROP TRIGGER IF EXISTS production_runs_updated_at ON production.production_runs;
CREATE TRIGGER production_runs_updated_at
  BEFORE UPDATE ON production.production_runs
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

-- Row Level Security — matches every other capture table.
ALTER TABLE production.production_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_production_runs" ON production.production_runs;
CREATE POLICY "authenticated_all_production_runs"
  ON production.production_runs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);


-- ════════════════════════════════════════════════════════════
-- PART 2 — link prod_sessions to a run (run this SECOND, on its own)
-- ════════════════════════════════════════════════════════════
-- lock_timeout makes the brief exclusive lock fail fast instead of hanging if
-- the app is mid-query; just re-run PART 2 if it times out (adding a nullable
-- column is instant once the lock is granted).
SET lock_timeout = '5s';

ALTER TABLE production.prod_sessions
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES production.production_runs(id);

CREATE INDEX IF NOT EXISTS prod_sessions_run_idx
  ON production.prod_sessions(run_id);
