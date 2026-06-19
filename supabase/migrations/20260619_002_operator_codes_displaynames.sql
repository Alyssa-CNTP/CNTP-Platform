-- ============================================================
-- Backfill operator codes + display names
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: migration 004 (operators), 20260618_001 (employee seed)
-- ============================================================
--
-- • display_name := full name where it's blank (so the tablet always shows a name)
-- • operator_code := next sequential OP### for operators that don't have one,
--   continuing past the highest existing OP number so nothing collides.
-- Re-runnable: only touches rows that are still missing the value.
-- ============================================================

-- Display name = full name where missing
UPDATE production.operators
SET display_name = name
WHERE display_name IS NULL OR btrim(display_name) = '';

-- Operator code = OP### for rows without one
WITH base AS (
  SELECT COALESCE(MAX((substring(operator_code FROM '^OP([0-9]+)$'))::int), 0) AS m
  FROM production.operators
  WHERE operator_code ~ '^OP[0-9]+$'
),
ranked AS (
  SELECT id, row_number() OVER (ORDER BY created_at, name) AS rn
  FROM production.operators
  WHERE operator_code IS NULL OR btrim(operator_code) = ''
)
UPDATE production.operators o
SET operator_code = 'OP' || lpad((b.m + r.rn)::text, 3, '0')
FROM ranked r, base b
WHERE o.id = r.id;
