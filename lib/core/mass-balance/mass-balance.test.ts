import { describe, it, expect } from 'vitest'
import {
  productionTotals, sumProductionTotals,
  sievingTotals, refiningTotals, granuleTotals, blenderTotals, pasteuriserTotals, withTopUp,
} from './index'

/**
 * The five formulas are deliberately DIFFERENT (ARCHITECTURE.md §4). These
 * tests pin each one separately, and pin the two rules that cut across all of
 * them: top-ups are counted once, and bucket-elevator carry-over is never
 * disguised as output.
 */

const sievingData = {
  debag:    [{ nett: '1000' }, { nett: '500' }],
  spillage: [{ kg: '200' }, { kg: '30' }, { kg: '20' }],   // [0] = bucket elevator
  outputs:  [{ weight: '900' }, { weight: '600' }],
}

describe('sieving — bucket elevator is carry-over, not output', () => {
  it('afternoon LEAVES a carry-over: excluded from output, reported separately', () => {
    const t = sievingTotals(sievingData, { shift: 'afternoon' })
    expect(t.totalOut).toBe(1500)        // bagged product only — the 200 is not here
    expect(t.carryOverOut).toBe(200)
    expect(t.carryOverIn).toBe(0)
    expect(t.totalIn).toBe(1550)         // 1500 debag + 50 machine spillage
    expect(t.balance).toBe(1550 - 1500 - 200)
  })

  it('morning CONSUMES a carry-over: counted as input', () => {
    const t = sievingTotals(sievingData, { shift: 'morning' })
    expect(t.carryOverIn).toBe(200)
    expect(t.carryOverOut).toBe(0)
    expect(t.totalIn).toBe(1750)         // 1500 debag + 50 machine + 200 consumed
    expect(t.totalOut).toBe(1500)
  })

  it('prefers the ledger figure over the typed one for consumed carry-over', () => {
    // The ledger is variant-family matched; the typed figure is not.
    const t = sievingTotals(sievingData, { shift: 'morning', carryOverInKg: 180 })
    expect(t.carryOverIn).toBe(180)
    expect(t.totalIn).toBe(1730)
  })

  it('a ledger figure of 0 means nothing to consume — not "fall back to typed"', () => {
    const t = sievingTotals(sievingData, { shift: 'morning', carryOverInKg: 0 })
    expect(t.carryOverIn).toBe(0)
    expect(t.totalIn).toBe(1550)
  })

  it('the balance is arithmetically identical to the old formula', () => {
    // Old: in = debag + machine + (afternoon ? 0 : bucket)
    //      out = product + (afternoon ? bucket : 0);  balance = in - out
    for (const shift of ['morning', 'afternoon'] as const) {
      const t = sievingTotals(sievingData, { shift })
      const bucket = 200, debag = 1500, machine = 50, product = 1500
      const oldIn  = debag + machine + (shift === 'afternoon' ? 0 : bucket)
      const oldOut = product + (shift === 'afternoon' ? bucket : 0)
      expect(t.balance).toBe(oldIn - oldOut)
    }
  })

  it('still accepts a bare shift argument, as the original signature did', () => {
    expect(sievingTotals(sievingData, 'afternoon')).toEqual(sievingTotals(sievingData, { shift: 'afternoon' }))
  })
})

describe('half-bag top-ups count once, on the output side', () => {
  it('adds the increment to output for every section', () => {
    const base = productionTotals('sieving', sievingData, { shift: 'afternoon' })
    const withTopUp = productionTotals('sieving', sievingData, { shift: 'afternoon', topUpKg: 40 })
    expect(withTopUp.totalOut).toBe(base.totalOut + 40)
    expect(withTopUp.balance).toBe(base.balance - 40)
  })

  it('is NOT double-counted through the section formula', () => {
    // sievingTotals also accepts topUpKg; productionTotals must not let both apply.
    const viaDispatch = productionTotals('sieving', sievingData, { shift: 'afternoon', topUpKg: 40 })
    const manual = sievingTotals(sievingData, { shift: 'afternoon' })
    expect(viaDispatch.totalOut).toBe(manual.totalOut + 40)
  })

  it('applies to non-sieving sections too', () => {
    const d = { inputs: [{ weight: '100', itemKey: 'x' }], outputs: [{ weight: '90' }] }
    expect(productionTotals('blender', d, { topUpKg: 5 }).totalOut).toBe(95)
  })

  it('leaves the balance untouched when there are no top-ups', () => {
    expect(productionTotals('sieving', sievingData, { shift: 'morning', topUpKg: 0 }))
      .toEqual(productionTotals('sieving', sievingData, { shift: 'morning' }))
  })
})

