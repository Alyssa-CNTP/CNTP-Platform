/**
 * A handover note reaches the NEXT shift, and then it is finished.
 *
 * ── What it is for ─────────────────────────────────────────────────────────
 *
 * The note an operator leaves at the end of their shift is addressed to the
 * people who walk onto that line next: the tower is half full, the second
 * blend is organic, the elevator was left loaded. It is a message between two
 * shifts, not a log entry — and the difference matters, because the message
 * stops being true almost immediately. A changeover note read three shifts
 * later describes a line that has since changed over twice.
 *
 * So it expires. One shift, then gone. Asked for in exactly those words
 * (2026-09-11): "the handover to communicate to the next shifts operators and
 * expires thereafter."
 *
 * This replaces a seven-CALENDAR-DAY window, which surfaced the most recent
 * note on the line from up to a week ago. That window existed to hide seeded
 * demo notes rather than to express a rule, and a week of shifts is fourteen
 * handovers — so the banner was usually showing a stranger's message about a
 * run that finished days earlier.
 *
 * ── Two shifts, three names ────────────────────────────────────────────────
 *
 * Morning is 07h00–16h00. The other shift is 16h00–01h00 and is stored as
 * `afternoon`, with `night` kept as a legacy alias on old rows — read paths
 * must accept both (lib/production/shifts.ts). `sameShift()` below is the only
 * place that comparison happens here, so a third spelling would be added once.
 *
 * Pure: no I/O, no React, no clock. Days arrive as arguments, so this cannot
 * disagree with `productionDayFor()` about which run a note belongs to (§9).
 */

/** The shift values that appear in the database. */
export type HandoverShift = 'morning' | 'afternoon' | 'night' | string

export interface ShiftRef {
  /** PRODUCTION day (07h00→01h00), not the calendar date. */
  day: string
  shift: HandoverShift
}

/** Is this the 16h00–01h00 shift, under either of its two stored names? */
export function isAfternoonShift(shift: HandoverShift): boolean {
  const s = String(shift ?? '').toLowerCase()
  return s === 'afternoon' || s === 'night'
}

/**
 * The same shift, whatever it is called.
 *
 * `afternoon` and `night` are one shift with two spellings, and treating them
 * as different is how a note gets shown back to the people who wrote it.
 */
export function sameShift(a: HandoverShift, b: HandoverShift): boolean {
  if (isAfternoonShift(a)) return isAfternoonShift(b)
  return String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
}

/**
 * The day after, as an ISO date.
 *
 * Deliberately plain string arithmetic through UTC midnight: a bare `yyyy-mm-dd`
 * has no instant, so there is no timezone to get wrong and no clock to read.
 * Returns the input unchanged if it is not a date, so a malformed row cannot
 * silently move a note onto a different day.
 */
export function nextDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`)
  if (!Number.isFinite(t)) return day
  return new Date(t + 86_400_000).toISOString().slice(0, 10)
}

/**
 * The shift that follows this one.
 *
 *   morning   D  →  afternoon  D
 *   afternoon D  →  morning    D+1
 *
 * The afternoon shift runs past midnight and still belongs to day D, which is
 * why the next morning is D+1 and not "tomorrow relative to the clock".
 */
export function nextShiftAfter(ref: ShiftRef): ShiftRef {
  return isAfternoonShift(ref.shift)
    ? { day: nextDay(ref.day), shift: 'morning' }
    : { day: ref.day, shift: 'afternoon' }
}

/**
 * Does a note left on `note` still speak to someone standing on `reader`?
 *
 * True for exactly one shift — the one immediately after. Never for the shift
 * that wrote it, and never for anything later. That is the whole rule, and it
 * is deliberately not "recent": recency is a window, and a window cannot tell
 * the difference between the next shift and the one after it when a line skips
 * a shift.
 *
 * A consequence worth stating rather than hiding: if the next shift does not
 * run, nobody reads the note. That is correct — a message to whoever is on the
 * line next is not a message to whoever is on it on Thursday.
 */
export function handoverReaches(note: ShiftRef, reader: ShiftRef): boolean {
  if (!note?.day || !reader?.day) return false
  const next = nextShiftAfter(note)
  return next.day === reader.day && sameShift(next.shift, reader.shift)
}

/**
 * The one note to show, out of whatever the caller loaded.
 *
 * Takes a list because the read is "recent notes on this line" and the rule
 * decides which of them still applies — the caller should not be filtering by
 * date itself, which is how the seven-day window ended up in a page.
 *
 * Notes are checked newest first and the first that reaches the reader wins,
 * so a line that somehow left two notes on one shift shows the later one.
 */
export function handoverForShift<T extends ShiftRef & { note?: string | null }>(
  notes: readonly T[],
  reader: ShiftRef,
): T | null {
  const usable = notes.filter(n => !!n && !!n.day && String(n.note ?? '').trim() !== '')
  const ordered = [...usable].sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? 1 : -1
    // Same day: the afternoon shift is the later one.
    const aPm = isAfternoonShift(a.shift)
    const bPm = isAfternoonShift(b.shift)
    return aPm === bPm ? 0 : aPm ? -1 : 1
  })
  return ordered.find(n => handoverReaches(n, reader)) ?? null
}
