-- 20260901_001_repair_sieving_changeover_duplication — DRAFT, NOT YET RUN
-- ---------------------------------------------------------------------------
-- De-duplicates the Sieving debagging rows that a mid-shift changeover copied.
-- DATA repair only, no schema change. The code defect is fixed separately in
-- components/production/capture/SievingCapture.tsx.
--
-- THE GOVERNING RULE: NOTHING IS LOST.
--   Every batch record is kept, with its variant, grade and output bags. A
--   changeover is a real event — 31 Aug morning genuinely ran grade A (Export)
--   and then changed over to grade B (Export Blend), and BOTH of its batches are
--   real. Only copied debagging rows come out, and only where the evidence is
--   unambiguous. Where it is not, this script reports and stops.
--
-- WHAT HAPPENED
--   SievingCapture's debag self-heal reads production.prod_debagging scoped to
--   session_id, and that table has no batch discriminator, so after a changeover
--   every batch's rows sit under one session id. The component is mounted with
--   key={active.id}, so a changeover remounts it against a brand-new EMPTY
--   batch; the self-heal read the whole session as "missing from this batch" and
--   restored a copy of all of it into the new batch. persist() wrote that back,
--   so each changeover doubled the rows.
--
--   Measured on production, sieving / 2026-09-01 / morning (session
--   7b8774f2-5213-4c34-a687-10f86298df03):
--
--     batch:      1    2    3    4    5     6
--     rows:      13    9   16   32   64   128     = 262
--     rows before: 0   13   22   38   70   134
--     difference:  –    4    6    6    6     6
--
--   Batches 3-6 double exactly. The constant 6 is not noise: buildDebag() skips
--   any debag row with n(nett) === 0, so blank / still-being-typed rows never
--   reach prod_debagging and were therefore never available to be copied. Six
--   such rows sit in batches 1-2, so the ledger held 22 − 6 = 16 at the second
--   changeover — exactly what batch 3 received.
--
--   THIS IS WHY THE FIRST VERSION OF THIS SCRIPT FOUND NOTHING. It compared each
--   batch against every preceding row, including those six. The comparison below
--   is against LEDGER-ELIGIBLE rows only (nett > 0), which is what a copy could
--   actually have contained.
--
--   Only INPUTS multiplied. The two self-heal effects each built their patch from
--   the same mount-time `value` closure, so the debag restore clobbered the
--   output restore whenever its query resolved last. bag_tags was never touched
--   and remains the record of what was bagged; this script does not write to it,
--   to prod_bagging, or to scan_events.
--
-- WHAT MAKES THIS EXACT — bag identity, not counting
--   An earlier draft of this script assumed the rows could not be told apart,
--   because the production-order page showed 258 rows all reading E-744 /
--   GS-0314 / 350.0 kg. That was the duplicate view, not the capture. The
--   capture screen shows distinct bags — Bulk bag 1 is E-744 / GS-0314, bulk bag
--   2 is I-705 / GS-0382 — and the paper sheet for 31-08-2026 carries 41 bags
--   with 41 distinct (lot, bag label) pairs.
--
--   A farm bag is a physical object and is debagged ONCE, so (lot, bag label) is
--   a unique identity and a repeated pair IS a copy. No count to guess, no
--   tolerance to pick, and nothing that can delete a real record: the rule keeps
--   one row per real bag.
--
--   Verified against the floor's own numbers:
--     2026-08-31 morning    37 rows captured -> 21 real  (13 Export + 8 Blend)
--     2026-08-31 afternoon  20 rows captured -> 20 real  (already clean)
--     2026-09-01 morning   262 rows captured -> 15 real  (operator: 15 in, 12 out)
--
--   Note the copying runs BOTH ways. A changeover copies the session into the new
--   empty batch, and a page RELOAD resets activeIdx to 0 and copies the other
--   batches into batch 1 — which is how 31 Aug morning's batch 1 came to hold 21
--   rows when only 13 Export bags were debagged under it. The code fix covers
--   both: the exclusion is symmetric, every batch now knows what its siblings
--   hold.
--
-- DOES DEPLOYING THE CODE FIX LOSE THE CORRECT ROWS? NO.
--   The fix is append-only. SievingCapture's self-heal has no delete path at all
--   — its only write is `[...cur.debag, ...restored]`, and missingDebagRows()
--   returns rows to ADD. What changed is that it now knows what the session's
--   other batches hold, so it stops COPYING. It removes nothing.
--
--   So the 15 debagged bags and 12 bagged bags showing correctly on the capture
--   screen right now are untouched by the deploy. The deploy stops the count
--   growing; THIS script is what brings the already-duplicated rows back down,
--   and it is a separate, optional step you run when you choose.
--
--   The UI changes in the same commits are display-only. Nothing that was
--   removed from a screen writes to, or deletes from, any table.
--
-- RUN ALL STEPS IN ONE SQL SESSION
--   Steps 1, 1b and 2 share TEMP views (_repair_scope, _rows, _batch). Open the
--   SQL editor once and run them in order in the same tab; a new connection
--   drops the temp objects and Step 2 will fail with "relation does not exist".
--
-- ORDER OF OPERATIONS
--   1. Deploy the SievingCapture fix FIRST. Until it is live, every changeover
--      re-creates the duplication — 2026-09-01 grew from 258 rows to 262 while
--      this was being diagnosed.
--   2. The session must be CLOSED on the tablet, or reloaded straight after. A
--      tab left open holds the duplicated rows in React state and its 2.5s
--      autosave writes them back.
--   3. localStorage needs no clearing: [section]/page.tsx prefers the local draft
--      only when the DB row has no capture data, which is not the case here.
-- ---------------------------------------------------------------------------


