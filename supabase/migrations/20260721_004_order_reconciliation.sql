-- ============================================================
-- CNTP Production — Order Reconciliation (three-way: paperwork · system · Acumatica)
-- Run in: Supabase SQL Editor (staging first, then prod)
-- Depends on: 20260611_001_production_capture.sql, 20260721_002_batch_spine.sql
-- ============================================================
--
-- Stores the manual sides of the production-order accuracy check so it becomes an
-- auditable record, not just a live on-screen calc. The SYSTEM side is always
-- derived from the reporting views (v_batch_360 / v_output_stream); we snapshot it
-- here at reconciliation time so a frozen record survives later recaptures.
--
--   paperwork_value  — what the operator's paperwork calc says (typed in)
--   system_value     — snapshot of the system figure at reconciliation time
--   acumatica_value  — what Acumatica shows (typed in now; auto-filled once the
--                      production-order Generic Inquiry sync lands)
--
-- One row per (batch, line_key). line_key is a product stream ("Fine Leaf") or a
-- roll-up ("total_input" / "total_output" / "yield_pct").
-- ============================================================

CREATE TABLE IF NOT EXISTS production.order_reconciliation (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id         uuid        REFERENCES production.batches(id) ON DELETE CASCADE,
  batch_key        text        NOT NULL,          -- denormalized for lookup even if batch_id null
  production_order text,                            -- Acumatica PO reference, if known

  line_key         text        NOT NULL,           -- 'Fine Leaf' | 'total_output' | 'yield_pct' | ...
  line_label       text,
  unit             text        NOT NULL DEFAULT 'kg',

  paperwork_value  numeric,
  system_value     numeric,                         -- snapshot at reconciliation time
  acumatica_value  numeric,
  acumatica_source text        NOT NULL DEFAULT 'manual'
                     CHECK (acumatica_source IN ('manual','gi_sync')),

  note             text,
  reconciled_by    uuid        REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (batch_key, line_key)
);

CREATE INDEX IF NOT EXISTS order_recon_batch_idx ON production.order_reconciliation(batch_id);
CREATE INDEX IF NOT EXISTS order_recon_key_idx   ON production.order_reconciliation(batch_key);

DROP TRIGGER IF EXISTS order_reconciliation_updated_at ON production.order_reconciliation;
CREATE TRIGGER order_reconciliation_updated_at
  BEFORE UPDATE ON production.order_reconciliation
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

GRANT ALL ON production.order_reconciliation TO authenticated, service_role;

ALTER TABLE production.order_reconciliation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_order_reconciliation" ON production.order_reconciliation;
CREATE POLICY "authenticated_all_order_reconciliation"
  ON production.order_reconciliation FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
