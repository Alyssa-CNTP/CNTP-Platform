-- ============================================================
-- Acumatica sales lines — typed landing table + public RPCs
-- Run in: Supabase SQL Editor (after 20260615_001 / _002).
-- Re-runnable (idempotent).
-- ============================================================
--
-- Unlike acumatica.sync_rows (generic JSONB landing zone), this is a TYPED table
-- for the CNTPSALESREPORT line-level AR transactions that drive the EXCO sales
-- dashboard. Having real columns lets the dashboard read from Supabase (history +
-- consistent KPIs) instead of hitting Acumatica OData live on every load.
--
-- All money is ZAR base currency (ext_price, unit_cost). cost = unit_cost * quantity.
--
-- DB access goes through SECURITY DEFINER functions in `public` (always exposed),
-- so we don't depend on the `acumatica` schema being added to the Data API's
-- exposed-schemas list. search_path is pinned to '' and all objects are
-- schema-qualified — same hardening as migration 002.
-- ============================================================

CREATE TABLE IF NOT EXISTS acumatica.sales_lines (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_name text,
  country_name  text,
  market        text,
  currency      text,
  txn_date      timestamptz,
  inventory_id  text,
  description   text,
  quantity      numeric,
  base_qty      numeric,
  ext_price     numeric,
  unit_cost     numeric,
  synced_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_lines_txn_date_idx      ON acumatica.sales_lines(txn_date);
CREATE INDEX IF NOT EXISTS sales_lines_customer_name_idx ON acumatica.sales_lines(customer_name);

-- Grants for the API roles (RLS ≠ grants). Mirrors migration 001.
GRANT USAGE ON SCHEMA acumatica TO authenticated, service_role;
GRANT ALL ON acumatica.sales_lines TO authenticated, service_role;

ALTER TABLE acumatica.sales_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_all_sales_lines ON acumatica.sales_lines;
CREATE POLICY auth_all_sales_lines ON acumatica.sales_lines
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- RPC: atomic full-replace of the sales lines (fine for ~700 rows).
-- DELETE + INSERT run in the same statement-set; on success returns the new count.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acumatica_replace_sales_lines(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- WHERE true satisfies the `safeupdate` extension (blocks unqualified DELETE).
  DELETE FROM acumatica.sales_lines WHERE true;

  INSERT INTO acumatica.sales_lines (
    customer_name, country_name, market, currency, txn_date,
    inventory_id, description, quantity, base_qty, ext_price, unit_cost
  )
  SELECT
    x.customer_name, x.country_name, x.market, x.currency, x.txn_date,
    x.inventory_id, x.description, x.quantity, x.base_qty, x.ext_price, x.unit_cost
  FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS x(
    customer_name text,
    country_name  text,
    market        text,
    currency      text,
    txn_date      timestamptz,
    inventory_id  text,
    description   text,
    quantity      numeric,
    base_qty      numeric,
    ext_price     numeric,
    unit_cost     numeric
  );

  RETURN (SELECT count(*)::int FROM acumatica.sales_lines);
END;
$$;

-- ------------------------------------------------------------
-- RPC: read all sales lines for a given calendar year.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acumatica_get_sales_lines(p_year int)
RETURNS SETOF acumatica.sales_lines
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT * FROM acumatica.sales_lines WHERE date_part('year', txn_date) = p_year;
$$;

-- Lock down: CREATE FUNCTION grants EXECUTE to PUBLIC by default. Revoke, then
-- grant narrowly. The replace RPC is service_role only (never anon/authenticated).
REVOKE ALL ON FUNCTION public.acumatica_replace_sales_lines(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acumatica_get_sales_lines(int)       FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acumatica_replace_sales_lines(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.acumatica_get_sales_lines(int)       TO authenticated, service_role;
