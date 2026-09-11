/**
 * What a shift actually captured on one section — every batch record, not one.
 *
 * ── The problem this solves ────────────────────────────────────────────────
 *
 * A line that switches grade or variant mid-shift opens a SECOND record. It has
 * to: appending a batch to the open session is what doubled Sieving's debagging
 * rows on 2026-09-01 (8 → 16 → 32 → … → 262 rows for 17 bags actually debagged),
 * because the debag self-heal is scoped to `session_id` with no batch
 * discriminator. So a changeover means a new `prod_sessions` row, and the
 * database already numbers them — `ST-040826-01`, `ST-040826-02`.
 *
 * The capture hub never showed them. It built one card per SECTION from
 * `shift_assignments` — the supervisor's roster row, which has one variant and
 * one lot no matter what the shift went on to do — and collapsed the sessions
 * with `statusMap[section_id] = status`, so with two records **the last row
 * read won, arbitrarily**. An operator saw one card, one variant, one status,
 * and then got a variant-mismatch error from a scan that was perfectly correct.
 * The error was right and unexplainable at the same time.
 *
 * ── Why this is core ───────────────────────────────────────────────────────
 *
 * "Which records does this shift have, in what order, and is the section
 * finished" is a rule, not a rendering. It is about to be asked by the hub, and
 * the section screen asks a version of it already. Answering it in a page would
 * be the same shape as the changeover rules that lived as four inline
 * expressions until they drifted (ARCHITECTURE.md §4, and lib/core/changeover.ts
 * on why they moved).
 *
 * Pure: no I/O, no React, no clock.
 */

/** One `production.prod_sessions` row, as much of it as this rule needs. */
export interface ShiftSessionRecord {
  id: string
  sectionId: string
  status: string | null
  /** `ST-040826-02` — assigned by the database, and the authored order. */
  recordNo: string | null
  variant: string | null
  lotNumber: string | null
  productionOrders: readonly string[] | null
  createdAt: string | null
  /** Soft-deleted records are not records. */
  deletedAt?: string | null
}

/** The supervisor's roster row for the section — one per section per shift. */
export interface ShiftAssignmentRef {
  sectionId: string
  variant: string | null
  lotNumber: string | null
  productionOrders: readonly string[] | null
}

/** One card. A shift with three records produces three of these. */
export interface ShiftRecordCard {
  /** Stable React key. The session id where there is one, else the section. */
  key: string
  sectionId: string
  /** null when the shift is rostered but nothing has been opened yet. */
  sessionId: string | null
  /** 'none' when nothing is open yet — the same vocabulary the screen uses. */
  status: string
  recordNo: string | null
  variant: string | null
  lotNumber: string | null
  productionOrders: readonly string[]
  /** 1-based position in the shift. */
  ordinal: number
  /** How many records this section has this shift. 1 when none is open yet. */
  total: number
}

/**
 * The trailing sequence of a record number — the `02` of `ST-040826-02`.
 *
 * Anchored at the END rather than split on `-`, for the same reason serials are
 * parsed that way: the middle can itself contain hyphens and a `split('-')`
 * silently mis-reads anything that does (ARCHITECTURE.md §5). Returns null when
 * there is no trailing number, so the caller falls back to the clock.
 */
export function recordSequence(recordNo: string | null | undefined): number | null {
  if (!recordNo) return null
  const m = /(\d+)\s*$/.exec(String(recordNo))
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/**
 * Oldest first — the order the shift opened them.
 *
 * `record_no` is the authority where both rows have one, because it is what the
 * database assigned and what is printed on the record. `created_at` is the
 * fallback, and an unparseable/absent timestamp sorts LAST rather than first —
 * a missing value must not jump ahead of real ones. Ties break on `id` so two
 * tablets reading the same shift cannot disagree about the order.
 */
function oldestFirst(a: ShiftSessionRecord, b: ShiftSessionRecord): number {
  const sa = recordSequence(a.recordNo)
  const sb = recordSequence(b.recordNo)
  if (sa !== null && sb !== null && sa !== sb) return sa - sb

  const ta = Date.parse(a.createdAt ?? '')
  const tb = Date.parse(b.createdAt ?? '')
  const va = Number.isFinite(ta)
  const vb = Number.isFinite(tb)
  if (va && vb && ta !== tb) return ta - tb
  if (va !== vb) return va ? -1 : 1

  return String(a.id).localeCompare(String(b.id))
}

/** Live records for one section, oldest first. */
export function sectionRecords(
  sessions: readonly ShiftSessionRecord[],
  sectionId: string,
): ShiftSessionRecord[] {
  return sessions
    .filter(s => !!s && s.sectionId === sectionId && !s.deletedAt && !!s.id)
    .sort(oldestFirst)
}

/**
 * The cards to render for one section.
 *
 * Never empty: a rostered section with nothing open yet still gets one card, so
 * the operator has something to tap. That card carries the ASSIGNMENT's variant
 * and lot, which is the right answer for a record that does not exist yet —
 * it is what the supervisor said the line would run.
 *
 * Once records exist, each one speaks for itself and falls back to the
 * assignment only where its own field is blank (a draft opened before the
 * operator picked a variant). Showing the roster's variant over a record that
 * has its own is how the Organic second blend read as Conventional.
 */
export function shiftRecordCards(
  sessions: readonly ShiftSessionRecord[],
  assignment: ShiftAssignmentRef,
): ShiftRecordCard[] {
  const rows = sectionRecords(sessions, assignment.sectionId)

  if (rows.length === 0) {
    return [{
      key: assignment.sectionId,
      sectionId: assignment.sectionId,
      sessionId: null,
      status: 'none',
      recordNo: null,
      variant: blankToNull(assignment.variant),
      lotNumber: blankToNull(assignment.lotNumber),
      productionOrders: assignment.productionOrders ?? [],
      ordinal: 1,
      total: 1,
    }]
  }

  return rows.map((r, i) => ({
    key: r.id,
    sectionId: assignment.sectionId,
    sessionId: r.id,
    status: blankToNull(r.status) ?? 'none',
    recordNo: blankToNull(r.recordNo),
    variant: blankToNull(r.variant) ?? blankToNull(assignment.variant),
    lotNumber: blankToNull(r.lotNumber) ?? blankToNull(assignment.lotNumber),
    productionOrders: (r.productionOrders?.length ? r.productionOrders : assignment.productionOrders) ?? [],
    ordinal: i + 1,
    total: rows.length,
  }))
}

/**
 * One status for the whole section, for the counters at the top of the screen.
 *
 * Replaces `statusMap[section_id] = status`, which took whichever row PostgREST
 * returned last and called it the section's state. A section with an approved
 * first record and a draft second one was showing "Signed off" half the time.
 *
 * Finished means EVERY record is finished. Anything else is the most urgent
 * thing outstanding — something awaiting sign-off outranks something still
 * being captured, because it is waiting on a person rather than on the line.
 */
export function sectionStatus(
  sessions: readonly ShiftSessionRecord[],
  sectionId: string,
): 'none' | 'draft' | 'submitted' | 'approved' {
  const rows = sectionRecords(sessions, sectionId)
  if (rows.length === 0) return 'none'
  if (rows.every(r => r.status === 'approved')) return 'approved'
  if (rows.some(r => r.status === 'submitted')) return 'submitted'
  if (rows.some(r => r.status === 'draft')) return 'draft'
  return 'none'
}

/** '' and whitespace are not values. */
function blankToNull(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}
