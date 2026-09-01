import { describe, it, expect } from 'vitest'
import {
  productionTotals, withSessionAdjustments,
  granuleTotals, blenderTotals, pasteuriserTotals,
  massBalanceToleranceKg, withinMassBalanceTolerance, massBalanceVariancePct,
} from './index'

/**
 * The per-section mass-balance specifications, pinned one section at a time.
 *
 * The five formulas are deliberately different (ARCHITECTURE.md §4), so these
 * are written per section rather than as one shared expectation. What they have
 * in common is only the tolerance: ±1% of Total Input, everywhere.
 */

describe('tolerance is ±1% of Total Input, on every section', () => {
  it('scales with the run instead of being a flat kg figure', () => {
    expect(massBalanceToleranceKg(1500)).toBe(15)     // identical to the old flat 15
    expect(massBalanceToleranceKg(300)).toBe(3)       // a small run is held tighter
    expect(massBalanceToleranceKg(4000)).toBe(40)     // a big one gets more room
  })

  it('has no section special cases — refining2 used to get a flat 100 kg', () => {
    // The old rule gave refining2 100 kg regardless of size, because it runs
    // bigger volumes. A percentage reaches 100 kg at a 10 t input on its own,
    // which is the point: the allowance follows the volume that earned it.
    expect(massBalanceToleranceKg(10_000)).toBe(100)
    expect(massBalanceToleranceKg(2_000)).toBe(20)
  })

  it('rounds to 0.1 kg so the figure shown is the figure compared', () => {
    // Without the rounding the screen renders "±12.3 kg" while comparing
    // against 12.3456, so a 12.34 kg variance reads as inside a limit the
    // screen says it is outside.
    expect(massBalanceToleranceKg(1234.56)).toBe(12.3)
    expect(withinMassBalanceTolerance(12.34, 1234.56)).toBe(false)
  })

  it('gives a zero-input session no tolerance — callers gate on input > 0', () => {
    expect(massBalanceToleranceKg(0)).toBe(0)
    expect(massBalanceToleranceKg(-5)).toBe(0)
    expect(massBalanceToleranceKg(NaN)).toBe(0)
  })

  it('is symmetric: over and under are judged alike', () => {
    expect(withinMassBalanceTolerance(10, 1000)).toBe(true)
    expect(withinMassBalanceTolerance(-10, 1000)).toBe(true)
    expect(withinMassBalanceTolerance(10.1, 1000)).toBe(false)
  })

  it('reports the variance as a percentage', () => {
    expect(massBalanceVariancePct(10, 1000)).toBe(1)
    expect(massBalanceVariancePct(-25, 1000)).toBe(-2.5)
    expect(massBalanceVariancePct(10, 0)).toBeNull()
  })
})

describe('Granule Line — leftover dust carries over per product type', () => {
  const base = {
    blends: [{ rows: [{ dustKey: 'sg', weight: '1000' }] }],
    outputs: [{ weight: '900' }],
  }

  it('dust held back for tomorrow is not output, and not a shortfall either', () => {
    const bare = productionTotals('granule', base)
    expect(bare.balance).toBe(100)              // reads as 100 kg unaccounted for

    const t = productionTotals('granule', { ...base, dustCarryOverKg: '100' })
    expect(t.totalOut).toBe(900)                // carry-over is not finished product
    expect(t.carryOverOut).toBe(100)            // it gets its own column
    expect(t.balance).toBe(0)                   // and the variance reconciles
  })

  it('dust consumed from a previous day is input, and is reported as such', () => {
    const t = productionTotals('granule', {
      blends: [{ rows: [
        { dustKey: 'sg', weight: '800' },
        { dustKey: 'sg', weight: '200', fromCarryover: true },
      ] }],
      outputs: [{ weight: '1000' }],
    })
    expect(t.totalIn).toBe(1000)       // the carry-over row is already inside A
    expect(t.carryOverIn).toBe(200)    // visible, rather than buried in the columns
    expect(t.balance).toBe(0)
  })

  it('SG and SF stay in their own columns and are never summed together', () => {
    // A PO run under SG Granules leaves SG dust; one under SF Granules leaves
    // SF dust. They are different physical pools — the ledger keys on the dust
    // type for exactly this reason.
    const { cols } = granuleTotals({
      blends: [{ rows: [
        { dustKey: 'sg', weight: '600' },
        { dustKey: 'sf', weight: '400' },
      ] }],
    }, ['sg', 'sf'])
    expect(cols.sg).toBe(600)
    expect(cols.sf).toBe(400)
  })

  it('prefers the ledger figure over the one stored on the capture data', () => {
    const t = productionTotals('granule',
      { ...base, dustCarryOverKg: '100' }, { carryOverOutKg: 80 })
    expect(t.carryOverOut).toBe(80)
    expect(t.balance).toBe(20)
  })

  it('still excludes water from raw material, as the paper form does', () => {
    const g = granuleTotals({
      blends: [{ water: '50', rows: [{ dustKey: 'sg', weight: '1000' }] }],
    })
    expect(g.totalA).toBe(1000)
    expect(g.water).toBe(50)
  })
})

