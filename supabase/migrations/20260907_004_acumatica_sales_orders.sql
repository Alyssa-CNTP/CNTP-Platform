-- ============================================================
-- Acumatica Sales Orders — the source of the job card.
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- Then:   NOTIFY pgrst, 'reload schema';
-- ============================================================
--
-- A pasteuriser job card is an instruction to produce one customer's sales
-- order. Everything at the top of the paper card comes from that order —
-- customer, job card number, item, quantity, customer PO, dates. Today a person
-- retypes them, which is the error the whole workflow is being built to remove.
--
-- ── The job card number is NOT ours to mint ─────────────────────────────────
--
-- public.next_job_card_no() exists and currently returns 'JC-2026-0001'. The
-- real paper card is numbered 26252, and the batch number on it is
-- 26252-CON-SFC — the batch number EMBEDS the order number. So the number is
-- Acumatica's, the app should read it, and a locally-minted sequence would
-- produce batch numbers that match nothing in the ERP.
--
-- This migration does not remove next_job_card_no(); the granule job cards still
-- call it and that is a separate decision. It makes the real number available.
--
-- ── Why UPSERT and not the full-replace the other syncs use ─────────────────
--
-- acumatica_replace_lot_details DELETEs everything and reinserts, which is right
-- for a stock snapshot: the current picture is the whole truth and yesterday's
-- is worthless.
--
-- A sales order is NOT a snapshot. It has a life — open, in production,
-- completed — and a job card points at one for months afterwards. If the sync
-- filters to open orders (which it should, or it drags years of history across)
-- then a full replace DELETES every order the moment it completes, and every job
-- card that referenced it loses the record of what it was for. Traceability, on
-- the exact link the workflow exists to create.
--
-- So: upsert on (order_type, order_nbr, line_nbr), and never delete. Rows that
-- stop appearing simply stop being refreshed; `synced_at` says how stale each
-- one is. Storage is trivial and losing the link is not.
--
-- ── One row per LINE, header denormalised ───────────────────────────────────
--
-- Matches acumatica.sales_lines, so the app has one shape for "a line of
-- business from Acumatica" rather than two. It also handles the flavoured-tea
-- case directly: an order needing several final-product BOMs is several lines
-- under one order number.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS acumatica;

CREATE TABLE IF NOT EXISTS acumatica.sales_orders (
  -- ── Identity ──────────────────────────────────────────────────────────────
  order_type     text NOT NULL,          -- 'SO', 'IN', … Acumatica's order type
  order_nbr      text NOT NULL,          -- 26252 — this is the job card number
  line_nbr       integer NOT NULL,

  -- ── Header, repeated on every line ────────────────────────────────────────
  status         text,                   -- Open / Completed / Cancelled / On Hold
  customer_id    text,
  customer_name  text,
  -- The customer's own PO ("KTR 1020" on the paper card), not ours.
  customer_order text,
  order_date     date,
  requested_on   date,                   -- expected commencement of production
  ship_via       text,
  order_desc     text,

  -- ── Line ──────────────────────────────────────────────────────────────────
  inventory_id   text,                   -- 30FPSFC-KUN25-C — the final product
  line_desc      text,                   -- Rooibos Super Fine Cut
  order_qty      numeric,                -- 18000
  uom            text,                   -- KG
  warehouse_id   text,

  -- Anything the CNTP endpoint exposes that is not mapped above. The LotDetail
  -- sync taught this lesson: the custom endpoint carried Variant, TeaCourt,
  -- HarvestYear and LandName that no standard schema would have predicted.
  -- Keeping the raw line means a newly-noticed field is a code change, not
  -- another migration.
  raw            jsonb,

  synced_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (order_type, order_nbr, line_nbr)
);

COMMENT ON TABLE acumatica.sales_orders IS
  'Read-only mirror of Acumatica sales order lines. UPSERTED, never replaced: a '
  'job card references an order for months and a full replace would delete it '
  'the moment the order completes. order_nbr is the job card number.';

CREATE INDEX IF NOT EXISTS sales_orders_customer_idx
  ON acumatica.sales_orders (customer_name);
