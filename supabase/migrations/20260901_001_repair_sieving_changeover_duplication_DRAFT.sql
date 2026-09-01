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
-- THE TRAP — READ BEFORE RUNNING ANYTHING
--   Every farm bag in these sessions carries the SAME identity: bag label E-744,
--   lot GS-0314, 350.0 kg. So a copied row is byte-identical to a real one, and
--   no query can tell them apart. On 31 Aug morning the offset is 5 — meaning if
--   batch 1 held five zero-weight rows, batch 2's 16 real bags would match the
--   copy signature exactly and a structural repair would delete a genuine
--   changeover's records.
--
--   So the signature is NOT trusted on its own. Step 2A only ever touches an
--   explicitly listed batch, and the list below is deliberately limited to the
--   batches where a copy is beyond doubt: exact doubling AND zero output bags.
--   For everything else use Step 2B, which trims to a count YOU confirm.
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
  SELECT s.id AS session_id, s.date, s.shift, p.idx, p.batch, r.value AS row,
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


-- ── STEP 2A — STRUCTURAL CLEAN, explicit batches only ───────────────────────
-- Use ONLY where distinct_identities > 1, i.e. the rows can actually be told
-- apart. Removes a listed batch's ledger-eligible rows and keeps its zero-weight
-- (still-being-typed) rows, its variant, grade and every output bag.
--
-- The list is empty on purpose. Add (session_id, batch_no) pairs you have
-- confirmed against Step 1 — nothing runs until you do.
BEGIN;

CREATE TEMP TABLE _clean (session_id uuid, batch_no int);
INSERT INTO _clean (session_id, batch_no) VALUES
  -- ('7b8774f2-5213-4c34-a687-10f86298df03', 4),
  -- ('7b8774f2-5213-4c34-a687-10f86298df03', 5),
  -- ('7b8774f2-5213-4c34-a687-10f86298df03', 6)
  (NULL, NULL);
DELETE FROM _clean WHERE session_id IS NULL;

CREATE TEMP TABLE _rebuilt AS
  SELECT b.session_id,
         jsonb_agg(
           CASE WHEN c.batch_no IS NULL THEN b.batch
                ELSE jsonb_set(b.batch, '{data,debag}', COALESCE((
                       SELECT jsonb_agg(r.row ORDER BY r.ord)
                         FROM _rows r
                        WHERE r.session_id = b.session_id AND r.idx = b.idx
                          AND NOT r.in_ledger          -- keep in-progress rows
                     ), '[]'::jsonb))
           END ORDER BY b.idx) AS productions,
         bool_or(c.batch_no IS NOT NULL) AS changed
    FROM _batch b
    LEFT JOIN _clean c ON c.session_id = b.session_id AND c.batch_no = b.idx
   GROUP BY b.session_id;

UPDATE production.prod_sessions s
   SET draft_data = jsonb_set(s.draft_data, '{productions}', r.productions),
       updated_at = NOW()
  FROM _rebuilt r
 WHERE s.id = r.session_id AND r.changed;

-- Trim prod_debagging to match: for each row identity, KEEP the earliest rows up
-- to the corrected count and delete only the surplus. Not a delete-and-rebuild —
-- that would empty the order panels until the operator next saved, and it is the
-- originals we want to survive, not the copies.
WITH target AS (
  SELECT r.session_id,
         concat_ws('|',
           btrim(COALESCE(d->>'bag_no', '')),
           btrim(COALESCE(d->>'lot', '')),
           round(COALESCE(NULLIF(replace(d->>'nett', ',', '.'), ''), '0')::numeric, 3)) AS k,
         COUNT(*) AS keep_n
    FROM _rebuilt r,
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
           PARTITION BY dbg.session_id, btrim(COALESCE(dbg.notes, '')),
                        btrim(COALESCE(dbg.lot_number, '')),
                        round(COALESCE(dbg.kg_nett, 0)::numeric, 3)
           ORDER BY dbg.created_at, dbg.id) AS rn
    FROM production.prod_debagging dbg
    JOIN _rebuilt r ON r.session_id = dbg.session_id AND r.changed
   -- Farm bags only. Bucket-elevator and machine-spillage rows were never part
   -- of the duplication and are not touched.
   WHERE dbg.is_spillage = false
     AND dbg.product_type IN ('Farm Bag', '500kg Farm Bag')
)
DELETE FROM production.prod_debagging d
 USING ranked
 WHERE d.id = ranked.id
   AND ranked.rn > COALESCE((SELECT t.keep_n FROM target t
                              WHERE t.session_id = ranked.session_id AND t.k = ranked.k), 0);

