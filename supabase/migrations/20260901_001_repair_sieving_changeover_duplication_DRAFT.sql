-- 20260901_001_repair_sieving_changeover_duplication — DRAFT, NOT YET RUN
-- ---------------------------------------------------------------------------
-- De-duplicates the Sieving debagging rows that a mid-shift changeover copied.
-- DATA repair only, no schema change. The code defect is fixed separately in
-- components/production/capture/SievingCapture.tsx.
--
-- THE GOVERNING RULE: NOTHING IS LOST.
--   Batch records are kept — every one of them, with its variant, grade and
--   output bags. A changeover is a real event (31 Aug ran Export, then changed
--   over to Export Blend) and its batches are real records of it. Only the
--   COPIES of debagging rows come out. Where the copy signature does not hold
--   exactly, this script leaves the batch completely alone rather than guessing.
--
-- WHAT HAPPENED
--   SievingCapture's debag self-heal reads production.prod_debagging scoped to
--   session_id, and that table carries no batch discriminator, so after a
--   changeover every batch's rows sit under one session id. The component is
--   mounted with key={active.id}, so a changeover remounts it against a
--   brand-new EMPTY batch; the self-heal read the whole session as "missing from
--   this batch" and restored a copy of all of it into the new batch. persist()
--   wrote that back, so each changeover doubled the session's input rows:
--
--     batch:  P1   P2   P3   P4   P5    P6
--     rows:   10    8   16   32   64   128    = 258 rows, 90 300 kg
--
--   Sieving / 2026-09-01 / morning: 258 farm-bag rows of one identical bag
--   (E-744, lot GS-0314, 350.0 kg) — 90 336 kg in against 4 260 kg out.
--
--   That doubling is also the fingerprint that makes the repair safe: batch k
--   holds EXACTLY the union of batches 1..k-1, nothing of its own. A batch that
--   really did debag its own bags will not match that, and is skipped.
--
--   Only INPUTS multiplied. The two self-heal effects each built their patch
--   from the same mount-time `value` closure, so the debag restore clobbered the
--   output restore whenever its query resolved last. bag_tags was never touched
--   and stays the record of what was bagged — this script does not write to it,
--   to prod_bagging, or to scan_events.
--
-- ORDER OF OPERATIONS — READ THIS
--   1. Deploy the SievingCapture fix FIRST. Repairing before it is live only
--      buys time until the next changeover.
--   2. The affected session must be CLOSED on the tablet, or reloaded straight
--      after. A tab left open holds the duplicated rows in React state and its
--      2.5s autosave writes them back.
--   3. localStorage needs no clearing: [section]/page.tsx prefers the local
--      draft only when the DB row has no capture data, which is not the case.
-- ---------------------------------------------------------------------------


-- ── STEP 1 — INSPECT (read-only) ────────────────────────────────────────────
-- Per batch: how many debagging rows it holds, how many all the batches before
-- it hold, and whether it is an exact copy of them. `is_pure_copy = true` is the
-- fingerprint; those are the only rows Step 2 touches.
--
-- Set the section/date range once here and Step 2 reads the same window.
CREATE TEMP VIEW _repair_scope AS
  SELECT id, date, shift, status, draft_data
    FROM production.prod_sessions
   WHERE section_id = 'sieving'
     AND date BETWEEN DATE '2026-08-26' AND DATE '2026-09-01'   -- ← the window to repair
     AND status <> 'approved';                                  -- never rewrite a signed-off record

