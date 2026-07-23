-- ============================================================
-- CNTP Production — Canonical Batch Identity Spine
-- Run in: Supabase SQL Editor (staging qjqkpockmujecjgmdple first, then prod)
-- Depends on: 20260611_001_production_capture.sql, 20260706_001_production_runs.sql
-- ============================================================
--
-- The same physical batch is stored as lot_number / batch_number / batch_no /
-- batch_code across the production, qms and logistics schemas, with no foreign
-- keys — joins today are fragile string-equality (the sieving quality page even
-- hand-normalizes "GS - 0098" -> "GS-0098"). This migration introduces ONE
-- canonical identity:
--   • production.normalize_batch(text) — the single source of truth for the
--     canonical form of a lot/batch string. Mirrored in TS: lib/production/batch-key.ts.
--   • production.batches — a batch dimension keyed on the normalized batch_key.
--   • batch_id FK on the five production capture tables, backfilled by match.
--
-- qms.* tables are NOT in repo migrations and have drifted; FKs can't cross
-- schemas cleanly, so they are intentionally NOT altered here. The Phase-2 view
-- layer joins qms -> batches via normalize_batch() instead.
--
-- ⚠ RUN PART 1 AND PART 2 AS SEPARATE EXECUTIONS. ⚠
-- The SQL editor runs a script as ONE transaction. PART 2 alters hot capture
-- tables (prod_sessions etc.) which need brief exclusive locks; committing PART 1
-- first (function + dimension table) keeps those locks short and independent.
-- Highlight PART 1, Run. Then highlight PART 2, Run.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PART 1 — normalizer + batches dimension (run on its own, first)
-- ════════════════════════════════════════════════════════════

-- ── normalize_batch — canonical form of a lot/batch string ────
-- Rules (kept deliberately conservative so distinct batches never merge):
--   • upper-case + trim
--   • collapse whitespace around hyphens:  "GS - 0098" -> "GS-0098"
--   • collapse any remaining whitespace runs to a single space
--   • empty string -> NULL
-- IMMUTABLE so it can be used in generated columns / indexes / views.
-- KEEP IN SYNC with lib/production/batch-key.ts normalizeBatch().
CREATE OR REPLACE FUNCTION production.normalize_batch(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    btrim(
      regexp_replace(
        regexp_replace(upper(btrim(p)), '\s*-\s*', '-', 'g'),
        '\s+', ' ', 'g'
      )
    ),
    ''
  )
$$;

-- ── batches — canonical batch dimension ───────────────────────
CREATE TABLE IF NOT EXISTS production.batches (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_key     text        NOT NULL UNIQUE,   -- normalize_batch() output; the join key
  display_lot   text,                          -- a representative raw lot string, for UI
  variant       text,                          -- best-known variant (first non-null seen)
  first_section text,                          -- section where first observed
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS batches_batch_key_idx ON production.batches(batch_key);

-- ── Backfill batches from every known lot source ──────────────
-- Union all distinct normalized lots from the capture tables, keeping one
-- representative raw lot + variant per key. bag/debag/bagging lots are largely
-- subsets of sessions but are included so nothing is missed.
INSERT INTO production.batches (batch_key, display_lot, variant, first_section)
SELECT DISTINCT ON (bk)
  bk, raw_lot, variant, section_id
FROM (
  SELECT production.normalize_batch(lot_number) AS bk, lot_number AS raw_lot, variant, section_id, created_at
    FROM production.prod_sessions   WHERE lot_number IS NOT NULL
  UNION ALL
  SELECT production.normalize_batch(lot_number), lot_number, variant, section_id, created_at
    FROM production.bag_tags        WHERE lot_number IS NOT NULL
  UNION ALL
  SELECT production.normalize_batch(lot_number), lot_number, variant, section_id, opened_at
    FROM production.production_runs WHERE lot_number IS NOT NULL
) src
WHERE bk IS NOT NULL
ORDER BY bk, created_at ASC
ON CONFLICT (batch_key) DO NOTHING;

-- ── Grants + RLS (matches every other capture table) ──────────
GRANT USAGE ON SCHEMA production TO authenticated, service_role;
GRANT ALL ON production.batches TO authenticated, service_role;

ALTER TABLE production.batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_batches" ON production.batches;
CREATE POLICY "authenticated_all_batches"
  ON production.batches FOR ALL TO authenticated
  USING (true) WITH CHECK (true);


-- ════════════════════════════════════════════════════════════
-- PART 2 — add + backfill batch_id on capture tables (run SECOND)
-- ════════════════════════════════════════════════════════════
-- lock_timeout makes the brief exclusive locks fail fast instead of hanging if
-- the app is mid-query. Adding a nullable column + FK is instant once granted;
-- just re-run PART 2 if any statement times out.
SET lock_timeout = '5s';

-- prod_sessions
ALTER TABLE production.prod_sessions
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES production.batches(id);
UPDATE production.prod_sessions s
   SET batch_id = b.id
  FROM production.batches b
 WHERE s.batch_id IS NULL
   AND s.lot_number IS NOT NULL
   AND b.batch_key = production.normalize_batch(s.lot_number);
CREATE INDEX IF NOT EXISTS prod_sessions_batch_idx ON production.prod_sessions(batch_id);

-- bag_tags
ALTER TABLE production.bag_tags
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES production.batches(id);
UPDATE production.bag_tags t
   SET batch_id = b.id
  FROM production.batches b
 WHERE t.batch_id IS NULL
   AND t.lot_number IS NOT NULL
   AND b.batch_key = production.normalize_batch(t.lot_number);
CREATE INDEX IF NOT EXISTS bag_tags_batch_idx ON production.bag_tags(batch_id);

-- prod_debagging
ALTER TABLE production.prod_debagging
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES production.batches(id);
UPDATE production.prod_debagging d
   SET batch_id = b.id
  FROM production.batches b
 WHERE d.batch_id IS NULL
   AND d.lot_number IS NOT NULL
   AND b.batch_key = production.normalize_batch(d.lot_number);
CREATE INDEX IF NOT EXISTS prod_debagging_batch_idx ON production.prod_debagging(batch_id);

-- prod_bagging
ALTER TABLE production.prod_bagging
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES production.batches(id);
UPDATE production.prod_bagging g
   SET batch_id = b.id
  FROM production.batches b
 WHERE g.batch_id IS NULL
   AND g.lot_number IS NOT NULL
   AND b.batch_key = production.normalize_batch(g.lot_number);
CREATE INDEX IF NOT EXISTS prod_bagging_batch_idx ON production.prod_bagging(batch_id);

-- production_runs
ALTER TABLE production.production_runs
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES production.batches(id);
UPDATE production.production_runs r
   SET batch_id = b.id
  FROM production.batches b
 WHERE r.batch_id IS NULL
   AND r.lot_number IS NOT NULL
   AND b.batch_key = production.normalize_batch(r.lot_number);
CREATE INDEX IF NOT EXISTS production_runs_batch_idx ON production.production_runs(batch_id);
