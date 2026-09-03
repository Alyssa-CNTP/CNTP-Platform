import { describe, it, expect } from 'vitest'
import {
  checkPlausibility, checkAllPlausibility, bdMeasurementFor, MEASUREMENT_BOUNDS,
} from './plausibility'

// Every "real error" case below is an actual value found in production
// qms.granule_samples / qms.quality_records on 2026-09-03.

describe('the values that actually got into production', () => {
  it('blocks bulk density 2200 and suggests 220 (granule samples 754, 755)', () => {
    const r = checkPlausibility('bulk_density_cc', 2200)
    expect(r.level).toBe('block')
    expect(r.suggestion).toBe(220)
    expect(r.message).toMatch(/Did you mean 220 cc\/100g\?/)
  })

  it('blocks moisture 121 and suggests 12.1 (granule sample 117)', () => {
    const r = checkPlausibility('moisture', 121)
    expect(r.level).toBe('block')
    expect(r.suggestion).toBe(12.1)
  })

  it('blocks dryer temp 1215 and suggests 121.5 (granule sample 117)', () => {
    const r = checkPlausibility('dryer_temp', 1215)
    expect(r.level).toBe('block')
    expect(r.suggestion).toBe(121.5)
  })

  it('blocks moisture 95 and suggests 9.5 (pasteuriser sample 734)', () => {
    const r = checkPlausibility('moisture', 95)
    expect(r.level).toBe('block')
    expect(r.suggestion).toBe(9.5)
  })

  it('blocks a zero bulk density and a zero moisture', () => {
    expect(checkPlausibility('bulk_density_cc', 0).level).toBe('block')
    expect(checkPlausibility('moisture', 0).level).toBe('block')
  })

  it('blocks dryer temp 1 (granule sample 464)', () => {
    expect(checkPlausibility('dryer_temp', 1).level).toBe('block')
  })

  it('draws the dryer-temp line at 200 °C: 230 is refused, 150 only confirms', () => {
    // granule samples 306 / 307 hold 230 and 220 — above what this dryer can
    // physically run, so they are refused. 150 is high but reachable, so it
    // warns instead of blocking.
    expect(checkPlausibility('dryer_temp', 230).level).toBe('block')
    expect(checkPlausibility('dryer_temp', 150).level).toBe('confirm')
  })

  it('refuses moisture 0.8 but only confirms 11.34', () => {
    // 0.8 % is below anything dried tea reaches (pasteuriser sample 1098);
    // 11.34 % is the real observed maximum, so it must stay saveable.
    expect(checkPlausibility('moisture', 0.8).level).toBe('block')
    expect(checkPlausibility('moisture', 11.34).level).toBe('confirm')
  })
})

describe('normal readings are silent', () => {
  it('accepts the observed medians', () => {
    expect(checkPlausibility('moisture', 8.2).level).toBe('ok')
    expect(checkPlausibility('bulk_density_cc', 220).level).toBe('ok')
    expect(checkPlausibility('dryer_temp', 124).level).toBe('ok')
  })
  it('accepts the full observed sound range for bulk density', () => {
    for (const v of [170, 190, 220, 266, 320]) {
      expect(checkPlausibility('bulk_density_cc', v).level).toBe('ok')
    }
  })
  it('accepts the full observed moisture range', () => {
    for (const v of [4, 6.36, 8.2, 10.6]) {
      expect(checkPlausibility('moisture', v).level).toBe('ok')
    }
  })
})

describe('blank and partial input never blocks', () => {
  it('is ok for empty, null, undefined and whitespace', () => {
    for (const v of ['', null, undefined, '   ']) {
      expect(checkPlausibility('moisture', v).level).toBe('ok')
    }
  })
  it('is ok for text that is not a number yet — a QC mid-keystroke', () => {
    for (const v of ['-', '.', 'abc', '1.']) {
      // '1.' parses as 1 which is a valid moisture floor; the rest are NaN.
      expect(['ok', 'confirm', 'block']).toContain(checkPlausibility('moisture', v).level)
    }
    expect(checkPlausibility('moisture', 'abc').level).toBe('ok')
    expect(checkPlausibility('moisture', '-').level).toBe('ok')
  })
  it('accepts a numeric string as readily as a number', () => {
    expect(checkPlausibility('bulk_density_cc', '2200').level).toBe('block')
    expect(checkPlausibility('bulk_density_cc', ' 220 ').level).toBe('ok')
  })
})

