/**
 * Mass-balance tolerance — ±1% of Total Input, for every section.
 *
 * This replaced a flat `MASS_BALANCE_TOLERANCE_KG = 15`, plus a 100 kg special
 * case for refining2. A fixed kg allowance is the wrong shape for a factory
 * that runs anything from a 200 kg trial to a 4 t shift: 15 kg was ~7% of a
 * small run (so nothing ever flagged) and ~0.4% of a big one (so everything
 * did). A percentage of what actually went in tracks the process instead of
 * the calendar.
 *
 * It is deliberately a percentage of TOTAL INPUT, not of output: input is the
 * quantity that is known before the shift produces anything, so the goalposts
 * cannot move because the shift under-produced. A section that loses half its
 * material should be flagged against what it was given, not against the little
 * it managed to bag.
 *
 * Carry-over is already inside `totalIn` (see types.ts), so a shift consuming
 * yesterday's leftovers gets an allowance on that material too — correct, since
 * it is material genuinely passing through the line today.
 */

/** ±1%, per the section mass-balance specifications. Single source. */
export const MASS_BALANCE_TOLERANCE_PCT = 0.01

/**
 * A zero-input session has no meaningful percentage tolerance. It is also not
 * a balance worth flagging — an empty capture is "not started", not "1,000 kg
 * unaccounted for" — so callers gate on `totalIn > 0` before flagging at all
 * (they already did with the flat figure). Returning 0 keeps that behaviour:
 * with no input, nothing is within tolerance, but nothing is checked either.
 */
export function massBalanceToleranceKg(totalInKg: number): number {
  const t = Number(totalInKg)
  if (!Number.isFinite(t) || t <= 0) return 0
  // Rounded to 0.1 kg — the precision every weight on the floor is captured at.
  // Without this a 1,234.56 kg input yields a 12.3456 kg allowance that renders
  // as "±12.3 kg" while comparing against 12.3456, so a 12.34 kg variance shows
  // as inside a limit the screen says it is outside.
  return Math.round(t * MASS_BALANCE_TOLERANCE_PCT * 10) / 10
}

/** True when a variance is acceptable for the input that produced it. */
export function withinMassBalanceTolerance(varianceKg: number, totalInKg: number): boolean {
  return Math.abs(Number(varianceKg) || 0) <= massBalanceToleranceKg(totalInKg)
}

/** The variance as a percentage of input — what the ±1% is actually measuring. */
export function massBalanceVariancePct(varianceKg: number, totalInKg: number): number | null {
  const t = Number(totalInKg)
  if (!Number.isFinite(t) || t <= 0) return null
  return Math.round(((Number(varianceKg) || 0) / t) * 1000) / 10
}
