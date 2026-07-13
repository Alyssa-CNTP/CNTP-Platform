-- ============================================================
-- CNTP Production Capture — Blender BOM components + tag method
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260611_007_inventory.sql (production.inventory_items),
--             20260611_001_production_capture.sql (production.bag_tags)
-- ============================================================
--
-- production.bom_components is the editable master data behind the new
-- Blends page: one row per (blend BOM x component). qty_required is the
-- blend ratio as a fraction of the batch (0..1) — components for one
-- bom_id should sum to ~1.0. component_item_id / output_item_id are soft
-- references into inventory_items (see note below) so the Blends page's
-- item picker always points a blend at a real, current stock item.
--
-- output_item_id / component_item_id are intentionally NOT hard foreign
-- keys. The source spreadsheet predates a full inventory_items reconcile,
-- so some codes may not exist there yet — a hard FK would make this seed
-- (and future edits) fail outright on a stale code rather than surface it
-- as a fixable data-quality flag. The Blends page enforces the "must pick
-- from Master Inventory" rule at the UI layer and flags any row whose
-- code doesn't currently resolve.
-- ============================================================

CREATE TABLE IF NOT EXISTS production.bom_components (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id                 text NOT NULL,
  output_item_id         text NOT NULL,
  output_description     text,
  work_centre            text NOT NULL CHECK (work_centre IN ('05-BLENDER BIG', '05-BLENDER SMALL')),
  component_item_id      text NOT NULL,
  component_description  text,
  line_nbr               int NOT NULL,
  qty_required           numeric NOT NULL,
  warehouse              text,
  uom                    text,
  -- Ingredient column (A-F) for Blender capture's release-only-what's-needed UI.
  -- Seeded from a description match (see lib/production/bom.ts's matchColumn);
  -- editable on the Blends page when the auto-match is wrong for a component.
  ingredient_column      text CHECK (ingredient_column IN ('A','B','C','D','E','F')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bom_components_bom_line_idx
  ON production.bom_components(bom_id, line_nbr);
CREATE INDEX IF NOT EXISTS bom_components_bom_id_idx
  ON production.bom_components(bom_id);
CREATE INDEX IF NOT EXISTS bom_components_output_item_idx
  ON production.bom_components(output_item_id);

DROP TRIGGER IF EXISTS bom_components_updated_at ON production.bom_components;
CREATE TRIGGER bom_components_updated_at
  BEFORE UPDATE ON production.bom_components
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

ALTER TABLE production.bom_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_bom_components" ON production.bom_components;
CREATE POLICY "authenticated_all_bom_components"
  ON production.bom_components FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── Blender capture: per-bag tag method (Print label vs Write on tag) ────────
ALTER TABLE production.bag_tags
  ADD COLUMN IF NOT EXISTS tag_method text CHECK (tag_method IN ('printed', 'handwritten'));
