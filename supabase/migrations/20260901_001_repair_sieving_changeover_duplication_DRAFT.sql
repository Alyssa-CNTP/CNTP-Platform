-- 20260901_001_repair_sieving_changeover_duplication — DRAFT, NOT YET RUN
-- ---------------------------------------------------------------------------
-- Repairs the Sieving sessions whose debagging inputs were multiplied by the
-- mid-shift changeover. This is a DATA repair only — no schema change. The code
-- defect it cleans up after is fixed separately in
-- components/production/capture/SievingCapture.tsx.
--
-- WHAT HAPPENED
--   SievingCapture's debag self-heal reads production.prod_debagging scoped to
--   session_id. That table carries NO batch discriminator, so after a changeover
--   every batch's rows sit under one session id. The component is mounted with
--   key={active.id}, so a changeover remounts it against a brand-new EMPTY batch;
--   the self-heal then read the whole session as "missing from this batch" and
--   restored a copy of all of it into the new batch. persist() wrote that back,
--   so each changeover DOUBLED the session's input rows:
--
--     batch:  P1   P2   P3   P4   P5    P6
--     bags:   10    8   16   32   64   128   = 258 rows, 90 300 kg
--
--   Observed on production, sieving / 2026-09-01 / morning: 258 farm-bag rows of
--   an identical bag (E-744, lot GS-0314, 350.0 kg), Total Input 90 336 kg
--   against 4 260 kg out — a +86 076 kg variance, and 259 rows on the production
--   order's Debagging panel.
--
--   Only INPUTS multiplied. Both self-heal effects built their patch from the
--   same mount-time `value` closure, so the debag restore clobbered the output
--   restore whenever its query resolved last. bag_tags is therefore UNTOUCHED
--   and remains the trustworthy record of output bags.
--
-- THE REPAIR, AND WHY IT IS SHAPED THIS WAY
--   A copied batch cannot be told from a real one row-by-row: the copies are
--   byte-identical to the originals. What identifies them is the doubling
--   itself — batch k holds exactly the union of batches 1..k-1. So this script
--   does NOT guess. Step 1 prints the shape for a human to read; Step 2 keeps an
--   explicitly-listed set of batches and drops the rest.
--
--   draft_data is the thing that must be corrected. persist() rewrites every
--   input row for a session from draft_data on each save (insert-then-delete,
--   see [section]/page.tsx), so a stale prod_debagging would be re-derived
--   anyway; Step 2 clears it too, only so the order panels read correctly
--   immediately instead of at the operator's next save.
--
-- ORDER OF OPERATIONS — READ THIS
--   1. Deploy the SievingCapture fix FIRST. Repairing before the fix is live
--      only buys time until the next changeover.
--   2. The operator's tablet must have the affected session CLOSED, or be
--      reloaded straight after the repair. A tab left open holds the corrupt
--      `productions` in React state and its 2.5s autosave writes it back.
--   3. localStorage does not need clearing: the recovery path in
--      [section]/page.tsx prefers the local draft only when the DB row has no
--      capture data, which is not the case after this repair.
-- ---------------------------------------------------------------------------

-- ── STEP 1 — INSPECT (read-only; run this first, decide, then run Step 2) ────
-- Per batch: its index, variant/grade, farm-bag row count and input kg, plus its
-- output bags. A run of counts doubling (8, 16, 32, 64 …) is the fingerprint.
WITH s AS (
  SELECT id, date, shift, status, draft_data
    FROM production.prod_sessions
   WHERE section_id = 'sieving'
     AND date = DATE '2026-09-01'          -- set the affected run day
     AND shift = 'morning'                 -- and shift
)
SELECT s.id                                   AS session_id,
       s.status,
       p.idx                                  AS batch_no,
       p.batch->>'variant'                    AS variant,
       p.batch->>'grade'                      AS grade,
       jsonb_array_length(COALESCE(p.batch->'data'->'debag', '[]'::jsonb))   AS debag_rows,
       (SELECT COALESCE(SUM((r->>'nett')::numeric), 0)
          FROM jsonb_array_elements(COALESCE(p.batch->'data'->'debag', '[]'::jsonb)) r) AS debag_kg,
       jsonb_array_length(COALESCE(p.batch->'data'->'outputs', '[]'::jsonb)) AS output_rows,
       (SELECT COALESCE(SUM((b->>'weight')::numeric), 0)
          FROM jsonb_array_elements(COALESCE(p.batch->'data'->'outputs', '[]'::jsonb)) b) AS output_kg
  FROM s,
       LATERAL jsonb_array_elements(COALESCE(s.draft_data->'productions', '[]'::jsonb))
               WITH ORDINALITY AS p(batch, idx)
 ORDER BY s.id, p.idx;

