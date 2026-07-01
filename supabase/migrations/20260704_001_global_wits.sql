-- Global Wits trade file imports
-- Adds tracking columns to vault_documents so we can list previous imports

alter table sales.vault_documents
  add column if not exists source        text,
  add column if not exists row_count     integer,
  add column if not exists company_count integer,
  add column if not exists uploaded_by   uuid references auth.users(id);

-- signals: ensure source_url unique constraint exists (needed for upsert on conflict)
alter table sales.signals
  drop constraint if exists signals_source_url_unique;
alter table sales.signals
  add constraint signals_source_url_unique unique (source_url);
