-- ============================================================
-- Acumatica sync — public RPC wrappers (SECURITY DEFINER)
-- Run in: Supabase SQL Editor (after 20260615_001).
-- Re-runnable (CREATE OR REPLACE).
-- ============================================================
--
-- Why: the `acumatica` schema must be added to the Data API's exposed-schemas
-- list for supabase-js to read/write it directly, and that toggle proved flaky.
-- Instead we expose two functions in `public` (always exposed). They run as the
-- definer (postgres, which owns `acumatica`), so they can read/write the sync
-- tables regardless of whether `acumatica` is exposed to the Data API.
--
-- search_path is pinned to '' and all objects are schema-qualified, so these
-- definer functions can't be hijacked via a caller-controlled search_path.
-- ============================================================

-- Read the high-water mark for an inquiry (null on first run).
CREATE OR REPLACE FUNCTION public.acumatica_get_watermark(p_inquiry text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT last_synced_modified FROM acumatica.sync_state WHERE inquiry = p_inquiry;
$$;

-- Apply one sync run: upsert the changed rows, then advance the watermark.
-- p_rows is a JSON array of { row_key, last_modified, data } objects.
CREATE OR REPLACE FUNCTION public.acumatica_apply_sync(
  p_inquiry       text,
  p_rows          jsonb,
  p_new_watermark timestamptz,
  p_row_count     integer
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO acumatica.sync_rows (inquiry, row_key, last_modified, data, synced_at)
  SELECT p_inquiry, x.row_key, x.last_modified, x.data, now()
  FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
       AS x(row_key text, last_modified timestamptz, data jsonb)
  ON CONFLICT (inquiry, row_key)
  DO UPDATE SET last_modified = excluded.last_modified,
                data          = excluded.data,
                synced_at     = now();

  INSERT INTO acumatica.sync_state (inquiry, last_synced_modified, last_run_at, last_row_count)
  VALUES (p_inquiry, p_new_watermark, now(), p_row_count)
  ON CONFLICT (inquiry)
  DO UPDATE SET last_synced_modified = excluded.last_synced_modified,
                last_run_at          = now(),
                last_row_count       = excluded.last_row_count;
$$;

-- Lock down: CREATE FUNCTION grants EXECUTE to PUBLIC by default, which would let
-- the anon role call these via the Data API. Revoke that, then grant narrowly.
REVOKE ALL ON FUNCTION public.acumatica_get_watermark(text)                          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acumatica_apply_sync(text, jsonb, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acumatica_get_watermark(text)                          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.acumatica_apply_sync(text, jsonb, timestamptz, integer) TO authenticated, service_role;