SELECT s.date, s.shift, s.id,
       jsonb_array_length(s.draft_data->'productions') AS batches_kept,
       (SELECT COUNT(*) FROM production.prod_debagging x
         WHERE x.session_id = s.id AND x.is_spillage = false) AS debag_rows_now,
       (SELECT COUNT(*) FROM production.bag_tags t
         WHERE t.session_id = s.id AND t.status <> 'voided')  AS output_bags_untouched
  FROM production.prod_sessions s JOIN _rebuilt r ON r.session_id = s.id AND r.changed;

COMMIT;
-- ROLLBACK;  -- ← if the numbers above do not read right.


-- ── STEP 2B — CONFIRMED-COUNT TRIM (use this for 2026-09-01) ────────────────
-- When distinct_identities = 1, every row is byte-identical and no structural
-- rule can separate a copy from a real bag. The only honest input is the real
-- number of farm bags debagged, off the paper form or the physical count.
--
-- This keeps the EARLIEST n rows for that identity and deletes the surplus, then
-- rewrites draft_data so the batch that captured them holds exactly those rows
-- and the later batches hold none. Batch records, variants, grades and output
-- bags are all untouched.
--
-- HOW TO PICK THE COUNT — do not guess it from the batch sizes.
--   2026-09-01 morning bagged 4 560 kg across 17 output bags. At ~350 kg a farm
--   bag, the input that implies:
--
--     13 bags = 4 550 kg in -> 100.2% yield   impossible
--     14 bags = 4 900 kg in ->  93.1% yield   implausible
--     15 bags = 5 250 kg in ->  86.9% yield
--     16 bags = 5 600 kg in ->  81.4% yield
--     17 bags = 5 950 kg in ->  76.6% yield
--     22 bags = 7 700 kg in ->  59.2% yield   (batches 1+2 together)
--
--   So batch 1's 13 rows are NOT the whole genuine input — sieving always loses
--   dust, spillage and elevator carry-over, and 100% yield cannot happen. Some
--   of batch 2's 9 rows are real bags debagged after the changeover into
--   RA-Conventional. Trimming to 13 would delete them.
--
--   Take the number off the paper debagging sheet or the physical bag count for
--   that shift. The yield column above is a sanity check on it, not a source
--   for it. Leave this unset and the script refuses to run.
BEGIN;

-- ← SET true_bag_count TO THE CONFIRMED PHYSICAL COUNT. NULL by design.
CREATE TEMP TABLE _trim AS
  SELECT '7b8774f2-5213-4c34-a687-10f86298df03'::uuid AS session_id,
         NULL::int                                    AS true_bag_count;

DO $$ BEGIN
  IF (SELECT true_bag_count FROM _trim) IS NULL THEN
    RAISE EXCEPTION 'Set true_bag_count to the confirmed physical bag count first — see the yield table above.';
  END IF;
END $$;

