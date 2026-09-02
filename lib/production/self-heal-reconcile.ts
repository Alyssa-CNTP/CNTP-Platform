/**
 * Reconciling a capture screen's local rows against the structured ledger
 * (production.prod_debagging / production.bag_tags) WITHOUT duplicating them.
 *
 * Why this exists
 * ---------------
 * SievingCapture self-heals its `debag` and `outputs` arrays from the ledger on
 * mount, so a disrupted draft_data save can never lose a real bag. Both reads
 * are scoped `.eq('session_id', …)` — but a session can hold SEVERAL batches
 * (productions), the capture screen mounts ONE of them at a time
 * (`key={active.id}`), and persist() writes the mounted batch's array back to
 * the same session-scoped rows. So a session-scoped read patched into a
 * batch-scoped array copies every sibling batch's rows into the batch you
 * happen to be looking at, and the next save makes those copies permanent.
 *
 * On 2026-08-31 a grade changeover created a second batch mid-shift and every
 * page load doubled the debagging rows: 8 → 16 → 32 → 64 → 128 → 258 rows for
 * 41 physical bags, which the order page then read as 91 036 kg of input
 * against 4 704 kg bagged. On the output side the copied bags collided on
 * prod_bagging's (session_id, bag_serial_no) uniqueness, persist() nulled the
 * repeated serial to get the write through, and the copy survived as a
 * serial-less twin — the 20 `—` rows on the production order.
 *
 * The fix is to restore only what NO batch of this session is already holding.
 *
 * Multiplicity, not membership
 * ----------------------------
 * A `Set` of keys answers "does anyone hold a row like this?", which is the
 * wrong question: two ledger rows sharing a key (same bag label, lot and
 * weight) against one held row means one genuinely IS missing and must come
 * back. So the held keys are counted, and only the surplus is restored — a
 * ledger row is returned once for each occurrence beyond what is held.
 */

/**
 * A lot number as it IDENTIFIES a lot, rather than as it was typed.
 *
 * Live data holds the same lot written both ways in one session — `MAT-0375`
 * and `  MAT- 0375`, an operator's stray space. Compared literally those are
 * two different lots, so a bag copied either side of the correction would not
 * be recognised as a copy. All whitespace goes and the rest is upper-cased;
 * combined with the bag label, that cannot merge two genuinely different bags.
 */
export function normalizeLot(lot: string | null | undefined): string {
  return String(lot ?? '').replace(/\s+/g, '').toUpperCase()
}

/** Identity of a debagging row as the ledger and the screen both express it. */
export function debagRowKey(bagNo: string, lot: string, nett: number): string {
  return `${String(bagNo ?? '').trim()}|${normalizeLot(lot)}|${nett}`
}

/**
 * Ledger rows that no batch of this session is holding yet.
 *
 * @param ledgerRows rows read back from the ledger for this session
 * @param keyOf      identity of a ledger row
 * @param heldKeys   identities held across THIS batch and every sibling batch —
 *                   pass duplicates, they are counted
 */
export function surplusLedgerRows<T>(
  ledgerRows: T[],
  keyOf: (row: T) => string,
  heldKeys: Iterable<string>,
): T[] {
  const remaining = new Map<string, number>()
  for (const k of heldKeys) remaining.set(k, (remaining.get(k) ?? 0) + 1)
  const missing: T[] = []
  for (const row of ledgerRows) {
    const k = keyOf(row)
    const held = remaining.get(k) ?? 0
    if (held > 0) { remaining.set(k, held - 1); continue }
    missing.push(row)
  }
  return missing
}
