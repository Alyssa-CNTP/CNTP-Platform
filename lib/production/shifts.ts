// Shift timing — single source of truth for the 07:00 / 16:00 / 23:00 boundaries
// that were previously inlined in capture/assign and LiveCaptureKPIs.

import type { Shift } from '@/lib/supabase/database.types'

// Start hour (24h) of each shift. Night wraps past midnight.
export const SHIFT_HOURS: Record<Shift, { start: number; end: number }> = {
  morning:   { start: 7,  end: 16 },
  afternoon: { start: 16, end: 23 },
  night:     { start: 23, end: 7  },  // wraps to next day
}

export const SHIFT_LABEL: Record<Shift, string> = {
  morning: 'Morning', afternoon: 'Afternoon', night: 'Night',
}

/** The shift covering a given time (default now). */
export function currentShift(at: Date = new Date()): Shift {
  const h = at.getHours()
  return h >= 7 && h < 16 ? 'morning' : h >= 16 && h < 23 ? 'afternoon' : 'night'
}
