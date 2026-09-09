/**
 * Throughput and yield.
 *
 * Extracted from copies that were written out by hand in at least seven places:
 *   kgPerHour — shift-report-builder.ts:300, orders-kpis/route.ts:201 and :277
 *   yieldPct  — shift-report-builder.ts:253 and :526, orders/page.tsx:727,
 *               orders/[id]/page.tsx:151, supervisor/analytics/page.tsx:126
 *
 * The yield copies were written two different ways — `round1((out / in) * 100)`
 * and `Math.round((out / in) * 1000) / 10` — which are the same arithmetic
 * spelled differently. All of them return null on a zero denominator, so they
 * collapse into one function with no behaviour change. Pinned by metrics.test.ts.
 */

/** Round to one decimal place. Was duplicated verbatim in three files. */
export function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/**
 * Throughput in kg/hour, to one decimal.
 *
 * Returns null when there is no elapsed time to divide by, rather than 0 or
 * Infinity — callers render null as an em dash. A zero here would read as "this
 * line produced nothing per hour", which is a different claim from "we don't
 * know how long it ran".
 *
 * Callers that aggregate across sections must sum the numerator and denominator
 * and call this ONCE, not average per-line rates — otherwise a line that ran for
 * ten minutes skews the total as heavily as one that ran all shift. See the
 * comment at orders-kpis/route.ts:277.
 */
export function kgPerHour(outputKg: number, minutes: number): number | null {
  if (!(minutes > 0)) return null
  return round1(outputKg / (minutes / 60))
}

/**
 * Yield as a percentage of input, to one decimal.
 *
 * Returns null when there is no input to divide by, for the same reason as
 * kgPerHour: unknown is not zero.
 *
 * Note this is the generic in-vs-out yield. Granule computes its own yield off
 * the mass-balance G and A figures rather than raw input/output totals — that
 * one lives with the Granule mass-balance logic, not here, because it means
 * something different. See ARCHITECTURE.md §4.
 */
export function yieldPct(outputKg: number, inputKg: number): number | null {
  if (!(inputKg > 0)) return null
  return round1((outputKg / inputKg) * 100)
}
