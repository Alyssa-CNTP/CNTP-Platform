// lib/core/takein/grading.test.ts
//
// Characterisation tests: they pin what the take-in rules DO, so a later
// refactor cannot silently change what a producer is paid or what a document
// prints. A failure means behaviour moved — that is the signal, not a test to
// relax (ARCHITECTURE.md §8).
//
// The sieving cases are the ten real signed Afleweringsbewyse. The leaf-shade
// map is the IL of Acumatica's MapLeafScore. Neither is invented.

import { describe, it, expect } from 'vitest'
import {
  roundHalfUp, shadeScore, LEAF_SHADE_SCORE, sieveTable,
  grossKg, weighbridgeReversed, nettKg,
  compareLabs, panelTriggers, prelimPanel, panelBinding, stageOf, isFinalised,

} from './grading'

// ── the ten signed documents: gram counts out of a 400 g sample, and the
//    total the paper actually prints ─────────────────────────────────────────
const DOCS: [string, number[], number][] = [
  ['GS-0293',  [18, 27, 114, 54, 154, 33], 82.01],
  ['GS-0296',  [40, 46, 145, 50, 101, 18], 75.84],
  ['GS-0396',  [21, 26, 115, 55, 155, 28], 82.51],
  ['GS-0402',  [21, 31, 124, 51, 143, 30], 80.94],
  ['GS-0410',  [30, 40, 130, 50, 126, 24], 78.30],
  ['MAT-0271', [13, 24, 138, 70, 139, 16], 86.21],
  ['MAT-0295', [29, 38, 136, 56, 119, 22], 79.13],
  ['MAT-0303', [19, 31, 139, 55, 126, 30], 80.98],
  ['MAT-0339', [20, 29, 122, 51, 147, 31], 81.39],
  ['MAT-0368', [12, 25, 132, 67, 136, 28], 84.12],
]
const KEYS = ['>10', '>12', '>18', '>20', '>40', '<40']
const sample = (g: number[]) => Object.fromEntries(KEYS.map((k, i) => [k, g[i]]))

describe('roundHalfUp', () => {
  it('rounds half away from zero, not to even', () => {
    expect(roundHalfUp(1.305, 2)).toBe(1.31)
    expect(roundHalfUp(2.5)).toBe(3)
    expect(roundHalfUp(3.5)).toBe(4)      // banker's would give 4 and 4 — this is the tie that differs
    expect(roundHalfUp(0.125, 2)).toBe(0.13)
  })
  it('is symmetric about zero', () => {
    expect(roundHalfUp(-2.5)).toBe(-3)
    expect(roundHalfUp(-1.305, 2)).toBe(-1.31)
  })
  it('kills binary drift before cutting', () => {
    // 0.18 × 7.25 is exactly 1.305 in decimal but 1.30499999999999994 in binary.
    // Without the toFixed guard this rounds DOWN and MAT-0295 lands a cent light.
    expect(roundHalfUp(0.18 * 7.25, 2)).toBe(1.31)
  })
})

describe('sieveTable — the ten signed Afleweringsbewyse', () => {
  for (const [lot, grams, printed] of DOCS) {
    it(`${lot} totals ${printed} %`, () => {
      expect(sieveTable(sample(grams)).contribTotal).toBe(printed)
    })
  }

  it('sums the ROUNDED rows, which is not the same as rounding the sum once', () => {
    // GS-0402 is the cleanest proof: rows sum to 80.94 as printed, but the exact
    // figure is 80.925, which rounds once to 80.93.
    const t = sieveTable(sample(DOCS.find(d => d[0] === 'GS-0402')![1]))
    expect(t.contribTotal).toBe(80.94)
    expect(t.contribOnce).toBe(80.93)
  })

  it('only accepts a 400 g sample, ±1 g', () => {
    expect(sieveTable(sample([18, 27, 114, 54, 154, 33])).complete).toBe(true)
    expect(sieveTable(sample([18, 27, 114, 54, 154, 10])).complete).toBe(false)
  })

  it('does not divide by zero on an empty sample', () => {
    const t = sieveTable(null)
    expect(t.contribTotal).toBe(0)
    expect(t.complete).toBe(false)
  })
})

