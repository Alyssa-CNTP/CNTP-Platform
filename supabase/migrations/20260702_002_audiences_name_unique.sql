-- 20260702_002_audiences_name_unique.sql
-- Add unique constraint on sales.audiences.name so upserts work.
alter table sales.audiences
  add constraint audiences_name_unique unique (name);

notify pgrst, 'reload schema';
