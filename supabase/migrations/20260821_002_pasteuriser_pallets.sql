-- ============================================================
-- Pasteuriser output tagging: pallets + per-box bag numbers
-- ============================================================
--
-- WHY A PALLET TABLE AT ALL
-- The Pasteuriser packs the FINAL product, and the physical unit that
-- leaves the factory is a pallet — 45 boxes of 18kg, or a run of paper
-- bags — not a single bag. The floor asked for "one barcode that counts
-- the entire pallet and can give me the detail of every single box or
-- paper bag that is placed on it". That is a parent/child relationship
-- and it needs a parent row: a pallet has its own serial, its own
-- printed tag, and its own scan history, independent of the boxes on it.
--
-- Encoding the pallet into the box serial instead (e.g. LOT-P01-001) was
-- rejected: it makes the pallet un-scannable on its own, and it bakes a
-- grouping decision into an immutable primary key — so a re-palletised
-- box (a short pallet consolidated before dispatch, which happens) would
-- need its serial rewritten, breaking every scan_event already logged
-- against it. A nullable FK lets a box move pallets while keeping its
-- identity, which is exactly what traceability requires.
--
-- bag_tags.bag_number is the PHYSICAL bag/box number the operator writes
-- on the paperwork (PR-FM-005's "Starting bag number" / "Ending Bag
-- Number" columns — e.g. bags 281 through 315). It is deliberately
-- separate from the serial: the serial is system identity and is never
-- reused, whereas bag_number restarts at 1 for every batch and is what
-- the floor and the customer actually count in. Storing it explicitly
-- means the printed tag can read "Bag 281 of 315" without re-deriving it
-- by string-parsing the serial.
--
-- NOTE ON GRADE: final product carries NO grade (confirmed with the
-- production floor 2026-08-21). Grade (A Export / B Export Blend /
-- C Domestic) is a RAW-MATERIAL concept that stops at the blender — a
-- finished blend is by definition a mixture of grades (the Kunitaro SFC
-- job card is 50% A-grade + 45% B-grade + 5% granules), so stamping any
-- single letter on the tag would be false. Final-product tags show the
-- VARIANT only (CON / ORG / RA CON / RA ORG). No grade column is added
-- here, and the final-product label template omits the grade half of the
-- badge rather than defaulting it.
-- ============================================================

CREATE TABLE IF NOT EXISTS production.pallets (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Scannable pallet identity. Same Code 128 / serial-only convention as
  -- bag_tags.serial_number, so one scan box handles both: the lookup
  -- tries a bag first, then a pallet.
  pallet_serial      text        NOT NULL UNIQUE,

  section_id         text        NOT NULL DEFAULT 'pasteuriser',
  session_id         uuid        REFERENCES production.prod_sessions(id) ON DELETE SET NULL,

  -- What is on the pallet. Denormalised from the bagging line on purpose:
  -- a dispatched pallet must still print and report correctly years later
  -- even if the session draft is edited or the job card is superseded.
  lot_number         text,
  item               text,
  acumatica_id       text,
  variant            text,
  packaging          text,

  -- Planned vs actual. pallet_size is the packaging spec's boxes-per-pallet
  -- (45 for the standard box pallet) and box_count is what is physically on
  -- THIS pallet — they differ on the last, short pallet of a batch, which is
  -- normal and must not read as an error.
  pallet_size        integer,
  box_count          integer     NOT NULL DEFAULT 0,
  box_weight_kg      numeric,
  total_kg           numeric,

  -- Physical bag/box number range carried on the pallet (PR-FM-005).
  start_bag_no       integer,
  end_bag_no         integer,

  status             text        NOT NULL DEFAULT 'in_stock'
                       CHECK (status IN ('in_stock','dispatched','void')),

  -- Mirrors bag_tags: a tag is either printed or hand-written, and we
  -- record which, because the paper→system transition means both are
  -- legitimate and the audit needs to tell them apart.
  tag_method         text        CHECK (tag_method IN ('printed','handwritten')),
  printed_at         timestamptz,

  batch_id           uuid        REFERENCES production.batches(id),
  created_by         uuid        REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pallets_session_idx  ON production.pallets(session_id);
CREATE INDEX IF NOT EXISTS pallets_lot_idx      ON production.pallets(lot_number);
CREATE INDEX IF NOT EXISTS pallets_batch_idx    ON production.pallets(batch_id);
CREATE INDEX IF NOT EXISTS pallets_section_idx  ON production.pallets(section_id);

DROP TRIGGER IF EXISTS pallets_updated_at ON production.pallets;
CREATE TRIGGER pallets_updated_at
  BEFORE UPDATE ON production.pallets
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

-- ── Boxes/bags → pallet ─────────────────────────────────────────────────
-- ON DELETE SET NULL, not CASCADE: deleting a mis-keyed pallet grouping
-- must never delete the physical boxes' tags with it.
ALTER TABLE production.bag_tags
  ADD COLUMN IF NOT EXISTS pallet_id  uuid REFERENCES production.pallets(id) ON DELETE SET NULL;

ALTER TABLE production.bag_tags
  ADD COLUMN IF NOT EXISTS bag_number integer;

CREATE INDEX IF NOT EXISTS bag_tags_pallet_idx ON production.bag_tags(pallet_id)
  WHERE pallet_id IS NOT NULL;

-- ── Security — matches bag_tags / batches exactly ───────────────────────
GRANT USAGE ON SCHEMA production TO authenticated, service_role;
GRANT ALL ON production.pallets TO authenticated, service_role;

ALTER TABLE production.pallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_pallets" ON production.pallets;
CREATE POLICY "authenticated_all_pallets"
  ON production.pallets FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── Pallet detail view — one scan → every box on it ─────────────────────
-- The "scan the pallet, see all 45 boxes" read path. A view (not a join in
-- the client) so the same shape serves the capture screen, Bag Tracking,
-- and dispatch without three copies of the aggregate drifting apart.
CREATE OR REPLACE VIEW production.v_pallet_contents AS
SELECT
  p.id                AS pallet_id,
  p.pallet_serial,
  p.section_id,
  p.lot_number,
  p.item,
  p.acumatica_id,
  p.variant,
  p.packaging,
  p.pallet_size,
  p.box_count         AS declared_box_count,
  p.start_bag_no,
  p.end_bag_no,
  p.total_kg          AS declared_total_kg,
  p.status,
  p.tag_method,
  p.printed_at,
  p.created_at,
  COUNT(t.serial_number)                          AS actual_box_count,
  COALESCE(SUM(t.weight_kg), 0)                   AS actual_total_kg,
  COUNT(t.serial_number) FILTER (WHERE t.consumed) AS boxes_consumed,
  ARRAY_AGG(t.serial_number ORDER BY t.bag_number NULLS LAST, t.serial_number)
    FILTER (WHERE t.serial_number IS NOT NULL)    AS box_serials
FROM production.pallets p
LEFT JOIN production.bag_tags t ON t.pallet_id = p.id
GROUP BY p.id;

GRANT SELECT ON production.v_pallet_contents TO authenticated, service_role;
