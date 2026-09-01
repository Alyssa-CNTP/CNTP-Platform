import { n } from '@/lib/core/num'

/**
 * Granule Line mass balance (PR-FM-026/7). Moved verbatim from
 * GranuleCapture.tsx.
 *
 * Water is deliberately EXCLUDED from A: the paper's raw-material figure counts
 * dust only. G (total produced) = C* (bagged) + D (dust not re-fed) + E (coarse
 * not fed) + F (waste); H (raw used) = A; balance = H − G.
 *
 * The dust column keys are passed in rather than imported, so this stays
 * independent of the capture UI's DUST_COLUMNS constant. They only decide which
 * columns are pre-seeded at zero for display — totals are summed from the data.
 */

export interface GranuleBalanceData {
  blends?: readonly { water?: string; rows?: readonly { dustKey: string; weight: string }[] }[]
  outputs?: readonly { weight: string }[]
  dustOutputs?: readonly { weight: string }[]
  waste?: readonly { weight: string }[]
  dustNotRefed?: string
  coarseNotFed?: string
  meterStart?: string
  meterStop?: string
}

export function granuleColumnTotals(d: GranuleBalanceData, dustKeys: readonly string[] = []) {
  const cols: Record<string, number> = {}
  dustKeys.forEach(k => { cols[k] = 0 })
  ;(d.blends ?? []).forEach(b => {
    (b.rows ?? []).forEach(r => { cols[r.dustKey] = (cols[r.dustKey] ?? 0) + n(r.weight) })
  })
  const totalA = Object.values(cols).reduce((s, v) => s + v, 0)   // dust only (water excluded)
  const water  = (d.blends ?? []).reduce((s, b) => s + n(b.water), 0)
  return { cols, totalA, water }
}

/** Blend total = sum of that blend's dust weights (water excluded, per the paper). */
export function blendTotal(b: { rows?: readonly { weight: string }[] }): number {
  return (b.rows ?? []).reduce((s, r) => s + n(r.weight), 0)
}

export function granuleTotals(d: GranuleBalanceData, dustKeys: readonly string[] = []) {
  const { cols, totalA, water } = granuleColumnTotals(d, dustKeys)
  const cStar   = (d.outputs ?? []).reduce((s, b) => s + n(b.weight), 0)       // bagging summary (C*)
  const dustOut = (d.dustOutputs ?? []).reduce((s, r) => s + n(r.weight), 0)   // SG/SF dust by-product
  const wasteF  = (d.waste ?? []).reduce((s, r) => s + n(r.weight), 0)         // F
  const D = n(d.dustNotRefed)
  const E = n(d.coarseNotFed)
  const G = cStar + D + E + wasteF          // total produced
  const H = totalA                          // total raw material used
  const balance = H - G
  const yieldPct = H > 0 ? (G / H) * 100 : 0
  const runningHours = n(d.meterStop) - n(d.meterStart)
  return { cols, totalA, water, cStar, dustOut, wasteF, D, E, G, H, balance, yieldPct, runningHours }
}
