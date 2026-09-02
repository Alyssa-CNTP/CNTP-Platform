-- ============================================================
-- Database-side bag serial allocation.  ARCHITECTURE.md §5.
-- ============================================================
--
-- Every capture section currently mints its own serials by reading the highest
-- existing number and adding one:
--
--     SELECT serial_number FROM bag_tags WHERE serial_number LIKE '<stem>%' LIMIT 4000
--     -> max(seq) + 1
--
-- Two operators adding a bag in the same moment both read the same max and
-- both mint max+1. One of the two rows then loses its unique-index race and is
-- dropped. This is the documented cause of 44% of Fine/Coarse Leaf bags going
-- missing from prod_bagging and 7 of 24 Sieving bags never reaching bag_tags
-- (ARCHITECTURE.md §1B). The `limit(4000)` compounds it: past 4000 rows the
-- scan reads a wrong max and the next bag collides with an existing one.
--
-- The fix is to allocate the number where the lock lives. A single INSERT ..
-- ON CONFLICT DO UPDATE .. RETURNING takes a row lock on the counter, so two
-- concurrent callers serialise and get 7 and 8 rather than 7 and 7.
--
-- SCOPE is the counting scope, not the serial prefix. They differ on the
-- Granule Line: scope 'GLSG-RSGG-05626' has no date in it, because one lot
-- runs across several days and must read as one continuous sequence, while
-- the serial it produces still carries the day the bag was made
-- ('GLSG-RSGG-05626-01092026-007'). lib/core/serials.ts is the only thing that
-- builds either string; this function never parses or formats a serial, it
-- only counts.

-- ── The counters ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS production.bag_serial_counters (
  scope       text PRIMARY KEY,
  last_seq    integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE production.bag_serial_counters IS
  'One row per bag-serial counting scope. last_seq is the highest number ever ALLOCATED, not the bag count: a deleted bag leaves a gap and numbers are never re-packed, because re-packing would renumber bags already printed, already scanned into the next section and already on an order. Count bag_tags rows for a true count.';

-- ── Allocation ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION production.next_bag_seq(p_scope text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = production, public
AS $$
  INSERT INTO production.bag_serial_counters AS c (scope, last_seq)
  VALUES (btrim(p_scope), 1)
  ON CONFLICT (scope) DO UPDATE
    SET last_seq = c.last_seq + 1, updated_at = now()
  RETURNING last_seq;
$$;

COMMENT ON FUNCTION production.next_bag_seq(text) IS
  'Atomically allocate the next sequence number for a bag-serial scope. Callers pass serialScope() from lib/core/serials.ts and render the serial themselves — this returns a number, never a serial string.';

GRANT EXECUTE ON FUNCTION production.next_bag_seq(text) TO authenticated, service_role;
GRANT SELECT ON production.bag_serial_counters TO authenticated, service_role;

ALTER TABLE production.bag_serial_counters ENABLE ROW LEVEL SECURITY;

-- Read-only to clients; the counter only ever moves through the function
-- above, which is SECURITY DEFINER and therefore bypasses this.
DROP POLICY IF EXISTS bag_serial_counters_read ON production.bag_serial_counters;
CREATE POLICY bag_serial_counters_read ON production.bag_serial_counters
  FOR SELECT TO authenticated USING (true);

-- ── Seeding ──────────────────────────────────────────────────────────────────
--
-- A fresh counter starts at 0, which is right for a scope that has never been
-- used and WRONG for one that already has bags. Only scopes that survive the
-- change of format can already have bags, and there is exactly one: the
-- Granule Line, where the counting scope is the LOT and a lot in progress
-- today keeps running tomorrow under the new serial format.
--
-- Historic Granule serials are '{LOT}-{NNN}' with no type code, so a single
-- lot's existing bags cannot be attributed to SG, SF or EXP after the fact.
-- All three scopes for that lot are therefore seeded to the lot's highest
-- existing number. That over-seeds two of the three — the first SF bag of a
-- lot whose SG bags reached 40 starts at 41 — which costs some gaps and is
-- explicitly fine (see the table comment). Under-seeding would instead reprint
-- a number that is already on a bag in the warehouse.

INSERT INTO production.bag_serial_counters (scope, last_seq)
SELECT scope, max_seq
FROM (
  SELECT
    'GL' || t.type_code || '-' || b.lot_number AS scope,
    MAX(regexp_replace(b.serial_number, '^.*-(\d+)$', '\1')::int) AS max_seq
  FROM production.bag_tags b
  CROSS JOIN (VALUES ('SG'), ('SF'), ('EXP')) AS t(type_code)
  WHERE b.section_id = 'granule'
    AND COALESCE(btrim(b.lot_number), '') <> ''
    -- Deliberately '\d+', not the app's '\d{1,4}': seqOf() silently reads a
    -- five-digit sequence as 0, and a seed that read 0 for a lot which had
    -- reached 10000 bags would reprint numbers already on the floor. Seeding
    -- errs high — allocation gaps are free, collisions are not.
    AND b.serial_number ~ '-\d+$'
    -- No status filter, on purpose. A voided or rejected bag still had its
    -- number allocated and very likely printed, so it must never be handed
    -- out again: gaps are fine, reuse is not (see the table comment).
  GROUP BY 1
) s
WHERE max_seq > 0
ON CONFLICT (scope) DO UPDATE
  SET last_seq = GREATEST(production.bag_serial_counters.last_seq, EXCLUDED.last_seq),
      updated_at = now();

-- The date-scoped sections (ST, R1, R2, BL, SB) need no seeding: their scope
-- contains a four-digit year, so it cannot collide with a legacy six-digit
-- stem, and every scope minted from here is new. On the changeover day a
-- product will show both 'STFL-010926-005' (legacy) and 'STFL-01092026-001'
-- (new). Those are different bags with different serials — nothing is
-- duplicated — but the numbers restart, so do not read a bag count off the
-- highest number that day. Reporting already counts bag_tags rows.

-- ── Verification ─────────────────────────────────────────────────────────────
--
-- Seeded Granule lots, highest first — sanity-check a few against the bags on
-- the floor before the app starts allocating:
--
--   SELECT scope, last_seq FROM production.bag_serial_counters
--   ORDER BY last_seq DESC LIMIT 20;
--
-- Allocation is atomic (run twice, expect two different numbers, then clean up):
--
--   SELECT production.next_bag_seq('SELFTEST-scope');
--   SELECT production.next_bag_seq('SELFTEST-scope');
--   DELETE FROM production.bag_serial_counters WHERE scope = 'SELFTEST-scope';
