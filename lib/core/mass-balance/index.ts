import { assertNever, type SectionKind } from '@/lib/core/types/capture'
import type { BalanceContext, ProductionTotals } from './types'
import { sievingTotals, type SievingBalanceData } from './sieving'
import { refiningTotals, type RefiningBalanceData } from './refining'
import { granuleTotals, type GranuleBalanceData } from './granule'
import { blenderTotals, type BlenderBalanceData } from './blender'
import { pasteuriserTotals, type PasteuriserBalanceData } from './pasteuriser'

export * from './types'
export * from './tolerance'
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
  // …and the other half of that rule: mass transferred INTO a bag this session
  // captured as output. It sits inside the captured weight but was produced
  // elsewhere, so it comes back off. See BalanceContext.transferInKg.
  const transferInKg = ctx.transferInKg ?? 0
  /** Finished product actually made here. */
  const produced = (sectionOut: number) => sectionOut + topUpKg - transferInKg

  switch (kind) {
    case 'sieving': {
      const t = sievingTotals(data as SievingBalanceData, { ...ctx, topUpKg: 0 })
      const totalOut = produced(t.totalOut)
      return {
        totalIn: t.totalIn,
        totalOut,
        carryOverIn: t.carryOverIn,
        carryOverOut: t.carryOverOut,
        balance: t.totalIn - totalOut - t.carryOverOut,
      }
    }
    case 'refining': {
      // Inputs include bags brought in from outside that were not already in
      // bag_tags — the operator registers them on the row, and their weight
      // counts like any other input. Outputs likewise include bags created
      // here for material arriving from outside the line.
      const r = refiningTotals(data as RefiningBalanceData)
      const totalOut = produced(r.totalA + r.totalB + r.totalC + r.totalD)
      return { totalIn: r.totalIn, totalOut, carryOverIn: 0, carryOverOut: 0, balance: r.totalIn - totalOut }
    }
    case 'granule': {
      // A (raw dust mixed) vs G (total produced) — the PR-FM-026/7 balance
      // H − G, less the dust held back for tomorrow's blend.
      const g = granuleTotals(data as GranuleBalanceData, [], ctx)
      const totalOut = produced(g.G)
      return {
        totalIn: g.totalA,
        totalOut,
        carryOverIn: g.carryOverIn,
        carryOverOut: g.carryOverOut,
        balance: g.totalA - totalOut - g.carryOverOut,
      }
    }
    case 'blender': {
      // Paper sign convention here is out − in, unlike every other section.
      // This is the section where transferInKg matters most: making up a new
      // bag by drawing from an existing one is routine here, and the new bag
      // is captured as output even though its mass was counted when the source
      // bag was bagged. Double-counting it inflates the production order.
      const b = blenderTotals(data as BlenderBalanceData)
      const totalOut = produced(b.totalOut)
      return { totalIn: b.totalIn, totalOut, carryOverIn: 0, carryOverOut: 0, balance: totalOut - b.totalIn }
    }
    case 'pasteuriser': {
      // Raw material used (D+E) vs everything produced (A+B+C). D already
      // carries High Moisture rework bags fed back in and leftover part-bags;
      // E carries bags from other lines (Granule). Output A already carries
      // every kind of pallet line — Final Product, High Moisture and Refill —
      // because it sums the lines rather than filtering on `kind`.
      const p = pasteuriserTotals(data as PasteuriserBalanceData)
      const totalOut = produced(p.produced)
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
  return withSessionAdjustments(kind, t, { topUpKg: kg })
}

/**
 * Apply every session-scoped adjustment to already-summed totals.
 *
 * Both figures are recorded per SESSION rather than per production, so they are
 * applied once after summing. They pull in opposite directions:
 *
 *   + topUpKg      material this shift produced that went into a bag created
 *                  earlier, so it never appears in this session's outputs
 *   − transferInKg material already counted as output when its source bag was
 *                 bagged, which has since been moved into a bag this session
 *                 DOES count as output
 *
 * Omitting the second is how a Blender shift that makes up a new bag from an
 * existing one reports the same material twice, on both the shift total and the
 * production order.
 */
export function withSessionAdjustments(
  kind: SectionKind,
  t: ProductionTotals,
  adj: { topUpKg?: number; transferInKg?: number },
): ProductionTotals {
  const net = (adj.topUpKg ?? 0) - (adj.transferInKg ?? 0)
  if (!net) return t
  return {
    ...t,
    totalOut: t.totalOut + net,
    // Blender and Pasteuriser follow their paper forms' `out − in`, so more
    // output moves the balance UP; the other three read `in − out` and move
    // DOWN. Getting this wrong silently mis-states the variance, which is why
    // it lives behind an exhaustive switch rather than open-coded at the call
    // site.
    balance: t.balance + (outRaisesBalance(kind) ? net : -net),
  }
}

function outRaisesBalance(kind: SectionKind): boolean {
  switch (kind) {
    case 'sieving':
    case 'refining':
    case 'granule':
      return false
    case 'blender':
    case 'pasteuriser':
      return true
    default:
      return assertNever(kind, 'section kind')
  }
}