-- draft_data: the first batch keeps the confirmed rows (plus any in-progress
-- zero-weight rows), later batches keep their zero-weight rows only.
WITH keep AS (
  SELECT r.session_id, r.idx, r.ord,
         ROW_NUMBER() OVER (PARTITION BY r.session_id ORDER BY r.idx, r.ord) AS seq
    FROM _rows r JOIN _trim t ON t.session_id = r.session_id
   WHERE r.in_ledger
), rebuilt AS (
  SELECT b.session_id,
         jsonb_agg(COALESCE(
           jsonb_set(b.batch, '{data,debag}', COALESCE((
             SELECT jsonb_agg(r.row ORDER BY r.ord)
               FROM _rows r
               LEFT JOIN keep k ON k.session_id = r.session_id AND k.idx = r.idx AND k.ord = r.ord
              WHERE r.session_id = b.session_id AND r.idx = b.idx
                AND (NOT r.in_ledger OR k.seq <= (SELECT true_bag_count FROM _trim))
           ), '[]'::jsonb)), b.batch) ORDER BY b.idx) AS productions
    FROM _batch b JOIN _trim t ON t.session_id = b.session_id
   GROUP BY b.session_id
)
UPDATE production.prod_sessions s
   SET draft_data = jsonb_set(s.draft_data, '{productions}', rb.productions),
       updated_at = NOW()
  FROM rebuilt rb
 WHERE s.id = rb.session_id;

-- prod_debagging: keep the earliest true_bag_count farm-bag rows, drop the rest.
WITH ranked AS (
  SELECT dbg.id,
         ROW_NUMBER() OVER (ORDER BY dbg.created_at, dbg.id) AS rn
    FROM production.prod_debagging dbg JOIN _trim t ON t.session_id = dbg.session_id
   WHERE dbg.is_spillage = false
     AND dbg.product_type IN ('Farm Bag', '500kg Farm Bag')
)
DELETE FROM production.prod_debagging d
 USING ranked, _trim t
 WHERE d.id = ranked.id AND ranked.rn > t.true_bag_count;

SELECT s.date, s.shift,
       jsonb_array_length(s.draft_data->'productions') AS batches_kept,
       (SELECT COUNT(*) FROM production.prod_debagging x
         WHERE x.session_id = s.id AND x.is_spillage = false
           AND x.product_type IN ('Farm Bag', '500kg Farm Bag'))  AS farm_bag_rows_now,
       (SELECT COUNT(*) FROM production.bag_tags t2
         WHERE t2.session_id = s.id AND t2.status <> 'voided')    AS output_bags_untouched
  FROM production.prod_sessions s JOIN _trim t ON t.session_id = s.id;

COMMIT;
-- ROLLBACK;


-- ── STEP 3 — SWEEP ──────────────────────────────────────────────────────────
-- Any Sieving session since the self-heal shipped (#819, 2026-08-26) whose input
-- is implausible against its own output. 26-28 Aug and 31 Aug all show a single
-- batch (or, on 31 Aug, two batches from a real changeover) and are expected to
-- be clean — this is the standing check, not a claim that they are dirty.
SELECT s.date, s.shift, s.id, s.status,
       jsonb_array_length(COALESCE(s.draft_data->'productions', '[]'::jsonb)) AS batches,
       (SELECT COALESCE(SUM(COALESCE(NULLIF(replace(r->>'nett', ',', '.'), ''), '0')::numeric), 0)
          FROM jsonb_array_elements(COALESCE(s.draft_data->'productions', '[]'::jsonb)) p,
               jsonb_array_elements(COALESCE(p->'data'->'debag', '[]'::jsonb)) r)   AS in_kg,
       (SELECT COALESCE(SUM(COALESCE(NULLIF(replace(b->>'weight', ',', '.'), ''), '0')::numeric), 0)
          FROM jsonb_array_elements(COALESCE(s.draft_data->'productions', '[]'::jsonb)) p,
               jsonb_array_elements(COALESCE(p->'data'->'outputs', '[]'::jsonb)) b)  AS out_kg
  FROM production.prod_sessions s
 WHERE s.section_id = 'sieving' AND s.date >= DATE '2026-08-26'
 ORDER BY s.date DESC, s.shift;