-- Cross-check the ledger rows, and the output bags in bag_tags (NOT corrupted —
-- this is the honest output figure). Substitute the session id from Step 1:
--
--   SELECT product_type, notes, lot_number, kg_nett, COUNT(*)
--     FROM production.prod_debagging
--    WHERE session_id = '<session_id>'
--    GROUP BY 1,2,3,4 ORDER BY COUNT(*) DESC;
--
--   SELECT COUNT(*) AS bags, SUM(weight_kg) AS kg
--     FROM production.bag_tags
--    WHERE session_id = '<session_id>' AND status <> 'voided';


-- ── STEP 2 — REPAIR (edit the markers, then run) ────────────────────────────
-- Keeps the batches listed in the keep array (1-based, matching batch_no from
-- Step 1) and drops every other batch from draft_data.productions.
--
-- For the 2026-09-01 morning session above the genuine batch is P1 alone: P2 was
-- a copy of P1 as it stood at the first changeover, and P3..P6 are copies of
-- copies. P3's 1 830 kg of output is a copy too — the output restore winning one
-- remount's race — and those bags are still in bag_tags under P1's own serials,
-- so nothing real is lost by dropping P3. CONFIRM AGAINST STEP 1 BEFORE RUNNING:
-- on another session the answer may be '{1,2}' or wider.

BEGIN;

WITH target AS (
  SELECT id, draft_data
    FROM production.prod_sessions
   WHERE section_id = 'sieving'
     AND date = DATE '2026-09-01'          -- same run day as Step 1
     AND shift = 'morning'                 -- same shift
     AND status <> 'approved'              -- never rewrite a signed-off record
), keep AS (
  SELECT t.id,
         jsonb_agg(p.batch ORDER BY p.idx) AS kept
    FROM target t,
         LATERAL jsonb_array_elements(COALESCE(t.draft_data->'productions', '[]'::jsonb))
                 WITH ORDINALITY AS p(batch, idx)
   WHERE p.idx = ANY ('{1}'::int[])        -- the batches to KEEP (from Step 1)
   GROUP BY t.id
)
UPDATE production.prod_sessions s
   SET draft_data = jsonb_set(s.draft_data, '{productions}', k.kept),
       updated_at = NOW()
  FROM keep k
 WHERE s.id = k.id
   -- Idempotent: once the session holds only the kept batches there is nothing
   -- to do, so re-running is a no-op rather than a second rewrite.
   AND s.draft_data->'productions' <> k.kept;

-- Clear the multiplied input rows so the order panels read correctly at once.
-- Farm-bag rows only: the bucket-elevator and machine-spillage rows
-- (is_spillage = true) were never part of the duplication.
DELETE FROM production.prod_debagging d
 USING production.prod_sessions s
 WHERE d.session_id = s.id
   AND s.section_id = 'sieving'
   AND s.date = DATE '2026-09-01'          -- same run day
   AND s.shift = 'morning'                 -- same shift
   AND d.is_spillage = false
   AND d.product_type IN ('Farm Bag', '500kg Farm Bag');

-- Inspect the result, then COMMIT (or ROLLBACK if it does not read right).
-- The operator's next save — or an explicit Save on a reloaded tab — reinserts
-- the kept batch's farm bags. Confirm the balance lands inside ±1% of input.
SELECT id, status,
       jsonb_array_length(draft_data->'productions') AS batches_now,
       (SELECT COUNT(*) FROM production.prod_debagging WHERE session_id = ps.id) AS debag_rows_now
  FROM production.prod_sessions ps
 WHERE section_id = 'sieving' AND date = DATE '2026-09-01' AND shift = 'morning';

COMMIT;


-- ── STEP 3 — SWEEP for any other session hit by this ────────────────────────
-- Every Sieving session since the self-heal shipped (#819, 2026-08-26) with more
-- than one batch and an input total wildly past its output. Run Steps 1-2 for
-- each row this returns.
WITH per_session AS (
  SELECT s.id, s.date, s.shift, s.status,
         jsonb_array_length(COALESCE(s.draft_data->'productions', '[]'::jsonb)) AS batches,
         (SELECT COALESCE(SUM((r->>'nett')::numeric), 0)
            FROM jsonb_array_elements(COALESCE(s.draft_data->'productions', '[]'::jsonb)) p,
                 jsonb_array_elements(COALESCE(p->'data'->'debag', '[]'::jsonb)) r)   AS in_kg,
         (SELECT COALESCE(SUM((b->>'weight')::numeric), 0)
            FROM jsonb_array_elements(COALESCE(s.draft_data->'productions', '[]'::jsonb)) p,
                 jsonb_array_elements(COALESCE(p->'data'->'outputs', '[]'::jsonb)) b) AS out_kg
    FROM production.prod_sessions s
   WHERE s.section_id = 'sieving'
     AND s.date >= DATE '2026-08-26'
)
SELECT *, in_kg - out_kg AS variance_kg
  FROM per_session
 WHERE batches > 1
   AND in_kg > out_kg * 2      -- a real shift never doubles its own output
 ORDER BY date DESC, shift;