-- A debagging row's identity, matching lib/production/debag-reconcile.ts:
-- (operator's bag label, lot, net weight). Not unique on its own — bags off one
-- pallet are byte-identical — so everything below compares sorted multisets.
CREATE TEMP VIEW _batch_keys AS
  SELECT s.id AS session_id, s.date, s.shift, p.idx, p.batch,
         COALESCE((
           SELECT array_agg(
                    concat_ws('|',
                      btrim(COALESCE(r->>'bag_no', '')),
                      btrim(COALESCE(r->>'lot', '')),
                      round(COALESCE(NULLIF(replace(r->>'nett', ',', '.'), ''), '0')::numeric, 3))
                    ORDER BY 1)
             FROM jsonb_array_elements(COALESCE(p.batch->'data'->'debag', '[]'::jsonb)) r
         ), '{}'::text[]) AS keys
    FROM _repair_scope s,
         LATERAL jsonb_array_elements(COALESCE(s.draft_data->'productions', '[]'::jsonb))
                 WITH ORDINALITY AS p(batch, idx);

CREATE TEMP VIEW _batch_verdict AS
  SELECT b.*,
         COALESCE((
           SELECT array_agg(k ORDER BY k)
             FROM (SELECT unnest(b2.keys) AS k
                     FROM _batch_keys b2
                    WHERE b2.session_id = b.session_id AND b2.idx < b.idx) q
         ), '{}'::text[]) AS preceding_keys
    FROM _batch_keys b;

SELECT session_id, date, shift, idx AS batch_no,
       batch->>'variant' AS variant,
       batch->>'grade'   AS grade,
       COALESCE(array_length(keys, 1), 0)           AS debag_rows,
       COALESCE(array_length(preceding_keys, 1), 0) AS rows_before_it,
       jsonb_array_length(COALESCE(batch->'data'->'outputs', '[]'::jsonb)) AS output_bags,
       -- The copy signature: this batch holds exactly what preceded it, and
       -- there was something to copy. Anything false is left untouched.
       (idx > 1 AND COALESCE(array_length(keys, 1), 0) > 0 AND keys = preceding_keys) AS is_pure_copy
  FROM _batch_verdict
 ORDER BY date, shift, session_id, idx;

-- Sanity-check against the ledger before repairing:
--   SELECT notes, lot_number, kg_nett, COUNT(*)
--     FROM production.prod_debagging
--    WHERE session_id = '<session_id>' AND is_spillage = false
--    GROUP BY 1,2,3 ORDER BY COUNT(*) DESC;


-- ── STEP 2 — REPAIR ─────────────────────────────────────────────────────────
-- Empties the debag array of every batch Step 1 marked is_pure_copy, and leaves
-- everything else — the batch record itself, its variant, grade and output bags,
-- and any batch that captured rows of its own — exactly as it is.
BEGIN;

CREATE TEMP TABLE _repaired AS
  SELECT session_id,
         jsonb_agg(
           CASE WHEN (idx > 1 AND COALESCE(array_length(keys, 1), 0) > 0 AND keys = preceding_keys)
                THEN jsonb_set(batch, '{data,debag}', '[]'::jsonb)
                ELSE batch
           END ORDER BY idx) AS productions,
         bool_or(idx > 1 AND COALESCE(array_length(keys, 1), 0) > 0 AND keys = preceding_keys) AS changed
    FROM _batch_verdict
   GROUP BY session_id;

UPDATE production.prod_sessions s
   SET draft_data = jsonb_set(s.draft_data, '{productions}', r.productions),
       updated_at = NOW()
  FROM _repaired r
 WHERE s.id = r.session_id
   AND r.changed;                       -- idempotent: a clean session is skipped

-- Trim production.prod_debagging to match. Rows are NOT deleted wholesale and
-- then left to a save to rebuild — that would empty the order panels until the
-- operator next opens the screen. Instead, for each row identity, the earliest
-- rows are KEPT up to the count the repaired draft_data says should exist, and
-- only the surplus copies are removed. Oldest-first, so what survives is the
-- original capture, not a copy of it.
WITH target AS (
  SELECT r.session_id,
         concat_ws('|',
           btrim(COALESCE(d->>'bag_no', '')),
           btrim(COALESCE(d->>'lot', '')),
           round(COALESCE(NULLIF(replace(d->>'nett', ',', '.'), ''), '0')::numeric, 3)) AS k,
         COUNT(*) AS keep_n
    FROM _repaired r,
         LATERAL jsonb_array_elements(r.productions) p,
         LATERAL jsonb_array_elements(COALESCE(p->'data'->'debag', '[]'::jsonb)) d
   WHERE r.changed
   GROUP BY 1, 2
), ranked AS (
  SELECT dbg.id, dbg.session_id,
         concat_ws('|',
           btrim(COALESCE(dbg.notes, '')),
           btrim(COALESCE(dbg.lot_number, '')),
           round(COALESCE(dbg.kg_nett, 0)::numeric, 3)) AS k,
         ROW_NUMBER() OVER (
           PARTITION BY dbg.session_id,
                        btrim(COALESCE(dbg.notes, '')),
                        btrim(COALESCE(dbg.lot_number, '')),
                        round(COALESCE(dbg.kg_nett, 0)::numeric, 3)
           ORDER BY dbg.created_at, dbg.id) AS rn
    FROM production.prod_debagging dbg
    JOIN _repaired r ON r.session_id = dbg.session_id AND r.changed
   -- Farm bags only. Bucket-elevator and machine-spillage rows were never
   -- part of the duplication and are not touched.
   WHERE dbg.is_spillage = false
     AND dbg.product_type IN ('Farm Bag', '500kg Farm Bag')
)
DELETE FROM production.prod_debagging d
 USING ranked
 WHERE d.id = ranked.id
   AND ranked.rn > COALESCE(
         (SELECT t.keep_n FROM target t
           WHERE t.session_id = ranked.session_id AND t.k = ranked.k), 0);

-- Read the result before committing. debag_rows_now should match the sum of the
-- kept batches, and no output bag should have moved.
SELECT s.date, s.shift, s.id,
       jsonb_array_length(s.draft_data->'productions') AS batches_kept,
       (SELECT COUNT(*) FROM production.prod_debagging x
         WHERE x.session_id = s.id AND x.is_spillage = false)  AS debag_rows_now,
       (SELECT COUNT(*) FROM production.bag_tags t
         WHERE t.session_id = s.id AND t.status <> 'voided')   AS output_bags_untouched
  FROM production.prod_sessions s
  JOIN _repaired r ON r.session_id = s.id AND r.changed
 ORDER BY s.date, s.shift;

COMMIT;
-- ROLLBACK;  -- ← use this instead if the numbers above do not read right.


-- ── STEP 3 — WHAT TO EXPECT AFTERWARDS ──────────────────────────────────────
-- Sieving / 2026-09-01 / morning should come back to its 6 batch records with
-- ~10 farm-bag rows between them, not 258, and the Overview's mass balance
-- should read roughly 3 536 kg in against 2 430 kg out.
--
-- 2026-08-31 is the day that genuinely changed over (Export → Export Blend).
-- Both of its batches are real: expect is_pure_copy = false on any batch that
-- debagged its own bags, and only the copied ones to empty. If Step 1 shows a
-- batch you know captured real bags marked is_pure_copy, STOP and say so — that
-- means two batches genuinely debagged byte-identical bags, which the signature
-- cannot tell apart from a copy, and it needs a human decision.
