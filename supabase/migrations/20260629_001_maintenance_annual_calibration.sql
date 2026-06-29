-- 20260629_001_maintenance_annual_calibration.sql
-- Annual / calibration register — additive, non-destructive.
--
--  • interval_days — calibration cycle length (days). When set, the register's
--                    "next due" is recomputed from last_done + interval_days,
--                    exactly like the calibration_assets register.
--  • last_done_by  — person who performed the calibration (audit stamp shown
--                    alongside the last-done date).
--
-- annual_items already carries last_done (date); these two columns complete the
-- "calibrated on <date> by <person>, recurs every <interval> days" stamp.

ALTER TABLE maintenance.annual_items
  ADD COLUMN IF NOT EXISTS interval_days integer,
  ADD COLUMN IF NOT EXISTS last_done_by  text;
