-- ============================================================
-- CNTP Production — add 'FT-CON' (Fairtrade Conventional) variant
-- Run in: Supabase SQL Editor (staging first, then production).
-- ============================================================
--
-- The variant column carries a CHECK constraint listing the allowed Acumatica
-- variant words. 'FT-CON' (Fairtrade Conventional) was missing — captures using
-- it would be rejected. This widens the CHECK on every table that stores a
-- variant. Idempotent + name-agnostic: it finds and drops whatever CHECK
-- currently governs the variant column, then re-adds the widened one.
-- ============================================================

DO $$
DECLARE
  t text;
  c record;
  tables text[] := ARRAY['prod_sessions','bag_tags','prod_debagging','prod_bagging','shift_assignments'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Drop any existing CHECK constraint that references the variant column.
    FOR c IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class cl     ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      WHERE ns.nspname = 'production' AND cl.relname = t
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) ILIKE '%variant%'
    LOOP
      EXECUTE format('ALTER TABLE production.%I DROP CONSTRAINT %I', t, c.conname);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE production.%I ADD CONSTRAINT %I CHECK (variant IN (%L,%L,%L,%L,%L,%L))',
      t, t || '_variant_check',
      'Conventional','Organic','RA-Conventional','RA-Organic','FT-ORG','FT-CON'
    );
  END LOOP;
END $$;
