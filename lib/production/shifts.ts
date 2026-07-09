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
