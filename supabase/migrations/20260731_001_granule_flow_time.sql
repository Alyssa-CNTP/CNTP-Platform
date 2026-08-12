-- Flowability test on the Granule line (mirrors the Pasteuriser flowability
-- test): a fixed 400 g sample is timed; QC records the seconds and the mass
-- flow rate is 400 g ÷ time. Only the time is stored per sample.
ALTER TABLE qms.granule_samples ADD COLUMN IF NOT EXISTS flow_time numeric;
