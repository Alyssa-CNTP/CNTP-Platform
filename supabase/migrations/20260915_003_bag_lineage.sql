-- ============================================================
-- CNTP Production — Bag genealogy (append-only lineage ledger)
-- Run in: Supabase SQL Editor — STAGING first, then production.
-- Depends on: 20260611_001_production_capture.sql (bag_tags, prod_debagging,
--             prod_bagging), 20260818_004 (bag weight transfer provenance)
-- ============================================================
--
-- WHY THIS TABLE EXISTS
--
-- A bag's parents were never recorded anywhere. The platform could answer
-- "which section made this bag" and "where did it go", but not "what was it
-- made from" — so a batch never spanned more than one section, a recall could
-- not walk upstream, and an output bag's grade could not be inherited from the
-- material it was made of.
--
-- Three things were in the way, and the first two are fixed alongside this
-- migration rather than by it:
--
--   1. `prod_debagging.bag_serial_no` was nulled for every hand-typed input
--      bag, on a stale FK worry (see lib/core/capture-rows). That is the only
--      column joining a consumed bag to the session that consumed it, so the
--      link was destroyed at capture time. Measured on staging before the fix:
--      2 serialed input rows in the whole database, 0 of 38 on the Granule Line.
--   2. `markBagConsumed()` passed sessionId = null at all eight call sites, so
--      `scan_events.session_id` and `bag_tags.consumed_at_session` were always
--      null too.
--   3. Nothing wrote the relationship itself, and it cannot simply be derived
--      on read:
--        · `bag_tags.session_id` is deliberately null — a tag outlives the
--          session that made it, and can be topped up days later;
--        · a bag can be drawn from by more than one session (partial draws);
--        · a bag-to-bag transfer has EXACT parentage, while line consumption
--          is only ever "these inputs produced these outputs in this session" —
--          two different kinds of fact that must not be flattened into one.
--
-- So parentage becomes what ARCHITECTURE.md §6 says bag data is: an append-only
-- ledger. Nothing is deleted — a wrong link is VOIDED (voided_at set) so the
-- correction is itself part of the record, exactly as timesheet_stoppages and
-- scan_events do.
--
-- ALL CHANGES ARE ADDITIVE. No existing column, row or reader is touched.
-- ============================================================

-- ── The ledger ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production.bag_lineage (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,

  -- The bag that was PRODUCED, and one of the bags it was produced FROM.
  -- One row per (child, parent) pair, so a bag with four inputs has four rows.
  --
  -- Deliberately NOT foreign keys to bag_tags.serial_number, for two reasons
  -- that have both already cost this codebase data:
  --   · an input bag legitimately may not be in bag_tags — Refining 2 routinely
  --     runs bought-in material (ARCHITECTURE.md §5). An FK here would reject
  --     the row and, through it, the save; that is the exact 23503 failure
  --     prod_debagging spent two migrations recovering from.
  --   · scan_events.serial_number FKs bag_tags ON DELETE CASCADE. Copying that
  --     would let one deleted tag silently erase a whole genealogy.
  child_serial   text        NOT NULL,
  parent_serial  text        NOT NULL,

  -- Where the transformation happened — the section that consumed the parent
  -- and produced the child. Denormalised from the session on purpose: this is
  -- what every traversal filters on, and a session can be soft-deleted.
  section_id     text        NOT NULL,

  -- The capture session, where there is one. NULL for a bag-to-bag transfer,
  -- which is not session-scoped.
  session_id     uuid,

  -- How the parentage is known. The two are NOT interchangeable:
  --   'consumed_into'    the parent was debagged into the session that produced
  --                      the child. True at session granularity — on a
  --                      continuous line you cannot attribute a specific input
  --                      bag to a specific output bag, and pretending otherwise
  --                      would invent precision that does not exist.
  --   'transferred_from' the child's mass was drawn directly out of the parent
  --                      (half-bag top-up / rebag). Exact, per-kg, and already
  --                      recorded as a topped_up/drawn_down scan_events pair.
  --
  -- Kept as a CHECK with BOTH values listed rather than an enum: a value the
  -- constraint does not know rejects the whole save and reads on the floor as
  -- "it won't save", with nothing naming the column.
  relation       text        NOT NULL
                   CHECK (relation IN ('consumed_into', 'transferred_from')),

  -- Kg attributed to this link. Exact for 'transferred_from'. NULL for
  -- 'consumed_into' — see the note on relation: splitting a session's input
  -- across its output bags would be a guess, and the mass balance already
  -- answers the quantity question per session (ARCHITECTURE.md §5).
  parent_kg      numeric,

  operator_id    uuid        REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- Void, never delete. See the header.
  voided_at      timestamptz,
  voided_by      uuid        REFERENCES auth.users(id),

  -- A bag is not its own parent. Cheap, and it makes a self-referencing bug
  -- fail at the write instead of looping a traversal.
  CONSTRAINT bag_lineage_no_self_parent CHECK (child_serial <> parent_serial)
);

-- Per-row upsert target. A session is saved repeatedly (explicit save, the 30s
-- autosave, submit), so the same (child, parent, session, relation) fact is
-- re-asserted constantly and must land once. COALESCE because session_id is
-- null for transfers and NULLs are distinct from one another in a unique index
-- — without it every re-save of a transfer would append a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS bag_lineage_link_uidx
  ON production.bag_lineage (
    child_serial, parent_serial, relation,
    COALESCE(session_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Walk downstream (what was made from this bag) and upstream (what this bag
-- was made from). Both directions are used by the bag record's genealogy chain.
CREATE INDEX IF NOT EXISTS bag_lineage_child_idx
  ON production.bag_lineage (child_serial) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS bag_lineage_parent_idx
  ON production.bag_lineage (parent_serial) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS bag_lineage_session_idx
  ON production.bag_lineage (session_id) WHERE voided_at IS NULL;

COMMENT ON TABLE production.bag_lineage IS
  'Append-only bag genealogy: one row per (child bag, parent bag) link. Void, never delete. See ARCHITECTURE.md §6.';

-- ── Grants ────────────────────────────────────────────────────
-- Matches the rest of the production schema: the app reads and writes as the
-- signed-in user through PostgREST.
GRANT SELECT, INSERT, UPDATE ON production.bag_lineage
  TO anon, authenticated, service_role;

-- ── Read helper ───────────────────────────────────────────────
-- The bag record and any recall walk read through this rather than the table,
-- so "live links only" is defined once instead of in every caller — the same
-- reason the tolerance lives in one place (ARCHITECTURE.md §5).
CREATE OR REPLACE VIEW production.v_bag_lineage AS
SELECT l.id,
       l.child_serial,
       l.parent_serial,
       l.section_id,
       l.session_id,
       l.relation,
       l.parent_kg,
       l.created_at,
       p.product_type  AS parent_product_type,
       p.variant       AS parent_variant,
       p.destination   AS parent_grade,
       p.lot_number    AS parent_lot,
       p.weight_kg     AS parent_weight_kg,
       p.section_id    AS parent_section_id,
       c.product_type  AS child_product_type,
       c.variant       AS child_variant,
       c.lot_number    AS child_lot
FROM production.bag_lineage l
LEFT JOIN production.bag_tags p ON p.serial_number = l.parent_serial
LEFT JOIN production.bag_tags c ON c.serial_number = l.child_serial
WHERE l.voided_at IS NULL;

GRANT SELECT ON production.v_bag_lineage TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
