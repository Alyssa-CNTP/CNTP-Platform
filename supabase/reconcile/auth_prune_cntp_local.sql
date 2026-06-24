-- Phase: auth-prune-cntp-local  (MODE=sqlfile, runs against PRODUCTION only)
--
-- Remove the early placeholder "@cntp.local" auth accounts (Blender Operator,
-- Granule Line Operator, Factory Supervisor, …) so prod's auth users match the
-- staging model (real @rooibostea.co.za staff + @floor PIN operators).
--
-- SAFETY: a @cntp.local account is DELETED only if NOTHING in a real data table
-- references it. We treat the account's OWN ancillary rows (auth.*, its
-- shared.app_roles row, its production.operators row) as part of the account and
-- remove them with it — they do NOT count as "references" that block deletion.
-- Any other foreign key into auth.users (production capture data, scan/count
-- entries, audit logs, created_by/updated_by, …) DOES block deletion: that user
-- is kept untouched. Everything below runs in ONE transaction (the workflow uses
-- --single-transaction + ON_ERROR_STOP), so on any error nothing changes.
-- A full report is printed via RAISE NOTICE before any row is removed.

DO $$
DECLARE
  rec    record;
  v_ids  uuid[];
  ref_ids uuid[] := '{}';   -- @cntp.local users that ARE referenced (must be kept)
  n_total int;
BEGIN
  -- target set: every @cntp.local auth account
  CREATE TEMP TABLE _cntp ON COMMIT DROP AS
    SELECT id, email FROM auth.users WHERE email LIKE '%@cntp.local';
  SELECT count(*) INTO n_total FROM _cntp;
  RAISE NOTICE '@cntp.local accounts found: %', n_total;

  -- Walk every FK that points at auth.users(id), skipping the account's own
  -- ancillary tables, and collect the @cntp.local ids that appear as a child row.
  FOR rec IN
    SELECT n.nspname AS sch, c.relname AS tbl, att.attname AS col
    FROM pg_constraint con
    JOIN pg_class      c   ON c.oid = con.conrelid
    JOIN pg_namespace  n   ON n.oid = c.relnamespace
    JOIN unnest(con.conkey)  WITH ORDINALITY AS k(attnum, ord)  ON true
    JOIN unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
    JOIN pg_attribute  att  ON att.attrelid  = con.conrelid  AND att.attnum  = k.attnum
    JOIN pg_attribute  ratt ON ratt.attrelid = con.confrelid AND ratt.attnum = fk.attnum
    WHERE con.contype = 'f'
      AND con.confrelid = 'auth.users'::regclass
      AND ratt.attname  = 'id'
      AND n.nspname <> 'auth'                                         -- auth.* cascades with the user
      AND NOT (n.nspname = 'shared'     AND c.relname = 'app_roles')  -- the account's own role row
      AND NOT (n.nspname = 'production' AND c.relname = 'app_roles')  -- the account's own role row (prod copy)
      AND NOT (n.nspname = 'production' AND c.relname = 'operators')  -- the account's own operator row
  LOOP
    EXECUTE format(
      'SELECT array_agg(DISTINCT t.%I) FROM %I.%I t WHERE t.%I IN (SELECT id FROM _cntp)',
      rec.col, rec.sch, rec.tbl, rec.col)
    INTO v_ids;
    IF v_ids IS NOT NULL THEN
      ref_ids := ref_ids || v_ids;
      RAISE NOTICE '  referenced by %.%.% (% account[s]) -> KEEP', rec.sch, rec.tbl, rec.col, array_length(v_ids,1);
    END IF;
  END LOOP;

  RAISE NOTICE '--------------------------------------------------------';
  RAISE NOTICE 'KEEP (referenced):     %', (SELECT count(*) FROM _cntp WHERE id = ANY(ref_ids));
  RAISE NOTICE 'DELETE (unreferenced): %', (SELECT count(*) FROM _cntp WHERE id <> ALL(ref_ids));
  FOR rec IN SELECT email, (id = ANY(ref_ids)) AS kept FROM _cntp ORDER BY kept DESC, email LOOP
    RAISE NOTICE '  %  ->  %', rpad(rec.email, 32), CASE WHEN rec.kept THEN 'KEEP' ELSE 'DELETE' END;
  END LOOP;
  RAISE NOTICE '--------------------------------------------------------';

  -- Remove unreferenced accounts: own ancillary rows first, then the user
  -- (auth.identities / sessions / refresh tokens cascade off auth.users).
  DELETE FROM shared.app_roles     WHERE user_id IN (SELECT id FROM _cntp WHERE id <> ALL(ref_ids));
  DELETE FROM production.app_roles WHERE user_id IN (SELECT id FROM _cntp WHERE id <> ALL(ref_ids));
  DELETE FROM production.operators WHERE user_id IN (SELECT id FROM _cntp WHERE id <> ALL(ref_ids));
  DELETE FROM auth.identities      WHERE user_id IN (SELECT id FROM _cntp WHERE id <> ALL(ref_ids));
  DELETE FROM auth.users           WHERE id      IN (SELECT id FROM _cntp WHERE id <> ALL(ref_ids));
END $$;
