-- 20260814_001_fix_sieving_spec_overrides_schema.sql
--
-- qms.sieving_spec_overrides existed with columns
-- (product_type, variant, market, sieve_key, min_val, max_val, updated_by,
-- updated_at) — a normalized long-format layout that the app's Edit Specs
-- save/load code has never actually matched. The app reads/writes
-- (product text, specs jsonb) — one row per product holding its whole
-- variants dict as a blob, keyed the same way SIEVING_SPECS_DB is. Because of
-- that mismatch, `.select('product,specs')` and `.upsert({product,specs})`
-- both silently no-op (a schema mismatch here is a normal PostgREST error
-- response, not a thrown exception, and the app's try/catch only caught
-- thrown exceptions) — so a custom spec edit has never persisted past the
-- current browser tab on either database. Table is empty on both (verified
-- before writing this), so there is no data to preserve or migrate.
--
-- Fix: redefine the table to the shape the app already expects, rather than
-- rewrite the app to the abandoned normalized shape nobody ever wired up.
-- The app side (saveSpecs()) now also checks the returned {error} explicitly
-- instead of only try/catching thrown exceptions, so a future mismatch like
-- this can't go silent again.

BEGIN;

DROP TABLE IF EXISTS qms.sieving_spec_overrides;

CREATE TABLE qms.sieving_spec_overrides (
  product     text PRIMARY KEY,
  specs       jsonb NOT NULL,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON qms.sieving_spec_overrides
  TO anon, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
