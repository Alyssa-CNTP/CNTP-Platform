-- 20260813_002_prod_bagging_work_centre.sql
--
-- Record the producing line (work centre) directly on each output bag, so
-- prod_bagging carries it without joining back through prod_sessions.section_id.
--
-- Additive and non-breaking: a nullable column plus a one-time backfill. Safe to
-- apply before the capture code that starts writing it (old rows/old code simply
-- leave it NULL). New bags get it from buildBag() (meta.name).

ALTER TABLE production.prod_bagging ADD COLUMN IF NOT EXISTS work_centre text;

-- Backfill existing rows from their session's section_id, using the same
-- human-readable names the capture screens show (SECTION_CONFIG.name).
UPDATE production.prod_bagging b
SET work_centre = CASE s.section_id
    WHEN 'sieving'      THEN 'Sieving Tower'
    WHEN 'refining1'    THEN 'Refining 1'
    WHEN 'refining2'    THEN 'Refining 2'
    WHEN 'granule'      THEN 'Granule Line'
    WHEN 'blender'      THEN 'Blender'
    WHEN 'smallblender' THEN 'Small Blender'
    WHEN 'pasteuriser'  THEN 'Pasteuriser'
    ELSE s.section_id
  END
FROM production.prod_sessions s
WHERE b.session_id = s.id
  AND b.work_centre IS NULL;