describe('leaf shade → score', () => {
  it('matches MapLeafScore exactly', () => {
    expect(LEAF_SHADE_SCORE).toEqual(
      { 1: null, 2: 1, 3: 2, 4: 3, 5: 4, 6: 4, 7: 5, 8: 5, 9: 4, 10: 3, 11: 2 })
  })
  it('shade 1 carries NO score, which is not the same as zero', () => {
    expect(shadeScore(1)).toBeNull()
    expect(shadeScore(1)).not.toBe(0)
  })
  it('scores run 1–5 and peak at 7–8', () => {
    const scored = Object.values(LEAF_SHADE_SCORE).filter((v): v is number => v != null)
    expect(Math.min(...scored)).toBe(1)
    expect(Math.max(...scored)).toBe(5)
    expect(shadeScore(7)).toBe(5)
    expect(shadeScore(8)).toBe(5)
  })
  it('every shade on the signed notes maps as printed', () => {
    // Telling → Finale Telling, off the ten documents
    expect(shadeScore(4)).toBe(3); expect(shadeScore(5)).toBe(4)
    expect(shadeScore(6)).toBe(4); expect(shadeScore(7)).toBe(5)
    expect(shadeScore(8)).toBe(5)
  })
  it('an unmapped shade carries no score rather than defaulting to zero', () => {
    expect(shadeScore(12)).toBeNull()
    expect(shadeScore(0)).toBeNull()
  })
})

describe('weighbridge', () => {
  it('gross is begin − end, because the truck arrives loaded', () => {
    expect(grossKg(19280, 14200)).toBe(5080)
  })
  it('flags a reversed pair instead of returning a negative', () => {
    expect(weighbridgeReversed(14200, 19280)).toBe(true)
    expect(weighbridgeReversed(19280, 14200)).toBe(false)
    expect(grossKg(14200, 19280)).toBe(0)
  })
  it('nett takes the bag tare off', () => {
    expect(nettKg(19280, 14200, 16)).toBe(5048)   // GS-0293 as printed
  })
})

describe('compareLabs', () => {
  const mini = { shade: 8, aroma: 3, colour: 4, taste: 3 }
  it('identical readings agree', () => {
    const c = compareLabs(mini, { ...mini })
    expect(c.identical).toBe(true); expect(c.within).toBe(true); expect(c.worst).toBe(0)
  })
  it('a one-point drift is a VARIANCE, not agreement', () => {
    const c = compareLabs(mini, { ...mini, shade: 7 })
    expect(c.identical).toBe(false)   // it does NOT claim they agree
    expect(c.within).toBe(true)       // but it is inside tolerance
    expect(c.diffs).toHaveLength(1)
    expect(c.diffs[0].label).toBe('Leaf Shade')
  })
  it('a wider gap is a real disagreement', () => {
    const c = compareLabs(mini, { shade: 2, aroma: 1, colour: 4, taste: 3 })
    expect(c.within).toBe(false)
    expect(c.worst).toBe(6)
    expect(c.diffs).toHaveLength(2)
  })
})

// ── grading fixtures ────────────────────────────────────────────────────────
const goodMini = {
  sieve_json: sample([18, 27, 114, 54, 154, 33]),
  moisture: 4.8, density: 320, shade: 8, aroma: 3, colour: 4, taste: 3,
}
const allBinding = { density: true, sensory: true, organic_residue: true,
                     pa4: true, organic_pa23: true, lab_variance: false }

describe('panelTriggers', () => {
  it('a high density is knowable AT THE MINI LAB, without the residue result', () => {
    const t = panelTriggers({ mini: { ...goodMini, density: 405 }, internal: null,
                              external: null, organic: false, binding: allBinding })
    expect(t).toHaveLength(1)
    expect(t[0].when).toBe('mini')
    expect(t[0].term).toBe('density')
  })
  it('an unscoreable leaf shade raises its own trigger', () => {
    const t = panelTriggers({ mini: { ...goodMini, shade: 1 }, internal: null,
                              external: null, organic: false, binding: allBinding })
    expect(t.some(x => /no score/.test(x.why))).toBe(true)
  })
  it('the CONTRACT decides whether a finding binds the producer', () => {
    const input = { mini: { ...goodMini, density: 405 }, internal: null,
                    external: null, organic: false }
    const bound   = panelTriggers({ ...input, binding: allBinding })
    const inhouse = panelTriggers({ ...input, binding: { ...allBinding, density: false } })
    expect(bound[0].binding).toBe(true)
    expect(inhouse[0].binding).toBe(false)
    // same numbers, different contract → a different answer on the document
    expect(prelimPanel({ ...input, binding: allBinding })).toBe(true)
    expect(prelimPanel({ ...input, binding: { ...allBinding, density: false } })).toBe(false)
  })
  it('an in-house-only finding never reaches the producer document', () => {
    const i = { mini: { ...goodMini, density: 405 }, internal: null, external: null,
                organic: false, binding: { ...allBinding, density: false } }
    expect(panelTriggers(i)).toHaveLength(1)   // the panel still sits
    expect(panelBinding(i)).toBe(false)        // the document still prints Nee
  })
  it('organic residue only fires for an organic contract', () => {
    const ext = { residue_group: 'R-1', pa_group: 'P1' }
    const conv = panelTriggers({ mini: goodMini, internal: goodMini, external: ext,
                                 organic: false, binding: allBinding })
    const org  = panelTriggers({ mini: goodMini, internal: goodMini, external: ext,
                                 organic: true,  binding: allBinding })
    expect(conv).toHaveLength(0)
    expect(org.some(t => t.term === 'organic_residue')).toBe(true)
  })
})

