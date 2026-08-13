-- 20260813_005_bag_tags_realtime.sql
--
-- The Quality Sieving page now sources bags from production.bag_tags
-- (20260813_003), so the live "bag awaiting QC" panel has to listen on that
-- table to appear the moment a bag is printed. prod_bagging stays in the
-- publication too: it is still written on every capture save, and reacting to
-- it costs nothing but catches the case where bag_tags and prod_bagging are
-- written a moment apart.
--
-- Metadata-only (adds the table to the supabase_realtime publication) — no
-- data, RLS or existing behaviour is affected. Guarded so re-running is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'production'
      AND tablename = 'bag_tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE production.bag_tags;
  END IF;
END $$;
