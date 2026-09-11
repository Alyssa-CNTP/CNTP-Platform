/**
 * Which session an operator's timesheet and stoppage ledger belong to.
 *
 * A timesheet is a property of the OPERATOR'S SHIFT. `prod_timesheets` and
 * `timesheet_stoppages` are both keyed on `session_id`, and one shift can
 * produce several sessions — the capture page opens a new `prod_sessions` row
 * whenever the most recent one for that (section, date, shift) is no longer a
 * draft. That is how a second blend of the day gets its own record, with its
 * own lot, its own mass balance and its own production order, which is
 * deliberate and correct for the CAPTURE record.
 *
 * It is wrong for the timesheet. Left alone, an operator who runs two blends
 * in one shift ends up with TWO timesheet rows, neither spanning the shift:
 * the second starts when they opened the second blend. Their stoppages split
 * the same way, so a breakdown logged during blend 1 is invisible from
 * blend 2 — and invisible to the other operator on the line, who is looking
 * at whichever session they happen to have open.
 *
 * The fix is not to re-key the table. It is to pick ONE session per shift and
 * write every operator's timesheet and stoppages against that one: the
 * ANCHOR. Because a new session is always created later than the ones before
 * it, the earliest session for a (section, date, shift) never changes — so
 * the anchor is stable for the whole shift, `UNIQUE (session_id,
 * operator_name)` still yields exactly one row per operator, and the foreign
 * key still points at a real session. No migration, no dual-write, no
 * backfill.
 *
 * This module is pure on purpose: the choice of anchor is a rule, and a rule
 * that lives in a component is a rule that gets re-implemented slightly
 * differently somewhere else (ARCHITECTURE.md §2).
 */

/** A session in the running for anchor. `createdAt` is an ISO timestamp. */
export interface ShiftSessionRef {
  id: string
  createdAt: string | null
}

/**
 * Order sessions oldest-first, deterministically.
 *
 * A row whose `createdAt` is missing or unparseable sorts LAST, never first.
 * It must not be able to win the anchor by accident — an unreadable timestamp
 * is not evidence of being earliest, and letting it anchor would move the
 * whole shift's ledger onto an arbitrary session.
 *
 * Ties break on `id` so two rows written in the same millisecond always
 * resolve the same way. Without that, two tablets loading at once could pick
 * different anchors from the same data and split the ledger they were
 * supposed to be sharing.
 */
function oldestFirst(a: ShiftSessionRef, b: ShiftSessionRef): number {
  const ta = a.createdAt ? Date.parse(a.createdAt) : NaN
  const tb = b.createdAt ? Date.parse(b.createdAt) : NaN
  const va = Number.isFinite(ta)
  const vb = Number.isFinite(tb)
  if (va && vb && ta !== tb) return ta - tb
  if (va !== vb) return va ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * The session this shift's timesheet and stoppages are written against.
 *
 * `currentSessionId` is the session the operator actually has open, and it is
 * the answer when there is nothing to choose from — an empty list means the
 * lookup failed or raced a just-created session, and degrading to today's
 * per-session behaviour is right. It is a fallback, never an override: a
 * caller that passes a stale or partial list still gets a real anchor rather
 * than silently starting a second ledger.
 */
export function anchorSessionId(
  sessions: readonly ShiftSessionRef[],
  currentSessionId: string,
): string {
  const usable = sessions.filter(s => !!s && !!s.id)
  if (usable.length === 0) return currentSessionId
  return [...usable].sort(oldestFirst)[0].id
}

/**
 * Every session id whose rows belong to this shift, oldest first.
 *
 * Used for reads that were written per-session before the anchor existed and
 * cannot be moved — `production.capture_activity` heartbeats carry the
 * session that was open when they were written, and rewriting history to
 * point at the anchor would falsify an audit row. So the SHIFT START is
 * derived by reading every session's heartbeats, while new timesheet and
 * stoppage rows are written to the anchor alone.
 *
 * `currentSessionId` is always included even when the list does not mention
 * it, which is what makes a session created since the lookup still count
 * towards the operator's shift instead of being dropped.
 */
export function shiftSessionIds(
  sessions: readonly ShiftSessionRef[],
  currentSessionId: string,
): string[] {
  const ordered = [...sessions.filter(s => !!s && !!s.id)].sort(oldestFirst).map(s => s.id)
  return ordered.includes(currentSessionId) ? ordered : [...ordered, currentSessionId]
}
