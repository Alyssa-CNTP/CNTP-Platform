-- ============================================================
-- CNTP Production — widen section_id and output_group CHECK constraints
-- to include refining1/refining2 sections and output group 'A'.
-- Run in: Supabase SQL Editor (staging first, then production).
-- ============================================================
--
-- prod_sessions.section_id — some production DBs were created before
-- refining1/refining2 were added to the CHECK list. Widen it to include
-- all 6 capture sections. Uses NOT VALID so existing rows are not re-checked.
--
-- prod_bagging.output_group — the original CHECK only allowed B/C/D
-- (3 streams), but refining sections can have up to 4 output groups (A/B/C/D).
-- Add 'A' to the allowed values.
-- ============================================================

DO $$
DECLARE
  c record;
BEGIN
  -- ── prod_sessions.section_id ─────────────────────────────────
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class cl     ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'production' AND cl.relname = 'prod_sessions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%section_id%'
  LOOP
    EXECUTE format('ALTER TABLE production.prod_sessions DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE production.prod_sessions
    ADD CONSTRAINT prod_sessions_section_id_check
    CHECK (section_id IN (
      'sieving','refining1','refining2',
      'granule','blender','pasteuriser'
    )) NOT VALID;

  -- ── prod_bagging.output_group ────────────────────────────────
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class cl     ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'production' AND cl.relname = 'prod_bagging'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%output_group%'
  LOOP
    EXECUTE format('ALTER TABLE production.prod_bagging DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE production.prod_bagging
    ADD CONSTRAINT prod_bagging_output_group_check
    CHECK (output_group IN ('A','B','C','D')) NOT VALID;
END $$;
