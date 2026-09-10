/**
 * An operator's own scorecard, summarised from the shifts they were rated on.
 *
 * The numbers come from `production.capture_ratings`, which already exists and
 * already means something specific: a supervisor scores PERFORMANCE (did they
 * run the line well) and ACCURACY (was the data they captured right) out of
 * five, and the system computes its own accuracy read from what actually
 * landed in the database. Two human scores, not one, because they fail
 * independently — averaging them hides both.
 *
 * Nothing new is measured here. This only averages what a supervisor already
 * recorded, which is the difference between showing someone their record and
 * inventing a metric to judge them by.
 *
 * ── Why unrated shifts are counted separately ───────────────────────────────
 *
 * A shift with no rating is not a zero. Supervisors do not rate every shift,
 * and treating a missing score as a bad one would drag an average down for
 * something the operator did not do. `ratedShifts` is therefore the divisor,
 * and `unratedShifts` is reported next to it so a thin average is visibly
 * thin rather than quietly wrong.
 */

export interface ScorecardRow {
  /** 1–5, or null when the supervisor left it blank. */
  performance: number | null
  accuracy: number | null
  /** 0–100, computed by the system when the rating was saved. */
  systemAccuracyPct: number | null
}

export interface Scorecard {
  ratedShifts: number
  unratedShifts: number
  /** Averages over the shifts that carry that score, or null when none do. */
  avgPerformance: number | null
  avgAccuracy: number | null
  avgSystemAccuracyPct: number | null
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const total = values.reduce((s, v) => s + v, 0)
  // One decimal. A score out of five reported to four decimal places invites
  // an argument about a difference that is not there.
  return Math.round((total / values.length) * 10) / 10
}

const usable = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v)

export function summariseScorecard(rows: readonly ScorecardRow[]): Scorecard {
  const perf = rows.map(r => r.performance).filter(usable)
  const acc  = rows.map(r => r.accuracy).filter(usable)
  const sys  = rows.map(r => r.systemAccuracyPct).filter(usable)

  // "Rated" means a human put a number on it. A row that carries only a
  // system figure was computed, not reviewed, and counting it as rated would
  // overstate how much of their record a supervisor has actually looked at.
  const rated = rows.filter(r => usable(r.performance) || usable(r.accuracy)).length

  return {
    ratedShifts:   rated,
    unratedShifts: rows.length - rated,
    avgPerformance:       mean(perf),
    avgAccuracy:          mean(acc),
    avgSystemAccuracyPct: sys.length ? Math.round(mean(sys) as number) : null,
  }
}