CREATE INDEX IF NOT EXISTS sales_orders_status_idx
  ON acumatica.sales_orders (status, requested_on);
CREATE INDEX IF NOT EXISTS sales_orders_inventory_idx
  ON acumatica.sales_orders (inventory_id);

ALTER TABLE acumatica.sales_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_sales_orders ON acumatica.sales_orders;
CREATE POLICY authenticated_read_sales_orders ON acumatica.sales_orders
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON acumatica.sales_orders TO authenticated;
GRANT ALL    ON acumatica.sales_orders TO service_role;

-- ── Upsert ──────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER with an empty search_path, same as the lot-detail replace.
-- Returns the row count so the caller can report it and so an empty fetch is
-- visible rather than silent.
CREATE OR REPLACE FUNCTION public.acumatica_upsert_sales_orders(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO acumatica.sales_orders (
    order_type, order_nbr, line_nbr, status, customer_id, customer_name,
    customer_order, order_date, requested_on, ship_via, order_desc,
    inventory_id, line_desc, order_qty, uom, warehouse_id, raw, synced_at
  )
  SELECT
    x.order_type, x.order_nbr, x.line_nbr, x.status, x.customer_id, x.customer_name,
    x.customer_order, x.order_date, x.requested_on, x.ship_via, x.order_desc,
    x.inventory_id, x.line_desc, x.order_qty, x.uom, x.warehouse_id, x.raw, now()
  FROM jsonb_to_recordset(p_rows) AS x(
    order_type text, order_nbr text, line_nbr integer, status text,
    customer_id text, customer_name text, customer_order text,
    order_date date, requested_on date, ship_via text, order_desc text,
    inventory_id text, line_desc text, order_qty numeric, uom text,
    warehouse_id text, raw jsonb
  )
  ON CONFLICT (order_type, order_nbr, line_nbr) DO UPDATE SET
    status         = EXCLUDED.status,
    customer_id    = EXCLUDED.customer_id,
    customer_name  = EXCLUDED.customer_name,
    customer_order = EXCLUDED.customer_order,
    order_date     = EXCLUDED.order_date,
    requested_on   = EXCLUDED.requested_on,
    ship_via       = EXCLUDED.ship_via,
    order_desc     = EXCLUDED.order_desc,
    inventory_id   = EXCLUDED.inventory_id,
    line_desc      = EXCLUDED.line_desc,
    order_qty      = EXCLUDED.order_qty,
    uom            = EXCLUDED.uom,
    warehouse_id   = EXCLUDED.warehouse_id,
    raw            = EXCLUDED.raw,
    synced_at      = now();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acumatica_upsert_sales_orders(jsonb) TO service_role;

-- Readable by the app without exposing the schema directly, mirroring
-- acumatica_get_lot_details.
CREATE OR REPLACE FUNCTION public.acumatica_get_sales_orders(
  p_status text DEFAULT NULL,
  p_customer text DEFAULT NULL
)
RETURNS SETOF acumatica.sales_orders
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT *
  FROM acumatica.sales_orders
  WHERE (p_status   IS NULL OR status = p_status)
    AND (p_customer IS NULL OR customer_name ILIKE p_customer)
  ORDER BY requested_on NULLS LAST, order_nbr;
$$;

GRANT EXECUTE ON FUNCTION public.acumatica_get_sales_orders(text, text)
  TO authenticated, service_role;

-- ── Verify ──────────────────────────────────────────────────────────────────
--
--   SELECT count(*) FROM acumatica.sales_orders;              -- 0 until synced
--   SELECT public.acumatica_upsert_sales_orders('[]'::jsonb); -- 0, no error
--
-- ⚠ THEN RELOAD THE CACHE, or the app gets 404/PGRST205 on objects that exist:
--
--   NOTIFY pgrst, 'reload schema';
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--
--   DROP FUNCTION IF EXISTS public.acumatica_get_sales_orders(text, text);
--   DROP FUNCTION IF EXISTS public.acumatica_upsert_sales_orders(jsonb);
--   DROP TABLE IF EXISTS acumatica.sales_orders;