describe('stageOf', () => {
  const base = { organic: false, binding: allBinding } as const

  it('walks the pipeline in order', () => {
    expect(stageOf({ ...base, mini: null, internal: null, external: null }).stage)
      .toBe('awaiting_mini')
    expect(stageOf({ ...base, mini: goodMini, internal: null, external: null }).stage)
      .toBe('awaiting_internal')
    expect(stageOf({ ...base, mini: goodMini, internal: { ...goodMini, agrees: true }, external: null }).stage)
      .toBe('awaiting_external')
  })

  it('an incomplete sieve sample holds it at the mini lab', () => {
    const r = stageOf({ ...base, mini: { ...goodMini, sieve_json: sample([1,1,1,1,1,1]) },
                        internal: null, external: null })
    expect(r.stage).toBe('awaiting_mini')
    expect(r.reasons[0]).toMatch(/399–401/)
  })

  it('moisture at 10 % rejects outright', () => {
    expect(stageOf({ ...base, mini: { ...goodMini, moisture: 10 }, internal: null, external: null }).stage)
      .toBe('rejected')
  })

  it('grades A when every threshold is met', () => {
    const r = stageOf({ ...base, mini: goodMini, internal: { ...goodMini, agrees: true },
                        external: { residue_group: 'R-1', pa_group: 'P1' } })
    expect(r.stage).toBe('approved'); expect(r.grade).toBe('A')
  })

  it('drops to C on a residue that bars export', () => {
    const r = stageOf({ ...base, mini: goodMini, internal: { ...goodMini, agrees: true },
                        external: { residue_group: 'R-3', pa_group: 'P1' } })
    expect(r.stage).toBe('approved'); expect(r.grade).toBe('C')
    expect(r.reasons[0]).toMatch(/domestic only/)
  })

  // ── the three bugs the review found ───────────────────────────────────────
  it('a lab disagreement CAN be cleared by the panel (was a dead end)', () => {
    const disputed = { ...base, mini: goodMini,
                       internal: { ...goodMini, shade: 2, agrees: false }, external: null }
    expect(stageOf(disputed).stage).toBe('panel')
    const decided = stageOf({ ...disputed,
      panel: { outcome: 'accept' as const, grade: 'C', reason: 'Panel re-tasted',
               covered: panelTriggers(disputed).map(t => t.why) } })
    expect(decided.stage).toBe('approved')
  })

  it('a banned residue outranks a panel approval', () => {
    const r = stageOf({ ...base, mini: goodMini, internal: { ...goodMini, agrees: true },
      external: { residue_group: 'R-Banned', pa_group: 'P1' },
      panel: { outcome: 'accept' as const, grade: 'A', reason: 'approved earlier', covered: [] } })
    expect(r.stage).toBe('rejected')
    expect(r.reasons[0]).toMatch(/Banned residue/)
  })

  it('a finding that lands AFTER the decision reopens the panel', () => {
    const before = { ...base, mini: goodMini, internal: { ...goodMini, agrees: true }, external: null }
    const decided = { outcome: 'accept' as const, grade: 'A', reason: 'ok',
                      covered: panelTriggers(before).map(t => t.why) }
    const after = stageOf({ ...before, external: { residue_group: 'R-1', pa_group: 'P4' },
                            panel: decided })
    expect(after.stage).toBe('panel')
    expect(after.reopened).toBe(true)
    expect(after.reasons.join(' ')).toMatch(/P4/)
  })

  it('a returned load leaves the pipeline entirely', () => {
    expect(stageOf({ ...base, mini: goodMini, internal: null, external: null, returned: true }).stage)
      .toBe('returned')
  })
})

describe('isFinalised', () => {
  it('is true only when nothing is left for anyone to do', () => {
    expect(isFinalised('approved', false)).toBe(false)   // COA still to issue
    expect(isFinalised('approved', true)).toBe(true)
    expect(isFinalised('rejected', false)).toBe(true)
    expect(isFinalised('returned', false)).toBe(true)
    expect(isFinalised('awaiting_external', false)).toBe(false)
  })
})
