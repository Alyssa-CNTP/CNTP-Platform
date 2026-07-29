// lib/maintenance/allocation.ts
// Deterministic, STATELESS rotation for auto-allocating scheduled checklists to
// technicians. These are pure functions — they change nothing on the shift roster;
// the caller reads the on-duty technician names FROM the roster (read-only) and
// passes them in. Keeping the rotation stateless (offset by ISO-week / month index)
// means no extra table is needed and the same inputs always produce the same split.

export interface AllocTemplate { id: number; area: string; sort_order: number }

// Weekly — rotate the weekly checklists among the morning-shift technicians so the
// same tech doesn't get the same checklist every week (offset by the ISO week).
export function allocateWeekly(templates: AllocTemplate[], techs: string[], isoWeek: number): Record<number, string> {
  const out: Record<number, string> = {}
  if (!techs.length) return out
  const list = [...templates].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  list.forEach((t, i) => { out[t.id] = techs[(i + isoWeek) % techs.length] })
  return out
}

// The three heavy production lines rotate month-to-month (order: granule, sieving,
// pasteurizer). Matched on the checklist area.
const HEAVY = [/granule/i, /siev/i, /pasteuri[sz]er/i]

// Monthly — the heavy lines rotate across technicians each month; the remaining
// checklists are distributed greedily to the least-loaded technician (so totals stay
// even and the tech without a heavy line picks up more), with a monthly-rotated
// starting point so ties don't always favour the same person.
export function allocateMonthly(templates: AllocTemplate[], techs: string[], monthIx: number): Record<number, string> {
  const out: Record<number, string> = {}
  if (!techs.length) return out
  const n = techs.length
  const list = [...templates].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  const load = new Array(n).fill(0)

  const heavy: AllocTemplate[] = []
  HEAVY.forEach((re, j) => {
    const t = list.find(x => re.test(x.area))
    if (t && !heavy.includes(t)) { const ti = (monthIx + j) % n; out[t.id] = techs[ti]; load[ti]++; heavy.push(t) }
  })

  for (const t of list.filter(t => !heavy.includes(t))) {
    let best = 0, bestLoad = Infinity
    for (let k = 0; k < n; k++) {
      const ti = (k + monthIx) % n
      if (load[ti] < bestLoad) { bestLoad = load[ti]; best = ti }
    }
    out[t.id] = techs[best]; load[best]++
  }
  return out
}

// ISO week number (1..53) for a date — used as the weekly rotation offset.
export function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}
// Absolute month index — used as the monthly rotation offset.
export function monthIndexOf(d: Date): number { return d.getFullYear() * 12 + d.getMonth() }
