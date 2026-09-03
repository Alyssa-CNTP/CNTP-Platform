-- ============================================================
-- Acumatica lot details — typed landing table + public RPCs
-- Run in: Supabase SQL Editor (staging: qjqkpockmujecjgmdple).
-- Re-runnable (idempotent). Mirrors 20260615_004 (sales_lines).
-- ============================================================
--
-- Stock on hand by lot × item × warehouse, pulled from Acumatica's contract-REST
-- LotDetail endpoint (lib/acumatica/lot-sync.ts). Drives live stock-on-hand +
-- ageing (harvest_year) + the grade-balance metric (item_class / product_group).
--
-- DB access goes through SECURITY DEFINER functions in `public` (always exposed),
-- so we don't depend on the `acumatica` schema being exposed to the Data API.
-- search_path pinned to '' and all objects schema-qualified (same hardening as 002).
-- ============================================================

CREATE TABLE IF NOT EXISTS acumatica.lot_details (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inventory_id        text,
  description         text,
  item_category       text,
  item_class          text,
  product_group       text,
  variant             text,
  lot_serial_nbr      text,
  supplier_lot_number text,
  harvest_year        text,
  warehouse_id        text,
  location_id         text,
  qty_on_hand         numeric,
  qty_available       numeric,
  tea_court           text,
  land_name           text,
  synced_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lot_details_warehouse_idx  ON acumatica.lot_details(warehouse_id);
CREATE INDEX IF NOT EXISTS lot_details_item_class_idx ON acumatica.lot_details(item_class);
CREATE INDEX IF NOT EXISTS lot_details_inventory_idx  ON acumatica.lot_details(inventory_id);

-- Grants for the API roles (RLS ≠ grants). Mirrors 20260615_004.
GRANT USAGE ON SCHEMA acumatica TO authenticated, service_role;
GRANT ALL ON acumatica.lot_details TO authenticated, service_role;

ALTER TABLE acumatica.lot_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_all_lot_details ON acumatica.lot_details;
CREATE POLICY auth_all_lot_details ON acumatica.lot_details
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- RPC: atomic full-replace of the lot details.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acumatica_replace_lot_details(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- WHERE true satisfies the `safeupdate` extension (blocks unqualified DELETE).
  DELETE FROM acumatica.lot_details WHERE true;

  INSERT INTO acumatica.lot_details (
    inventory_id, description, item_category, item_class, product_group, variant,
    lot_serial_nbr, supplier_lot_number, harvest_year, warehouse_id, location_id,
    qty_on_hand, qty_available, tea_court, land_name
  )
  SELECT
    x.inventory_id, x.description, x.item_category, x.item_class, x.product_group, x.variant,
    x.lot_serial_nbr, x.supplier_lot_number, x.harvest_year, x.warehouse_id, x.location_id,
    x.qty_on_hand, x.qty_available, x.tea_court, x.land_name
  FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS x(
    inventory_id        text,
    description         text,
    item_category       text,
    item_class          text,
    product_group       text,
    variant             text,
    lot_serial_nbr      text,
    supplier_lot_number text,
    harvest_year        text,
    warehouse_id        text,
    location_id         text,
    qty_on_hand         numeric,
    qty_available       numeric,
    tea_court           text,
    land_name           text
  );

  RETURN (SELECT count(*)::int FROM acumatica.lot_details);
END;
$$;

-- ------------------------------------------------------------
-- RPC: read lot details, optionally filtered to one warehouse.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acumatica_get_lot_details(p_warehouse text DEFAULT NULL)
RETURNS SETOF acumatica.lot_details
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT * FROM acumatica.lot_details
  WHERE p_warehouse IS NULL OR warehouse_id = p_warehouse;
$$;

-- Lock down: revoke the default PUBLIC execute, then grant narrowly.
REVOKE ALL ON FUNCTION public.acumatica_replace_lot_details(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acumatica_get_lot_details(text)      FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acumatica_replace_lot_details(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.acumatica_get_lot_details(text)      TO authenticated, service_role;
