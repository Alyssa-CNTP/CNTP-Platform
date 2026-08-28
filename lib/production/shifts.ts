// Shift timing — single source of truth for the shift boundaries that were
// previously inlined in capture/assign and LiveCaptureKPIs.
//
// CNTP runs TWO shifts a day: Morning (07h00–16h00) and the Afternoon/Night
// shift (16h00–01h00). Internally the 16h00–01h00 shift is stored as
// 'afternoon' — that is the value the capture flow, sieving mass-balance and
// the 16h00 changeover already use. The legacy 'night' value is kept in the
// type only for backward-compat with older assignment rows; nothing writes it
// any more. Read paths that filter by shift should accept both 'afternoon' and
// 'night' for the 16h00–01h00 window.

import type { Shift } from '@/lib/supabase/database.types'

// Start hour (24h) of each shift. The afternoon/night shift wraps past midnight.
export const SHIFT_HOURS: Record<Shift, { start: number; end: number }> = {
  morning:   { start: 7,  end: 16 },
  afternoon: { start: 16, end: 7  },  // 16h00–01h00 (wraps; empty 01h00–07h00)
  night:     { start: 16, end: 7  },  // legacy alias of afternoon
}

export const SHIFT_LABEL: Record<Shift, string> = {
  morning: 'Morning', afternoon: 'Afternoon / Night', night: 'Night',
}

/** Assignment-row shift values that cover the 16h00–01h00 window (incl. legacy). */
export const NIGHT_SHIFT_VALUES: Shift[] = ['afternoon', 'night']
/** The set of assignment-shift values to query for a resolved shift. */
export function shiftValuesFor(shift: Shift): Shift[] {
  return shift === 'morning' ? ['morning'] : NIGHT_SHIFT_VALUES
}

/** The shift covering a given time (default now). Two shifts: morning, afternoon/night. */
export function currentShift(at: Date = new Date()): Shift {
  const h = at.getHours()
  return h >= 7 && h < 16 ? 'morning' : 'afternoon'
}

/**
 * The (date, shift) that capture rows for "right now" actually belong to, in
 * SAST — the single source of truth capture/assign screens should use instead
 * of each computing its own `format(new Date(),'yyyy-MM-dd')` + currentShift().
 *
 * The bug this fixes: the afternoon/night shift runs 16h00–01h00, so it spans
 * a calendar-date rollover. Every capture query is keyed on (date, shift), and
 * the night shift's `shift_assignments`/`prod_sessions` rows are filed under
 * the date the shift STARTED (e.g. 17 Aug), not the date the clock happens to
 * read while it's still running. A naive `format(new Date(),'yyyy-MM-dd')`
 * rolls to 18 Aug at the stroke of midnight while the shift is still the same
 * "afternoon" one — so from 00h00 the capture landing page queries
 * (18 Aug, afternoon), finds nothing, and shows "No sections assigned for
 * this shift yet", even though the 17 Aug night shift is still in progress
 * and its session is still open. Device-local `new Date()` is intentional
 * here (matching the rest of the capture flow) — this only needs to agree
 * with the browser's own clock, not necessarily true SAST if a tablet's
 * timezone were ever wrong (a separate, lower-probability risk `sastToday()`
 * exists for).
 *
 * 00h00–06h59: the tail of YESTERDAY's afternoon/night shift (or, 01h00–07h00,
 * genuinely between shifts — but there is no "no shift" value to return, and
 * resolving to yesterday's afternoon/night is what lets someone still
 * wrapping up that shift's capture find their session).
 * 07h00–15h59: today, morning.
 * 16h00–23h59: today, afternoon/night (just started).
 */
export function productionShiftNow(at: Date = new Date()): { date: string; shift: Shift } {
  const h = at.getHours()
  if (h >= 7 && h < 16) return { date: ymd(at), shift: 'morning' }
  if (h >= 16) return { date: ymd(at), shift: 'afternoon' }
  const yesterday = new Date(at); yesterday.setDate(yesterday.getDate() - 1)
  return { date: ymd(yesterday), shift: 'afternoon' }
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Today's date in SAST (Africa/Johannesburg), independent of the device's own
 * timezone/clock — the single source of truth for "today" across the
 * Supervisor Hub. Several tabs used to compute "today" from the browser's
 * local `new Date()` instead, which silently disagreed with this one on any
 * device not actually set to SAST.
 */
export function sastToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/**
 * A UTC timestamp rendered in SAST (Africa/Johannesburg), e.g. "27 Aug, 14:32" —
 * for anything stamped server-side (created_at, etc.) that must read correctly
 * regardless of the viewing device's own timezone.
 */
export function formatSAST(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso)).replace(',', '')
}
