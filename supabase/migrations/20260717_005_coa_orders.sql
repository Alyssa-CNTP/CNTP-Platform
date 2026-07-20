-- 20260717_005_coa_orders.sql
-- Logistics order/dispatch details for a COA, keyed by batch number. These
-- fields (invoice no., order number, quantities, destination) aren't known at
-- QC time — logistics fills them in later, and the COA Generator pulls them in.

CREATE TABLE IF NOT EXISTS qms.coa_orders (
  batch_no      text primary key,
  invoice_no    text,
  order_number  text,
  quantity_kg   text,
  quantity_bags text,
  destination   text,
  updated_by    text,
  updated_at    timestamptz not null default now()
);

GRANT SELECT ON qms.coa_orders TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON qms.coa_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON qms.coa_orders TO service_role;

COMMENT ON TABLE qms.coa_orders IS 'Logistics order/dispatch details for a COA, keyed by batch — invoice, order number, quantities, destination. Entered by logistics when ready and pulled into the COA Generator.';
