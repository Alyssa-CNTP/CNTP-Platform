// Reconciling a capture batch's debagging rows against production.prod_debagging.
//
// Why this is its own module rather than an inline helper in SievingCapture:
// getting it wrong multiplied one Sieving session's inputs from 8 farm bags to
// 258 (90 300 kg against 4 260 kg out). The arithmetic is small and entirely
// pure, so it belongs somewhere it can be tested — see debag-reconcile.test.ts.
//
// Two facts drive the whole design:
//
//   1. prod_debagging rows carry NO batch discriminator, only session_id. A
//      session that has been through a mid-shift changeover has every batch's
//      rows under one id, so "what this batch is missing" can only be answered
//      by also being told what the session's OTHER batches already hold.
//   2. Debag rows have no stable identity. Farm bags aren't in bag_tags, so
//      there is no serial, and no row id round-trips to the table. Identity is
//      the three fields buildDebag() writes — and ten bags off one pallet are
//      byte-identical under it.
//
// (2) is why this reconciles on MULTIPLICITY rather than set membership. A Set
// of keys says "the ledger's ten identical rows are all known" the moment the
// batch holds one of them, which silently recovers nothing — the exact data loss
// the self-heal exists to prevent. Counting says "the ledger has ten, we hold
// three, seven are missing", which is the real answer in both directions.

import { n } from '@/lib/core/num'

// The identity of a debagging row: the operator's own bag-number label (stored
// in prod_debagging.notes), the lot, and the net weight.
//
// ONE definition, imported by both the capture component and the capture page.
// The page computes these keys for the session's other batches, and two copies
// of this expression drifting apart is precisely how a row gets read as missing
// and duplicated into the wrong batch.
//
// Weights go through n() on both sides so a stored numeric 350 and a typed
// '350,0' collapse to the same key instead of reading as two different bags.
export const debagRowKey = (
  bagNo: string | null | undefined,
  lot: string | null | undefined,
  nett: unknown,
): string => `${String(bagNo ?? '').trim()}|${String(lot ?? '').trim()}|${n(nett as never)}`

/**
 * The ledger rows a batch is genuinely missing.
 *
 * @param ledgerRows rows read back from prod_debagging for the whole session
 * @param keyOf      identity of a ledger row — normally via `debagRowKey`
 * @param heldKeys   keys already accounted for: this batch's own rows PLUS every
 *                   row held by the session's other batches. A row sitting in
 *                   another batch of draft_data is not lost, and restoring it
 *                   here is what duplicates it.
 *
 * Returns ledger rows in their original order, each appearing only as many times
 * as the ledger holds it beyond what `heldKeys` accounts for. Never removes and
 * never reorders — callers merge the result into their own rows and sort by time.
 */
export function missingDebagRows<T>(
  ledgerRows: readonly T[],
  keyOf: (row: T) => string,
  heldKeys: readonly string[],
): T[] {
  const held = new Map<string, number>()
  for (const k of heldKeys) held.set(k, (held.get(k) ?? 0) + 1)

  const missing: T[] = []
  for (const row of ledgerRows) {
    const k = keyOf(row)
    const c = held.get(k) ?? 0
    if (c > 0) { held.set(k, c - 1); continue }  // accounted for already
    missing.push(row)                            // genuinely missing
  }
  return missing
}
