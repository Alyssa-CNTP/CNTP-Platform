-- 20260819_001_sd_runs_raw_material_leaf_shade.sql
--
-- The raw material's leaf shade (qms.leaf_shade_predictions, camera/ML
-- graded at intake) and the QC's own leaf shade for the same lot at Sieving
-- can legitimately differ — the sieve run is the final truth, the raw
-- material figure is only a suggestion carried over to save typing. Until
-- now that suggestion was written straight into sd_runs.leaf_shade as the
-- pre-filled value, so once saved there was no way to tell "QC typed this"
-- from "QC left the suggestion unchanged" — the two numbers were
-- indistinguishable in the data.
--
-- raw_material_leaf_shade snapshots whatever qms.leaf_shade_predictions
-- suggested for the run's lot at the moment of capture (independent of
-- whatever the QC entered into leaf_shade), so later analysis can compare
-- predicted-from-raw-material vs measured-at-sieving per run. It is null
-- whenever no raw-material shade was on record for that lot yet — expected
-- to be common, since a lot of raw material intake hasn't been graded for
-- shade at all.

BEGIN;

ALTER TABLE qms.sd_runs ADD COLUMN IF NOT EXISTS raw_material_leaf_shade integer;

COMMENT ON COLUMN qms.sd_runs.raw_material_leaf_shade IS
  'Leaf shade suggested from qms.leaf_shade_predictions for this run''s lot at capture time. Independent of leaf_shade, which is the QC''s own entry (the final truth) — the two are expected to differ sometimes and both are kept for comparison.';

COMMIT;

NOTIFY pgrst, 'reload schema';