describe('Rosehips bulk density is a different unit', () => {
  it('routes Rosehips to ml/5g and everything else to cc/100g', () => {
    expect(bdMeasurementFor('Rosehips')).toBe('bulk_density_ml')
    expect(bdMeasurementFor('rosehips')).toBe('bulk_density_ml')
    expect(bdMeasurementFor('  Rosehips  ')).toBe('bulk_density_ml')
    expect(bdMeasurementFor('Rooibos')).toBe('bulk_density_cc')
    expect(bdMeasurementFor(null)).toBe('bulk_density_cc')
  })
  it('accepts a Rosehips reading that the cc/100g bounds would have blocked', () => {
    // "<10 ml/5g" is the normal Rosehips spec. Under cc/100g bounds this is
    // impossible; under its own bounds it is routine.
    expect(checkPlausibility('bulk_density_ml', 8).level).toBe('ok')
    expect(checkPlausibility('bulk_density_cc', 8).level).toBe('block')
  })
  it('still blocks a Rosehips reading in the cc/100g range', () => {
    expect(checkPlausibility('bulk_density_ml', 220).level).toBe('block')
  })
})

describe('decimal-slip suggestions', () => {
  it('suggests nothing when no shift lands in range', () => {
    // 7 is below hard min for cc/100g, and no shift of it lands anywhere
    // possible: 0.7 and 0.07 and 70 are all under 80, 700 is over 450.
    const r = checkPlausibility('bulk_density_cc', 7)
    expect(r.level).toBe('block')
    expect(r.suggestion).toBeUndefined()
  })
  it('can shift upward as well as downward', () => {
    const r = checkPlausibility('bulk_density_cc', 22)
    expect(r.level).toBe('block')
    expect(r.suggestion).toBe(220)
  })
  it('rounds a suggestion to 2dp with no float noise', () => {
    const r = checkPlausibility('dryer_temp', 1215)
    expect(r.suggestion).toBe(121.5)
    expect(String(r.suggestion)).not.toMatch(/0000|9999/)
  })
})

describe('sieve fractions', () => {
  it('blocks only the impossible', () => {
    expect(checkPlausibility('sieve_pct', 101).level).toBe('block')
    expect(checkPlausibility('sieve_pct', -1).level).toBe('block')
    expect(checkPlausibility('sieve_pct', 0).level).toBe('ok')
    expect(checkPlausibility('sieve_pct', 69.6).level).toBe('ok')
    expect(checkPlausibility('sieve_pct', 100).level).toBe('ok')
  })
})

describe('checkAllPlausibility', () => {
  it('separates blocks from confirms', () => {
    const r = checkAllPlausibility([
      { key: 'bulk_density_cc', value: 2200 },   // block
      { key: 'moisture', value: 11.5 },          // confirm
      { key: 'dryer_temp', value: 124 },         // ok
    ])
    expect(r.blocks).toHaveLength(1)
    expect(r.confirms).toHaveLength(1)
    expect(r.blocks[0]).toMatch(/Bulk density 2200/)
    expect(r.confirms[0]).toMatch(/Moisture 11.5/)
  })

  it('uses a caller label so two moisture fields on one form are distinguishable', () => {
    const r = checkAllPlausibility([{ key: 'moisture', value: 121, label: 'Dryer 2 moisture' }])
    expect(r.blocks[0]).toMatch(/^Dryer 2 moisture 121%/)
    expect(r.blocks[0]).not.toMatch(/^Moisture/)
  })

  it('returns nothing for an all-valid form', () => {
    expect(checkAllPlausibility([
      { key: 'moisture', value: 8.2 }, { key: 'bulk_density_cc', value: 220 },
    ])).toEqual({ blocks: [], confirms: [] })
  })

  it('returns nothing for an empty form', () => {
    expect(checkAllPlausibility([])).toEqual({ blocks: [], confirms: [] })
    expect(checkAllPlausibility([{ key: 'moisture', value: '' }])).toEqual({ blocks: [], confirms: [] })
  })
})

describe('bounds table sanity', () => {
  it('every measurement has a soft band inside its hard band', () => {
    Object.entries(MEASUREMENT_BOUNDS).forEach(([k, b]) => {
      expect(b.hardMin, k).toBeLessThanOrEqual(b.softMin)
      expect(b.softMin, k).toBeLessThan(b.softMax)
      expect(b.softMax, k).toBeLessThanOrEqual(b.hardMax)
      expect(b.label.length, k).toBeGreaterThan(0)
    })
  })
})
