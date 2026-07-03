-- 20260704_002_granule_runs_lm_notes.sql
-- Lab Manager standing notes — additive, non-destructive.
--
-- lm_notes is a free-form note the Lab Manager can add on a run at any
-- time before/after the pass/fail/concession decision. Distinct from
-- final_reason, which is the required comment tied to a Fail/Concession
-- decision itself.

ALTER TABLE qms.granule_runs
  ADD COLUMN IF NOT EXISTS lm_notes text;

COMMENT ON COLUMN qms.granule_runs.lm_notes IS 'Lab Manager standing notes on this run, addable any time before/after the pass/fail/concession decision. Distinct from final_reason (the required decision comment on Fail/Concession).';
