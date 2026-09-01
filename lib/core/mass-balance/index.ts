import { assertNever, type SectionKind } from '@/lib/core/types/capture'
import type { BalanceContext, ProductionTotals } from './types'
import { sievingTotals, type SievingBalanceData } from './sieving'
import { refiningTotals, type RefiningBalanceData } from './refining'
import { granuleTotals, type GranuleBalanceData } from './granule'
import { blenderTotals, type BlenderBalanceData } from './blender'
import { pasteuriserTotals, type PasteuriserBalanceData } from './pasteuriser'

export * from './types'
export * from './sieving'
export * from './refining'
export * from './granule'
export * from './blender'
export * from './pasteuriser'

/**
 * Any section's captured data, as far as the balance is concerned.
 *
 * A UNION, not an intersection: the same field name means different things in
 * different sections — `outputs` is `{weight}[]` for Sieving but
 * `{bagCount, bagWeight}[]` for Pasteuriser, and `debag` is `{nett}[]` versus
 * `{stream, weight}[]`. An intersection would demand a shape no real section
 * has. (Those colliding field names are exactly why guessing at fields to
 * identify a section never worked — see ARCHITECTURE.md §4.)
 */
export type AnyBalanceData =
  | SievingBalanceData | RefiningBalanceData | GranuleBalanceData
  | BlenderBalanceData | PasteuriserBalanceData

/**
 * The one place a section's own balance is turned into the shared
 * {@link ProductionTotals} vocabulary.
 *
 * Every consumer goes through here — the capture screen, the persisted
 * prod_mass_balance row, and the production-order summaries — so the three can
 * no longer compute "how much did this shift produce" three different ways.
 * They previously did: the on-screen totals ignored half-bag top-ups entirely
 * while the persisted row included them, and only for Sieving.
 *
 * The switch ends in assertNever, so adding a section kind without giving it a
 * balance fails the build.
 */
export function productionTotals(
  kind: SectionKind,
  data: AnyBalanceData,
  ctx: BalanceContext = {},
): ProductionTotals {
  // Top-ups are added ONCE, here, for every section — never inside a section's
  // own totals — so no path can count them twice. Callers must pass only
  // `mode === 'production'` events; a `mode === 'existing'` bag-to-bag transfer
  // moves mass already counted as output when the source bag was bagged.
  const topUpKg = ctx.topUpKg ?? 0

  switch (kind) {
    case 'sieving': {
      const t = sievingTotals(data as SievingBalanceData, { ...ctx, topUpKg: 0 })
      return {
        totalIn: t.totalIn,
        totalOut: t.totalOut + topUpKg,
        carryOverIn: t.carryOverIn,
        carryOverOut: t.carryOverOut,
        balance: t.totalIn - (t.totalOut + topUpKg) - t.carryOverOut,
      }
    }
    case 'refining': {
      const r = refiningTotals(data as RefiningBalanceData)
      const totalOut = r.totalA + r.totalB + r.totalC + r.totalD + topUpKg
      return { totalIn: r.totalIn, totalOut, carryOverIn: 0, carryOverOut: 0, balance: r.totalIn - totalOut }
    }
    case 'granule': {
      // A (raw dust mixed) vs G (total produced) — the PR-FM-026/7 balance H − G.
      const g = granuleTotals(data as GranuleBalanceData)
      const totalOut = g.G + topUpKg
      return { totalIn: g.totalA, totalOut, carryOverIn: 0, carryOverOut: 0, balance: g.totalA - totalOut }
    }
    case 'blender': {
      // Paper sign convention here is out − in, unlike every other section.
      const b = blenderTotals(data as BlenderBalanceData)
      const totalOut = b.totalOut + topUpKg
      return { totalIn: b.totalIn, totalOut, carryOverIn: 0, carryOverOut: 0, balance: totalOut - b.totalIn }
    }
    case 'pasteuriser': {
      // Raw material used (D+E) vs everything produced (A+B+C).
      const p = pasteuriserTotals(data as PasteuriserBalanceData)
      const totalOut = p.produced + topUpKg
      return { totalIn: p.rawUsed, totalOut, carryOverIn: 0, carryOverOut: 0, balance: totalOut - p.rawUsed }
    }
    default:
      return assertNever(kind, 'section kind')
  }
}

/** Sum {@link ProductionTotals} across several productions on one shift. */
export function sumProductionTotals(totals: readonly ProductionTotals[]): ProductionTotals {
  return totals.reduce<ProductionTotals>((acc, t) => ({
    totalIn: acc.totalIn + t.totalIn,
    totalOut: acc.totalOut + t.totalOut,
    carryOverIn: acc.carryOverIn + t.carryOverIn,
    carryOverOut: acc.carryOverOut + t.carryOverOut,
    balance: acc.balance + t.balance,
  }), { totalIn: 0, totalOut: 0, carryOverIn: 0, carryOverOut: 0, balance: 0 })
}

/**
 * Add session-scoped half-bag top-up kg to an already-computed set of totals.
 *
 * Top-ups are recorded per SESSION, not per production, so they must be added
 * once after summing rather than inside each production's totals.
 *
 * The sign matters and differs by section: Sieving, Refining and Granule read
 * `in − out`, so more output moves the balance DOWN; Blender and Pasteuriser
 * follow their paper forms' `out − in`, so more output moves it UP. Getting
 * this wrong silently mis-states the variance, which is why it lives here
 * behind an exhaustive switch rather than being open-coded at the call site.
 */
export function withTopUp(kind: SectionKind, t: ProductionTotals, kg: number): ProductionTotals {
  if (!kg) return t
  let outRaisesBalance: boolean
  switch (kind) {
    case 'sieving':
    case 'refining':
    case 'granule':
      outRaisesBalance = false
      break
    case 'blender':
    case 'pasteuriser':
      outRaisesBalance = true
      break
    default:
      return assertNever(kind, 'section kind')
  }
  return {
    ...t,
    totalOut: t.totalOut + kg,
    balance: t.balance + (outRaisesBalance ? kg : -kg),
  }
}
