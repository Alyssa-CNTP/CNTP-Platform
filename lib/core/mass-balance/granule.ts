import { n } from '@/lib/core/num'
import type { BalanceContext } from './types'

/**
 * Granule Line mass balance (PR-FM-026/7).
 *
 * Water is deliberately EXCLUDED from A: the paper's raw-material figure counts
 * dust only. G (total produced) = C* (bagged) + D (dust not re-fed) + E (coarse
 * not fed) + F (waste); H (raw used) = A; balance = H − G.
 *
 * The dust column keys are passed in rather than imported, so this stays
 * independent of the capture UI's DUST_COLUMNS constant. They only decide which
 * columns are pre-seeded at zero for display — totals are summed from the data.
 *
 * ── Carry-over ──────────────────────────────────────────────────────────────
 * Leftover dust is real, recurring and product-type specific: a shift run under
 * SG Granules leaves SG dust, one run under SF Granules leaves SF dust, and the
 * two are different physical pools that must never be summed (see
 * production.dust_carryover_log, keyed on item_key for exactly that reason).
 *
 * It moves in BOTH directions and they are a day apart:
 *   - Left for tomorrow  → `carryOverOut`. Work in progress, NOT product, so it
 *     is excluded from G and subtracted from the balance. Before this, that
 *     dust showed up as an unexplained H − G shortfall on every shift that had
 *     any, which is precisely the variance an operator learns to ignore.
 *   - Consumed from yesterday → `carryOverIn`. Already inside A, because the
 *     Carry-over banner adds it as a real blend input row; reported separately
 *     so the figure is visible rather than buried in the dust columns.
 */

/** A blend input row, as far as the balance is concerned. */
export interface GranuleBalanceRow {
  dustKey: string
  weight: string
  /** Set by the Carry-over banner — this row is yesterday's leftover dust. */
  fromCarryover?: boolean
}

export interface GranuleBalanceData {
  blends?: readonly { water?: string; rows?: readonly GranuleBalanceRow[] }[]
  outputs?: readonly { weight: string }[]
  dustOutputs?: readonly { weight: string }[]
  waste?: readonly { weight: string }[]
  dustNotRefed?: string
  coarseNotFed?: string
  meterStart?: string
  meterStop?: string
  /**
   * Leftover dust confirmed at shutdown as carrying over to tomorrow's blend.
   * Persisted on the capture data (not only in the ledger) so the balance an
   * operator sees survives a reload and matches what was actually logged.
   */
  dustCarryOverKg?: string
}

export function granuleColumnTotals(d: GranuleBalanceData, dustKeys: readonly string[] = []) {
  const cols: Record<string, number> = {}
  dustKeys.forEach(k => { cols[k] = 0 })
  let carryOverIn = 0
  ;(d.blends ?? []).forEach(b => {
    (b.rows ?? []).forEach(r => {
      cols[r.dustKey] = (cols[r.dustKey] ?? 0) + n(r.weight)
      if (r.fromCarryover) carryOverIn += n(r.weight)
    })
  })
  const totalA = Object.values(cols).reduce((s, v) => s + v, 0)   // dust only (water excluded)
  const water  = (d.blends ?? []).reduce((s, b) => s + n(b.water), 0)
  return { cols, totalA, water, carryOverIn }
}

/** Blend total = sum of that blend's dust weights (water excluded, per the paper). */
export function blendTotal(b: { rows?: readonly { weight: string }[] }): number {
  return (b.rows ?? []).reduce((s, r) => s + n(r.weight), 0)
}

export function granuleTotals(
  d: GranuleBalanceData,
  dustKeys: readonly string[] = [],
  ctx: BalanceContext = {},
) {
  const { cols, totalA, water, carryOverIn: rowCarryOverIn } = granuleColumnTotals(d, dustKeys)
  const cStar   = (d.outputs ?? []).reduce((s, b) => s + n(b.weight), 0)       // bagging summary (C*)
  const dustOut = (d.dustOutputs ?? []).reduce((s, r) => s + n(r.weight), 0)   // SG/SF dust by-product
  const wasteF  = (d.waste ?? []).reduce((s, r) => s + n(r.weight), 0)         // F
  const D = n(d.dustNotRefed)
  const E = n(d.coarseNotFed)
  const G = cStar + D + E + wasteF          // total produced
  const H = totalA                          // total raw material used

  // Prefer an explicit figure from the caller (the ledger) over the one stored
  // on the capture data, mirroring how Sieving prefers the bucket-elevator
  // ledger over the typed figure.
  const carryOverOut = ctx.carryOverOutKg ?? n(d.dustCarryOverKg)
  // The consumed side is already inside A; the ledger figure only overrides how
  // much of A is *attributed* to carry-over, never A itself.
  const carryOverIn = ctx.carryOverInKg ?? rowCarryOverIn

  // Dust held back for tomorrow is not a shortfall — it comes off the variance
  // and is reported in its own column instead.
  const balance = H - G - carryOverOut
  const yieldPct = H > 0 ? (G / H) * 100 : 0
  const runningHours = n(d.meterStop) - n(d.meterStart)
  return {
    cols, totalA, water, cStar, dustOut, wasteF, D, E, G, H,
    carryOverIn, carryOverOut, balance, yieldPct, runningHours,
  }
}
