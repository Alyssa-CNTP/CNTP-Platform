// lib/production/db-date.ts
//
// One chokepoint for turning a floor-entered date into something a Postgres
// `date` column will accept.
//
// The floor writes bag-tag dates day-first as DD-MM-YY, because that is what is
// printed on the physical bag tag — Refining's capture screen stores exactly
// that string (see todayDelivery() in RefiningCapture) and shows it back
// unchanged. Postgres rejects it outright under the default MDY datestyle
// ("22008 date/time field value out of range: 20-08-26"), and any value it
// does NOT reject would be read month-first — 06-07-26 as 6 July, not 6 July's
// intended reading. Either way the row must not reach the database raw: a
// single bad date fails the whole multi-row insert it travels in.
//
// So every date bound for a `date` column goes through dbDate() first, the same
// way every lot number goes through upperCode().

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  // Round-trip through UTC to reject the almost-valid (31 February, 30 June's
  // neighbour in a short month) rather than let Postgres roll it over.
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Normalise a captured date to `yyyy-MM-dd`, or null when there is nothing
 * usable. Never throws and never returns a value Postgres would reject —
 * an unparseable date is dropped rather than allowed to fail the write it
 * is part of, since the date is supporting detail and the weights are not.
 *
 * Accepts: `yyyy-MM-dd` (and any ISO timestamp starting with one), and
 * day-first `d-M-yy` / `d-M-yyyy` with `-`, `/` or `.` as the separator.
 */
export function dbDate(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null

  // Already ISO (a bare date, or a full timestamp) — keep the date part.
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m1) return iso(+m1[1], +m1[2], +m1[3])

  // Day-first, as written on a bag tag. A 2-digit year is this century:
  // these are delivery/tag dates, never historical ones.
  const m2 = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/)
  if (m2) {
    const y = +m2[3]
    return iso(y < 100 ? 2000 + y : y, +m2[2], +m2[1])
  }

  return null
}
