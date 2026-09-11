/**
 * Which records belong to the same production order.
 *
 * ── The defect this fixes ──────────────────────────────────────────────────
 *
 * The Production Orders LIST shows one row per record. Clicking one opened a
 * document scoped to `(section_id, date)` — the whole production day — so a
 * shift that changed over produced one document covering every record on that
 * line that day, under a single header.
 *
 * On 11 September 2026 the Sieving tower ran Organic · Export in the morning,
 * changed over to Conventional · Export Blend, and continued into the
 * afternoon. Three records. The document merged all three and showed the
 * production order `S10LGBL-C` across the lot — a CONVENTIONAL code, printed
 * over the organic run. Two of the three records carried no order at all.
 *
 * ── Nothing new is being invented here ─────────────────────────────────────
 *
 * `production.production_runs` already exists and already says what a run is:
 * "one production order (PO + variant + grade) that can span several shifts of
 * the same production day". `prod_sessions.run_id` points at it, the capture
 * screen already fills it in, and it is populated on 319 of 350 production
 * sessions. Those three records on 11 September already had three distinct
 * runs, each with the right variant, grade and totals.
 *
 * The identity was right the whole time. The document simply ignored it. So
 * this is a scoping rule, not a data model — and it is core because "which
 * records are one order" is a question the list, the document and the print
 * view all have to answer the same way.
 *
 * Pure: no I/O, no React, no clock.
 */

export interface OrderScopeSession {
  id: string
  /** `prod_sessions.run_id` — null on rows written before runs existed. */
  runId: string | null
  sectionId: string
  /** The PRODUCTION day (07h00→01h00), as stored on the session. */
  date: string
  variant: string | null
  deletedAt?: string | null
}

/** '' and whitespace are not values. */
function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase()
}

/**
 * The records that make up the same order as `clickedId`.
 *
 * Two cases, and the second is the careful one:
 *
 *   1. The record HAS a run. Every record sharing that run belongs with it —
 *      which is how a morning and an afternoon on one order stay in one
 *      document, exactly as they should.
 *
 *   2. The record has NO run (31 of 350 on production; rows written before
 *      `production_runs` existed). It groups with other run-less records on the
 *      same line, day and variant.
 *
 *      A run-less record must NEVER be swept into a real run. Its variant might
 *      match by coincidence, and the result would be a document claiming a
 *      record belongs to an order nothing ever filed it under. Falling back to
 *      the old whole-day behaviour for these rows would reintroduce the exact
 *      merge this rule exists to stop, so the fallback is narrowed by variant
 *      instead — the one thing that distinguishes a changeover.
 *
 * Returns `[]` when the id is not in the list, so a caller cannot mistake "not
 * found" for "a document with everything in it".
 */
export function sessionsInSameOrder<T extends OrderScopeSession>(
  sessions: readonly T[],
  clickedId: string,
): T[] {
  const live = sessions.filter(s => !!s && !!s.id && !s.deletedAt)
  const clicked = live.find(s => s.id === clickedId)
  if (!clicked) return []

  if (clicked.runId) {
    return live.filter(s => s.runId === clicked.runId)
  }

  return live.filter(s =>
    !s.runId &&
    s.sectionId === clicked.sectionId &&
    s.date === clicked.date &&
    norm(s.variant) === norm(clicked.variant),
  )
}

/**
 * A stable key for the order a record belongs to.
 *
 * For grouping a list into documents without re-walking it per record. The run
 * id where there is one; otherwise a composite that cannot collide with a uuid.
 */
export function orderScopeKey(s: OrderScopeSession): string {
  return s.runId
    ? `run:${s.runId}`
    : `legacy:${s.sectionId}|${s.date}|${norm(s.variant)}`
}

/**
 * How many separate orders a set of records represents.
 *
 * The number a reader is owed on a day that changed over: "3 records, 3 orders"
 * is a different day from "3 records, 1 order", and the old document could not
 * tell them apart.
 */
export function countOrders(sessions: readonly OrderScopeSession[]): number {
  const live = sessions.filter(s => !!s && !!s.id && !s.deletedAt)
  return new Set(live.map(orderScopeKey)).size
}
