-- ============================================================
-- Acumatica OData incremental sync — dedicated schema + tables
-- Run in: Supabase SQL Editor (staging first, then production)
-- Re-runnable (idempotent).
-- ============================================================
--
-- Lives in its OWN schema `acumatica` (not a department schema) because a sync
-- landing zone is cross-cutting integration infrastructure, not department data.
--
--   acumatica.sync_rows   — the landing zone. One row per (inquiry, natural key).
--                           The full Acumatica row is kept verbatim in JSONB, so
--                           we can sync ANY inquiry without a bespoke table each.
--   acumatica.sync_state  — the "watermark". Newest LastModifiedOn pulled per
--                           inquiry, so the next run only asks for changed rows.
--
-- AFTER RUNNING THIS: add `acumatica` to Settings → API → Exposed schemas in the
-- Supabase dashboard, or the API/supabase-js client cannot see these tables.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS acumatica;

CREATE TABLE IF NOT EXISTS acumatica.sync_rows (
  inquiry        text        NOT NULL,   -- which GI this row came from
  row_key        text        NOT NULL,   -- natural key from the row (e.g. "Name")
  last_modified  timestamptz,            -- Acumatica's LastModifiedOn for this row
  data           jsonb       NOT NULL,   -- the full row, verbatim
  synced_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (inquiry, row_key)         -- upsert target: re-syncing overwrites
);
CREATE INDEX IF NOT EXISTS sync_rows_inquiry_idx       ON acumatica.sync_rows(inquiry);
CREATE INDEX IF NOT EXISTS sync_rows_last_modified_idx ON acumatica.sync_rows(inquiry, last_modified);

CREATE TABLE IF NOT EXISTS acumatica.sync_state (
  inquiry              text PRIMARY KEY,
  last_synced_modified timestamptz,  -- high-water mark; next run filters > this
  last_run_at          timestamptz,
  last_row_count       integer
);

-- New schema + tables need explicit grants for the API roles (RLS ≠ grants).
GRANT USAGE ON SCHEMA acumatica TO authenticated, service_role;
GRANT ALL ON acumatica.sync_rows  TO authenticated, service_role;
GRANT ALL ON acumatica.sync_state TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA acumatica
  GRANT ALL ON TABLES TO authenticated, service_role;

ALTER TABLE acumatica.sync_rows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE acumatica.sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_all_sync_rows ON acumatica.sync_rows;
CREATE POLICY auth_all_sync_rows ON acumatica.sync_rows
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS auth_all_sync_state ON acumatica.sync_state;
CREATE POLICY auth_all_sync_state ON acumatica.sync_state
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