describe('per-section formulas keep their own sign conventions', () => {
  it('refining: in − out', () => {
    const r = refiningTotals({
      inputs: [{ weight: '100' }],
      outputA: { bags: [{ weight: '40' }] },
      outputB: { bags: [{ weight: '30' }] },
      outputC: null, outputD: null,
    })
    expect(r.totalIn).toBe(100)
    expect(r.balance).toBe(30)
  })

  it('blender: out − in, the opposite of refining', () => {
    const b = blenderTotals({ inputs: [{ weight: '100', itemKey: 'a' }], outputs: [{ weight: '90' }] })
    expect(b.balance).toBe(-10)
    expect(b.byItem).toEqual({ a: 100 })
  })

  it('granule: H − G, with water excluded from raw material', () => {
    const g = granuleTotals({
      blends: [{ water: '50', rows: [{ dustKey: 'sg', weight: '600' }, { dustKey: 'sf', weight: '400' }] }],
      outputs: [{ weight: '800' }], waste: [{ weight: '50' }],
      dustNotRefed: '100', coarseNotFed: '20',
    })
    expect(g.totalA).toBe(1000)   // water NOT included
    expect(g.water).toBe(50)
    expect(g.G).toBe(970)         // 800 + 100 + 20 + 50
    expect(g.balance).toBe(30)
  })

  it('pasteuriser: produced (A+B+C) − raw used (D+E), output from bag ranges', () => {
    const p = pasteuriserTotals({
      weightPerBag: '25',
      debag: [{ stream: 'main', weight: '500' }, { stream: 'postsieve', weight: '100' }],
      outputs: [{ bagCount: '20', bagWeight: '' }],   // falls back to weightPerBag
      byProducts: [{ weight: '60' }], floorWaste: '40',
    })
    expect(p.rawUsed).toBe(600)
    expect(p.A).toBe(500)
    expect(p.produced).toBe(600)
    expect(p.balance).toBe(0)
  })
})

describe('productionTotals dispatch', () => {
  it('matches what the capture page computed per section before', () => {
    const ref = { inputs: [{ weight: '100' }], outputA: { bags: [{ weight: '90' }] }, outputB: null, outputC: null, outputD: null }
    expect(productionTotals('refining', ref)).toMatchObject({ totalIn: 100, totalOut: 90 })

    const gran = { blends: [{ rows: [{ dustKey: 'a', weight: '100' }] }], outputs: [{ weight: '90' }] }
    expect(productionTotals('granule', gran)).toMatchObject({ totalIn: 100, totalOut: 90 })

    const past = { debag: [{ stream: 'main', weight: '100' }], outputs: [], byProducts: [{ weight: '90' }], floorWaste: '0' }
    expect(productionTotals('pasteuriser', past)).toMatchObject({ totalIn: 100, totalOut: 90 })
  })

  it('throws rather than silently mis-attributing an unknown kind', () => {
    expect(() => productionTotals('packaging' as never, {})).toThrow(/Unhandled section kind/)
  })
})

describe('sumProductionTotals', () => {
  it('adds every figure across productions, carry-over included', () => {
    const a = productionTotals('sieving', sievingData, { shift: 'afternoon' })
    const total = sumProductionTotals([a, a])
    expect(total.totalOut).toBe(a.totalOut * 2)
    expect(total.carryOverOut).toBe(a.carryOverOut * 2)
    expect(total.balance).toBe(a.balance * 2)
  })

  it('is zero for no productions', () => {
    expect(sumProductionTotals([])).toEqual(
      { totalIn: 0, totalOut: 0, carryOverIn: 0, carryOverOut: 0, balance: 0 })
  })
})

describe('withTopUp', () => {
  it('moves the balance DOWN for sections that read in − out', () => {
    for (const kind of ['sieving', 'refining', 'granule'] as const) {
      const t = { totalIn: 100, totalOut: 90, carryOverIn: 0, carryOverOut: 0, balance: 10 }
      expect(withTopUp(kind, t, 4)).toMatchObject({ totalOut: 94, balance: 6 })
    }
  })

  it('moves the balance UP for sections whose paper form reads out − in', () => {
    for (const kind of ['blender', 'pasteuriser'] as const) {
      const t = { totalIn: 100, totalOut: 90, carryOverIn: 0, carryOverOut: 0, balance: -10 }
      expect(withTopUp(kind, t, 4)).toMatchObject({ totalOut: 94, balance: -6 })
    }
  })

  it('is a no-op for zero, and agrees with passing topUpKg through the dispatch', () => {
    const t = productionTotals('sieving', sievingData, { shift: 'afternoon' })
    expect(withTopUp('sieving', t, 0)).toBe(t)
    expect(withTopUp('sieving', t, 40))
      .toMatchObject(productionTotals('sieving', sievingData, { shift: 'afternoon', topUpKg: 40 }))
  })
})
