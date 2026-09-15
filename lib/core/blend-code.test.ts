import { describe, it, expect } from 'vitest'
import { parseBlendCode, blendDisplayName, blenderProductType, BLEND_TYPES } from './blend-code'

// Every code below is real — taken from production.bom_components for the two
// blender work centres. A pattern invented for a test would prove nothing
// about strings that get printed onto bags.

describe('parseBlendCode', () => {
  it('reads the floor name off a packed code', () => {
    const p = parseBlendCode('25SFCKUN25C')
    expect(p.type).toBe('SFC')
    expect(p.qualifier).toBe('KUN25')
    expect(p.variantSuffix).toBe('C')
    expect(p.display).toBe('SFC-KUN25')
    expect(p.configured).toBe(true)
  })

  it('keeps digits welded to the type as part of the type', () => {
    // SFC30 and SFC100 are different blends, not SFC made for customers "30"
    // and "100" — so the number goes left of the hyphen.
    expect(blendDisplayName('25SFC30KUN25C')).toBe('SFC30-KUN25')
    expect(blendDisplayName('25SG14F57C29WBC')).toBe('SG14-F57C29WB')
  })

  it('strips the two-letter variant suffixes before the one-letter ones', () => {
    // 'RO' must beat 'O', or an RA-Organic blend reads as an organic one
    // called KUN23R.
    expect(parseBlendCode('25SFCKUN23RO').variantSuffix).toBe('RO')
    expect(blendDisplayName('25SFCKUN23RO')).toBe('SFC-KUN23')
    expect(blendDisplayName('25SFCKUN23O')).toBe('SFC-KUN23')
    expect(blendDisplayName('25SFCKUN25C')).toBe('SFC-KUN25')
  })

  it('tests SFC before SC and SE', () => {
    // Order dependence is the one way this parser can silently produce a
    // plausible wrong answer, so it is pinned.
    expect(parseBlendCode('25SFC100FAO').type).toBe('SFC100')
    expect(parseBlendCode('25SC10F70C20WBC').type).toBe('SC10')
    expect(parseBlendCode('25SE40F60CBO').type).toBe('SE40')
  })

  it('keeps a run suffix that is part of the blend, not the variant', () => {
    // 25SGNAT26C and 25SGNAT26C-1 are two different BOMs. Collapsing them
    // would merge two blends' bags under one name.
    expect(blendDisplayName('25SGNAT26C')).toBe('SG-NAT26')
    expect(blendDisplayName('25SGNAT26C-1')).toBe('SG-NAT26-1')
  })

  it('never eats the whole qualifier to find a variant', () => {
    expect(blendDisplayName('25SGJOECC')).toBe('SG-JOEC')
    expect(blendDisplayName('25SGJOEFC')).toBe('SG-JOEF')
  })

  it('leaves a code with no packed format completely alone', () => {
    // CL-100C-A-O has no range prefix. Chopping it would invent a name.
    const p = parseBlendCode('CL-100C-A-O')
    expect(p.configured).toBe(false)
    expect(p.display).toBe('CL-100C-A-O')
    expect(p.type).toBeNull()
  })

  it('reports an unconfigured blend type rather than guessing a split', () => {
    // 'XX' is not in BLEND_TYPES. There is no way to know where the type ends,
    // so the code comes back whole and flagged — the same contract
    // resolveTypeCode has for serial type codes.
    const p = parseBlendCode('25XXKUN25C')
    expect(p.configured).toBe(false)
    expect(p.display).toBe('25XXKUN25C')
    expect(p.type).toBeNull()
  })

  it('handles the BL infix some codes carry', () => {
    expect(blendDisplayName('25BLSFCKUN25C')).toBe('SFC-KUN25')
  })

  it('survives empty, null and whitespace without throwing', () => {
    for (const v of [null, undefined, '', '   ']) {
      const p = parseBlendCode(v as any)
      expect(p.configured).toBe(false)
      expect(p.display).toBe('')
    }
  })

  it('is case-insensitive on the type and variant', () => {
    expect(blendDisplayName('25sfckun25c')).toBe('SFC-KUN25')
  })
})

describe('blenderProductType', () => {
  it('names the bag by its blend', () => {
    expect(blenderProductType('25SFCKUN25C')).toBe('SFC-KUN25')
  })

  it('falls back to a real label when there is no blend at all', () => {
    // A blend must be picked before a bag can be added, but the fallback has
    // to be a readable product rather than an empty string — an unnamed bag
    // in Bag Tracking is worse than a vague one.
    expect(blenderProductType('')).toBe('Blended Batch')
    expect(blenderProductType(null)).toBe('Blended Batch')
  })

  it('passes an unconfigured code straight through', () => {
    expect(blenderProductType('CL-100C-A-O')).toBe('CL-100C-A-O')
  })
})

describe('BLEND_TYPES', () => {
  it('has no type that is a prefix of another without being longer-first safe', () => {
    // The parser sorts by length, so this is really a guard on the list
    // staying free of exact duplicates.
    expect(new Set(BLEND_TYPES).size).toBe(BLEND_TYPES.length)
  })
})