describe('Blender — a new bag made from an existing one is not new production', () => {
  const d = { inputs: [{ weight: '1000', itemKey: 'a' }], outputs: [{ weight: '1000' }] }

  it('subtracts transferred-in mass from Total Output', () => {
    // 200 kg of that 1,000 kg output came out of an existing bag, and was
    // counted as output when THAT bag was bagged. Left in, the shift reports
    // 1,000 kg produced from 1,000 kg in — and the production order inherits it.
    const t = productionTotals('blender', d, { transferInKg: 200 })
    expect(t.totalOut).toBe(800)
    expect(t.balance).toBe(-200)
  })

  it('nets a top-up and a transfer in the same session', () => {
    const t = productionTotals('blender', d, { topUpKg: 50, transferInKg: 200 })
    expect(t.totalOut).toBe(850)
  })

  it('applies at session level with the right sign for each section', () => {
    const base = { totalIn: 1000, totalOut: 1000, carryOverIn: 0, carryOverOut: 0, balance: 0 }
    // Blender's paper form reads out − in, so removing output moves it DOWN.
    expect(withSessionAdjustments('blender', base, { transferInKg: 200 }))
      .toMatchObject({ totalOut: 800, balance: -200 })
    // Refining reads in − out, so the same removal moves it UP.
    expect(withSessionAdjustments('refining', base, { transferInKg: 200 }))
      .toMatchObject({ totalOut: 800, balance: 200 })
  })

  it('leaves the blend-ratio breakdown untouched', () => {
    // The Blender's own by-item view is how the blend ratio is checked, and it
    // is not part of the balance rewrite.
    const b = blenderTotals({ inputs: [
      { weight: '600', itemKey: 'x' }, { weight: '400', itemKey: 'y' },
    ], outputs: [] })
    expect(b.byItem).toEqual({ x: 600, y: 400 })
  })
})

describe('Pasteuriser — every bag kind is on the right side of the balance', () => {
  it('Total Output counts Final Product, High Moisture AND Refill lines', () => {
    const t = pasteuriserTotals({
      weightPerBag: '18',
      debag: [{ stream: 'main', weight: '1800' }],
      outputs: [
        { bagCount: '50', bagWeight: '18' },   // Final Product
        { bagCount: '20', bagWeight: '18' },   // High Moisture
        { bagCount: '30', bagWeight: '18' },   // Refill
      ],
      byProducts: [], floorWaste: '0',
    })
    // A sums the pallet lines without filtering on `kind` — which is precisely
    // what makes all three count. Adding a filter here would silently drop
    // rework and refills out of the shift's production.
    expect(t.A).toBe(1800)
    expect(t.balance).toBe(0)
  })

  it('Total Input counts blend bags, High Moisture rework AND other lines', () => {
    const t = pasteuriserTotals({
      debag: [
        { stream: 'main', weight: '1000' },       // blend bags
        { stream: 'main', weight: '200' },        // High Moisture fed back in
        { stream: 'postsieve', weight: '300' },   // from the Granule line
      ],
      outputs: [], byProducts: [{ weight: '1500' }], floorWaste: '0',
    })
    expect(t.D).toBe(1200)
    expect(t.E).toBe(300)
    expect(t.rawUsed).toBe(1500)
    expect(t.balance).toBe(0)
  })

  it('a part-bag left over from a previous run counts at its actual weight', () => {
    const t = pasteuriserTotals({
      debag: [{ stream: 'main', weight: '7.5' }],
      outputs: [], byProducts: [{ weight: '7.5' }], floorWaste: '0',
    })
    expect(t.rawUsed).toBe(7.5)
    expect(t.balance).toBe(0)
  })
})

describe('Refining — bags from outside the system count like any other', () => {
  it('an input bag registered rather than scanned still counts as input', () => {
    // "Bags from the outside" are typed in with their weight when the serial is
    // not found in bag_tags. Nothing in the balance treats them differently —
    // what they need is a bag_tags record, not a different formula.
    const t = productionTotals('refining', {
      inputs: [{ weight: '600' }, { weight: '400' }],
      outputA: { bags: [{ weight: '1000' }] },
      outputB: null, outputC: null, outputD: null,
    })
    expect(t.totalIn).toBe(1000)
    expect(t.balance).toBe(0)
  })

  it('counts all four output streams, and a top-up on top', () => {
    const t = productionTotals('refining', {
      inputs: [{ weight: '1000' }],
      outputA: { bags: [{ weight: '400' }] },
      outputB: { bags: [{ weight: '300' }] },
      outputC: { bags: [{ weight: '200' }] },
      outputD: { bags: [{ weight: '80' }] },
    }, { topUpKg: 20 })
    expect(t.totalOut).toBe(1000)
    expect(t.balance).toBe(0)
  })
})
