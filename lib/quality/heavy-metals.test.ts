import { describe, it, expect } from 'vitest'
import {
  HEAVY_METALS, HEAVY_METAL_KEYS, heavyMetalLabel,
  specFieldRequired, wantsHeavyMetals, heavyMetalSpecParts,
} from './heavy-metals'

describe('HEAVY_METALS', () => {
  it('carries chromium alongside the original four plus copper', () => {
    expect(HEAVY_METAL_KEYS).toEqual(['lead', 'cadmium', 'mercury', 'arsenic', 'chromium', 'copper'])
  })
  it('keeps every key distinct and labelled', () => {
    expect(new Set(HEAVY_METAL_KEYS).size).toBe(HEAVY_METALS.length)
    HEAVY_METALS.forEach(m => expect(m.label.length).toBeGreaterThan(0))
  })
})

describe('heavyMetalLabel', () => {
  it('labels the known metals', () => {
    expect(heavyMetalLabel('chromium')).toBe('Chromium')
    expect(heavyMetalLabel('lead')).toBe('Lead')
  })
  it('capitalises anything it does not know rather than returning blank', () => {
    expect(heavyMetalLabel('nickel')).toBe('Nickel')
    expect(heavyMetalLabel('')).toBe('')
  })
})

describe('specFieldRequired', () => {
  it('accepts a real limit', () => {
    expect(specFieldRequired('<3.0')).toBe(true)
    expect(specFieldRequired(0.02)).toBe(true)
  })
  it('rejects blank and null', () => {
    for (const v of [null, undefined, '', '   ']) expect(specFieldRequired(v)).toBe(false)
  })
  it("rejects the sheet's 'NOT REQUIRED' in any casing or padding", () => {
    for (const v of ['NOT REQUIRED', 'not required', '  Not Required  ']) {
      expect(specFieldRequired(v)).toBe(false)
    }
  })
  it('does not reject a value that merely contains the words', () => {
    expect(specFieldRequired('NOT REQUIRED BY CUSTOMER, use <1.0')).toBe(true)
  })
  it('treats 0 as a real limit, not as absent', () => {
    // A hard zero is a legitimate spec ("none detected") and must not be
    // dropped by a truthiness test.
    expect(specFieldRequired(0)).toBe(true)
    expect(specFieldRequired('0')).toBe(true)
  })
})

describe('wantsHeavyMetals', () => {
  it('is true when any single metal has a limit', () => {
    expect(wantsHeavyMetals({ chromium: '<1.0' })).toBe(true)
    expect(wantsHeavyMetals({ lead: '<3.0' })).toBe(true)
  })
  it('is false for a spec that lists the metals as NOT REQUIRED', () => {
    // This is the CoaSpecsTab badge fix: the old plain-truthiness test lit the
    // "Metals" badge for exactly this spec.
    expect(wantsHeavyMetals({ lead: 'NOT REQUIRED', cadmium: 'NOT REQUIRED', chromium: '' })).toBe(false)
  })
  it('ignores non-metal contaminants', () => {
    expect(wantsHeavyMetals({ pyrrolizidine_alkaloids: '<50 μg', glyphosate: 'None Detected' })).toBe(false)
  })
  it('handles a missing contaminants block', () => {
    expect(wantsHeavyMetals(null)).toBe(false)
    expect(wantsHeavyMetals(undefined)).toBe(false)
    expect(wantsHeavyMetals({})).toBe(false)
  })
})

describe('heavyMetalSpecParts', () => {
  it('renders only the required metals, in COA order', () => {
    expect(heavyMetalSpecParts({
      copper: '<10', chromium: '<1.0', lead: '<3.0', cadmium: 'NOT REQUIRED',
    })).toEqual(['Lead <3.0', 'Chromium <1.0', 'Copper <10'])
  })
  it('trims the stored value', () => {
    expect(heavyMetalSpecParts({ chromium: '  <1.0  ' })).toEqual(['Chromium <1.0'])
  })
  it('returns nothing when no metal is required', () => {
    expect(heavyMetalSpecParts({ lead: 'NOT REQUIRED' })).toEqual([])
    expect(heavyMetalSpecParts(null)).toEqual([])
  })
})
