-- ============================================================
-- Sales order columns the live payload turned out to carry.
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- Then:   NOTIFY pgrst, 'reload schema';
-- ============================================================
--
-- 20260907_004 was written without Acumatica credentials, against the standard
-- SalesOrder entity. The endpoint has since been probed (Default/24.200.001)
-- and the real payload carries four things worth querying on that the guess
-- did not include.
--
-- All four are per LINE, not per order, which is the point: one line of an
-- order can be finished while another is still open, and a job card is raised
-- against a line.
-- ============================================================

ALTER TABLE acumatica.sales_orders
  ADD COLUMN IF NOT EXISTS external_ref text,
  ADD COLUMN IF NOT EXISTS open_qty     numeric,
  ADD COLUMN IF NOT EXISTS completed    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ship_on      date;

COMMENT ON COLUMN acumatica.sales_orders.open_qty IS
  'Quantity still to ship, in the LINE UOM — not kilograms. See order_qty.';

COMMENT ON COLUMN acumatica.sales_orders.order_qty IS
  'Quantity in the line UOM. ⚠ NOT A MASS. Real lines use UOM "BV18KG", an 18kg '
  'bulk vessel, so order_qty 3000 is 3000 BAGS = 54 000 kg. The paper job card '
  'says the same from the other side: 18 000 kg = 1000 bags x 18 kg. Anything '
  'displaying kg must multiply by the UOM weight.';

COMMENT ON COLUMN acumatica.sales_orders.completed IS
  'Per line. A line can be complete while its order is still open.';

-- Finding the work still to do is the job-card picker's whole query.
CREATE INDEX IF NOT EXISTS sales_orders_open_idx
  ON acumatica.sales_orders (completed, ship_on)
  WHERE completed = false;

-- ── The upsert has to carry them too ────────────────────────────────────────
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
    inventory_id, line_desc, order_qty, uom, warehouse_id,
    external_ref, open_qty, completed, ship_on, raw, synced_at
  )
  SELECT
    x.order_type, x.order_nbr, x.line_nbr, x.status, x.customer_id, x.customer_name,
    x.customer_order, x.order_date, x.requested_on, x.ship_via, x.order_desc,
    x.inventory_id, x.line_desc, x.order_qty, x.uom, x.warehouse_id,
    x.external_ref, x.open_qty, coalesce(x.completed, false), x.ship_on, x.raw, now()
  FROM jsonb_to_recordset(p_rows) AS x(
    order_type text, order_nbr text, line_nbr integer, status text,
    customer_id text, customer_name text, customer_order text,
    order_date date, requested_on date, ship_via text, order_desc text,
    inventory_id text, line_desc text, order_qty numeric, uom text,
    warehouse_id text, external_ref text, open_qty numeric, completed boolean,
    ship_on date, raw jsonb
  )
  ON CONFLICT (order_type, order_nbr, line_nbr) DO UPDATE SET
    status         = EXCLUDED.status,
    customer_id    = EXCLUDED.customer_id,
    -- Never overwrite a resolved name with a null: the Customer fetch is
    -- best-effort, and a failed one must not blank every name already stored.
    customer_name  = coalesce(EXCLUDED.customer_name, acumatica.sales_orders.customer_name),
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
    external_ref   = EXCLUDED.external_ref,
    open_qty       = EXCLUDED.open_qty,
    completed      = EXCLUDED.completed,
    ship_on        = EXCLUDED.ship_on,
    raw            = EXCLUDED.raw,
    synced_at      = now();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acumatica_upsert_sales_orders(jsonb) TO service_role;

-- ── Verify ──────────────────────────────────────────────────────────────────
--
--   SELECT public.acumatica_upsert_sales_orders('[]'::jsonb);   -- 0, no error
--
-- ⚠ THEN:  NOTIFY pgrst, 'reload schema';
