import { describe, it, expect } from 'vitest'
import { round1, kgPerHour, yieldPct } from './metrics'

/**
 * CHARACTERISATION TESTS — see num.test.ts for why these exist.
 *
 * The "equivalent to the other spelling" cases below are the ones that matter:
 * they prove the two historic yield formulations really are the same before any
 * call site is switched over.
 */
describe('round1', () => {
  it('rounds to one decimal', () => {
    expect(round1(1.24)).toBe(1.2)
    expect(round1(1.25)).toBe(1.3)
    expect(round1(1000)).toBe(1000)
    expect(round1(0)).toBe(0)
  })

  it('rounds negatives the way Math.round does — .5 goes toward positive', () => {
    expect(round1(-1.24)).toBe(-1.2)
    expect(round1(-1.25)).toBe(-1.2)
  })
})

describe('kgPerHour', () => {
  it('converts kg over minutes into kg/hour', () => {
    expect(kgPerHour(100, 60)).toBe(100)
    expect(kgPerHour(100, 30)).toBe(200)
    expect(kgPerHour(450, 90)).toBe(300)
  })

  it('rounds to one decimal', () => {
    expect(kgPerHour(100, 45)).toBe(133.3)
  })

  it('returns null when there is no elapsed time — unknown is not zero', () => {
    expect(kgPerHour(100, 0)).toBeNull()
    expect(kgPerHour(100, -5)).toBeNull()
    expect(kgPerHour(0, 0)).toBeNull()
  })

  it('returns 0 for a real zero-output run that did take time', () => {
    // Distinct from the null case above: we know it ran and it produced nothing.
    expect(kgPerHour(0, 60)).toBe(0)
  })
})

describe('yieldPct', () => {
  it('expresses output as a percentage of input', () => {
    expect(yieldPct(50, 100)).toBe(50)
    expect(yieldPct(100, 100)).toBe(100)
    expect(yieldPct(950, 1000)).toBe(95)
  })

  it('rounds to one decimal', () => {
    expect(yieldPct(1, 3)).toBe(33.3)
    expect(yieldPct(2, 3)).toBe(66.7)
  })

  it('returns null when there is no input — unknown is not zero', () => {
    expect(yieldPct(100, 0)).toBeNull()
    expect(yieldPct(0, 0)).toBeNull()
    expect(yieldPct(100, -1)).toBeNull()
  })

  it('allows over-100% yield rather than clamping', () => {
    // Real and meaningful: it flags a mass-balance problem or an uncaptured
    // input. Clamping would hide exactly the case worth investigating.
    expect(yieldPct(110, 100)).toBe(110)
  })

  it('matches the other historic spelling, Math.round((out/in)*1000)/10', () => {
    const cases: Array<[number, number]> = [
      [50, 100], [1, 3], [2, 3], [950, 1000], [1234, 5678], [7, 9], [999, 1000],
    ]
    for (const [out, inp] of cases) {
      expect(yieldPct(out, inp)).toBe(Math.round((out / inp) * 1000) / 10)
    }
  })
})