-- ── STEP 1 — INSPECT (read-only). Re-run this; the verdict has changed. ─────
CREATE TEMP VIEW _repair_scope AS
  SELECT id, date, shift, status, draft_data
    FROM production.prod_sessions
   WHERE section_id = 'sieving'
     AND date BETWEEN DATE '2026-08-26' AND DATE '2026-09-01'   -- ← window to inspect
     AND status <> 'approved';                                  -- never rewrite a signed-off record

-- A debagging row's identity, matching lib/production/debag-reconcile.ts:
-- (operator's bag label, lot, net weight). Split by whether the row could ever
-- have reached prod_debagging, because only those could have been copied.
CREATE TEMP VIEW _rows AS
  SELECT s.id AS session_id, s.date, s.shift, p.idx, p.batch, r.value AS bag_row,
         concat_ws('|',
           btrim(COALESCE(r.value->>'bag_no', '')),
           btrim(COALESCE(r.value->>'lot', '')),
           round(COALESCE(NULLIF(replace(r.value->>'nett', ',', '.'), ''), '0')::numeric, 3)) AS k,
         COALESCE(NULLIF(replace(r.value->>'nett', ',', '.'), ''), '0')::numeric > 0 AS in_ledger
    FROM _repair_scope s,
         LATERAL jsonb_array_elements(COALESCE(s.draft_data->'productions', '[]'::jsonb))
                 WITH ORDINALITY AS p(batch, idx),
         LATERAL jsonb_array_elements(COALESCE(p.batch->'data'->'debag', '[]'::jsonb))
                 WITH ORDINALITY AS r(value, ord);

CREATE TEMP VIEW _batch AS
  SELECT session_id, date, shift, idx, MIN(batch::text)::jsonb AS batch,
         COUNT(*)                                                     AS debag_rows,
         COUNT(*) FILTER (WHERE in_ledger)                            AS ledger_rows,
         COALESCE(array_agg(k ORDER BY k) FILTER (WHERE in_ledger), '{}'::text[]) AS keys
    FROM _rows
   GROUP BY session_id, date, shift, idx;

SELECT b.session_id, b.date, b.shift, b.idx AS batch_no,
       b.batch->>'variant' AS variant,
       b.batch->>'grade'   AS grade,
       b.debag_rows,
       b.ledger_rows,
       COALESCE(array_length(pre.keys, 1), 0) AS ledger_rows_before_it,
       jsonb_array_length(COALESCE(b.batch->'data'->'outputs', '[]'::jsonb)) AS output_bags,
       -- Copy signature, now measured against ledger-eligible rows only.
       (b.idx > 1 AND b.ledger_rows > 0 AND b.keys = pre.keys) AS copy_signature,
       -- How many DISTINCT bag identities the session holds. 1 means every row
       -- is byte-identical, so the signature above proves nothing on its own and
       -- Step 2B (confirmed count) is the only safe repair.
       (SELECT COUNT(DISTINCT k) FROM _rows r2
         WHERE r2.session_id = b.session_id AND r2.in_ledger) AS distinct_identities
  FROM _batch b
  LEFT JOIN LATERAL (
    SELECT COALESCE(array_agg(k ORDER BY k), '{}'::text[]) AS keys
      FROM _rows r3
     WHERE r3.session_id = b.session_id AND r3.idx < b.idx AND r3.in_ledger
  ) pre ON TRUE
 ORDER BY b.date, b.shift, b.session_id, b.idx;

-- Expected for 2026-09-01 morning: copy_signature = true on batches 3,4,5,6
-- (and possibly 2), distinct_identities = 1. That 1 is the reason for Step 2B.


-- ── STEP 1b — THE COUNT THAT MATTERS ────────────────────────────────────────
-- A farm bag is a physical object: it is debagged ONCE. So (lot, bag label) is a
-- unique identity, and a pair that appears more than once in a session is a copy
-- by definition. This is what makes the repair exact rather than a judgement —
-- confirmed against the paper sheet for 31-08-2026, where all 41 bags across the
-- day carry 41 distinct (lot, bag) pairs.
--
-- distinct_bags is the number to check against the paper sheet / the operator.
SELECT s.date, s.shift, s.id AS session_id,
       COUNT(*)                                      AS rows_captured,
       COUNT(DISTINCT (r.lot, r.bag_no))              AS distinct_bags,
       COUNT(*) - COUNT(DISTINCT (r.lot, r.bag_no))   AS copies_to_remove
  FROM _repair_scope s,
       LATERAL jsonb_array_elements(COALESCE(s.draft_data->'productions', '[]'::jsonb)) p,
       LATERAL jsonb_array_elements(COALESCE(p->'data'->'debag', '[]'::jsonb)) d,
       LATERAL (SELECT btrim(COALESCE(d->>'lot', ''))    AS lot,
                       btrim(COALESCE(d->>'bag_no', '')) AS bag_no) r
 WHERE COALESCE(NULLIF(replace(d->>'nett', ',', '.'), ''), '0')::numeric > 0
 GROUP BY s.date, s.shift, s.id
 ORDER BY s.date, s.shift;

-- Known-good expectations at time of writing:
--   2026-08-31 morning    37 rows -> 21 distinct  (13 Export + 8 Export Blend)
--   2026-08-31 afternoon  20 rows -> 20 distinct  (already clean, nothing to do)
--   2026-09-01 morning   262 rows -> 15 distinct  (operator confirmed 15 in, 12 out)
--
-- If distinct_bags does NOT match the paper sheet, STOP. That would mean bags
-- were captured with a duplicated or blank label, which this rule cannot repair
-- and which needs the operator, not a query.


-- ── STEP 2 — DE-DUPLICATE ON BAG IDENTITY ───────────────────────────────────
-- Keeps exactly one row per (lot, bag label) per session and drops the copies.
-- Nothing else changes: every batch record, variant, grade and output bag stays.
--
-- Which copy survives, in order of preference:
--   1. the one sitting in the batch whose grade matches the ROW's own grade —
--      a bag debagged under Export Blend belongs to the Export Blend batch, and
--      that is how 31 Aug's 8 blend bags get back to batch 2 rather than being
--      stranded in batch 1 where a page reload copied them;
--   2. failing that, the earliest by logged_at, then by position.
--
-- Rows with nett = 0 are left completely alone — they are bags still being typed,
-- they never reached prod_debagging, and they were never copied.
BEGIN;

CREATE TEMP TABLE _keep AS
  SELECT session_id, idx, ord, in_ledger,
         ROW_NUMBER() OVER (
           PARTITION BY session_id,
                        btrim(COALESCE(bag_row->>'lot', '')),
                        btrim(COALESCE(bag_row->>'bag_no', ''))
           ORDER BY (btrim(COALESCE(bag_row->>'grade', '')) IS NOT DISTINCT FROM
                     btrim(COALESCE(batch->>'grade', ''))) DESC,
                    NULLIF(bag_row->>'logged_at', '') NULLS LAST,
                    idx, ord
         ) AS rn
    FROM _rows
   WHERE in_ledger;

-- Rebuild draft_data: each batch keeps its winning rows plus every nett = 0 row.
WITH rebuilt AS (
  SELECT b.session_id,
         jsonb_agg(
           jsonb_set(b.batch, '{data,debag}', COALESCE((
             SELECT jsonb_agg(r.bag_row ORDER BY r.ord)
               FROM _rows r
               LEFT JOIN _keep k
                      ON k.session_id = r.session_id AND k.idx = r.idx AND k.ord = r.ord
              WHERE r.session_id = b.session_id AND r.idx = b.idx
                AND (NOT r.in_ledger OR k.rn = 1)
           ), '[]'::jsonb)) ORDER BY b.idx) AS productions
    FROM _batch b
   GROUP BY b.session_id
)
UPDATE production.prod_sessions s
   SET draft_data = jsonb_set(s.draft_data, '{productions}', rb.productions),
       updated_at = NOW()
  FROM rebuilt rb
 WHERE s.id = rb.session_id
   -- Idempotent, and a session that was already clean (31 Aug afternoon) is
   -- skipped rather than rewritten for no reason.
   AND s.draft_data->'productions' IS DISTINCT FROM rb.productions;

-- Trim prod_debagging the same way: one row per (lot, bag label), oldest kept.
-- Farm bags only — bucket-elevator and machine-spillage rows were never part of
-- the duplication. Deleting the surplus rather than clearing and rebuilding, so
-- the original rows survive and the order panels stay populated meanwhile.
WITH ranked AS (
  SELECT dbg.id,
         ROW_NUMBER() OVER (
           PARTITION BY dbg.session_id,
                        btrim(COALESCE(dbg.lot_number, '')),
                        btrim(COALESCE(dbg.notes, ''))
           ORDER BY dbg.bagging_time NULLS LAST, dbg.created_at, dbg.id
         ) AS rn
    FROM production.prod_debagging dbg
    JOIN _repair_scope s ON s.id = dbg.session_id
   WHERE dbg.is_spillage = false
     AND dbg.product_type IN ('Farm Bag', '500kg Farm Bag')
)
DELETE FROM production.prod_debagging d
 USING ranked
 WHERE d.id = ranked.id AND ranked.rn > 1;

-- Verify BEFORE committing. farm_bag_rows_now must equal the paper count
-- (21 / 20 / 15), and output_bags must be unchanged from Step 1.
SELECT s.date, s.shift,
       jsonb_array_length(s.draft_data->'productions') AS batches_kept,
       (SELECT COUNT(*) FROM production.prod_debagging x
         WHERE x.session_id = s.id AND x.is_spillage = false
           AND x.product_type IN ('Farm Bag', '500kg Farm Bag'))  AS farm_bag_rows_now,
       (SELECT COUNT(*) FROM production.bag_tags t
         WHERE t.session_id = s.id AND t.status <> 'voided')       AS output_bags,
       (SELECT COALESCE(SUM(x.kg_nett), 0) FROM production.prod_debagging x
         WHERE x.session_id = s.id AND x.is_spillage = false)      AS input_kg_now
  FROM production.prod_sessions s
  JOIN _repair_scope sc ON sc.id = s.id
 ORDER BY s.date, s.shift;

COMMIT;
-- ROLLBACK;  -- ← if farm_bag_rows_now does not match the paper sheet.


-- ── STEP 3 — SWEEP ──────────────────────────────────────────────────────────
-- Standing check for any Sieving session since the self-heal shipped (#819,
-- 2026-08-26) still holding a repeated bag identity.
SELECT s.date, s.shift, s.id, s.status,
       COUNT(*) AS rows_captured,
       COUNT(DISTINCT (btrim(COALESCE(d->>'lot', '')), btrim(COALESCE(d->>'bag_no', '')))) AS distinct_bags
  FROM production.prod_sessions s,
       LATERAL jsonb_array_elements(COALESCE(s.draft_data->'productions', '[]'::jsonb)) p,
       LATERAL jsonb_array_elements(COALESCE(p->'data'->'debag', '[]'::jsonb)) d
 WHERE s.section_id = 'sieving' AND s.date >= DATE '2026-08-26'
   AND COALESCE(NULLIF(replace(d->>'nett', ',', '.'), ''), '0')::numeric > 0
 GROUP BY s.date, s.shift, s.id, s.status
HAVING COUNT(*) > COUNT(DISTINCT (btrim(COALESCE(d->>'lot', '')), btrim(COALESCE(d->>'bag_no', ''))))
 ORDER BY s.date DESC, s.shift;
