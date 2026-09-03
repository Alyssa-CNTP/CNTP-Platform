import { describe, it, expect } from 'vitest'
import {
  VARIANTS,
  normaliseVariant,
  variantFamily,
  isOrganicVariant,
  sameVariantFamily,
  mayPoolMaterial,
  variantForDb,
  variantSuffix,
  type Variant,
} from './variants'

/**
 * These are not characterisation tests. Three of the four copies this module
 * replaces were wrong, so pinning "what the code does today" would pin the
 * defect. They assert the rule instead.
 */

describe('normaliseVariant accepts every spelling the app produces', () => {
  const cases: [string, Variant][] = [
    // canonical
    ['Conventional', 'Conventional'],
    ['Organic', 'Organic'],
    ['RA-Conventional', 'RA-Conventional'],
    ['RA-Organic', 'RA-Organic'],
    ['FT-CON', 'FT-CON'],
    ['FT-ORG', 'FT-ORG'],
    // short codes the capture forms send
    ['CON', 'Conventional'],
    ['ORG', 'Organic'],
    ['RA-CON', 'RA-Conventional'],
    ['RA-ORG', 'RA-Organic'],
    ['FT CON', 'FT-CON'],
    ['FT ORG', 'FT-ORG'],
    // inventory id suffixes
    ['C', 'Conventional'],
    ['O', 'Organic'],
    ['RC', 'RA-Conventional'],
    ['RO', 'RA-Organic'],
    ['FC', 'FT-CON'],
    ['FO', 'FT-ORG'],
    // legacy / spelled out
    ['RA Conventional', 'RA-Conventional'],
    ['FT-Conventional', 'FT-CON'],
    ['FT-Organic', 'FT-ORG'],
    ['Fairtrade Organic', 'FT-ORG'],
  ]

  it.each(cases)('%s -> %s', (input, expected) => {
    expect(normaliseVariant(input)).toBe(expected)
  })

  it('is case- and whitespace-insensitive', () => {
    expect(normaliseVariant('  organic ')).toBe('Organic')
    expect(normaliseVariant('ft-org')).toBe('FT-ORG')
    expect(normaliseVariant('RA-oRgAnIc')).toBe('RA-Organic')
  })

  it('returns null rather than guessing', () => {
    for (const junk of ['', '   ', 'Rooibos', 'Green', 'ORGANIQUE', 'X', null, undefined]) {
      expect(normaliseVariant(junk)).toBeNull()
    }
  })
})

describe('FC is Fairtrade CONVENTIONAL', () => {
  /**
   * lib/constants/manufacturing.ts mapped 'FC' -> 'FT-ORG'. Every other map in
   * the repo — bom.ts, blends/page.tsx, acumatica-standards.ts,
   * features/acumatica-items — reads -FC as Fairtrade Conventional, and
   * 05RMDE-FC is a real Acumatica item called "Raw Material Dry: Export
   * Fairtrade Conventional".
   *
   * That single wrong entry moved conventional material into the organic pool,
   * which is the more dangerous direction: organic is the certified claim.
   */
  it('does not put Fairtrade Conventional in the organic pool', () => {
    expect(normaliseVariant('FC')).toBe('FT-CON')
    expect(variantFamily('FC')).toBe('conventional')
    expect(isOrganicVariant('FC')).toBe(false)
  })

  it('round-trips through the suffix', () => {
    expect(variantSuffix('FT-CON')).toBe('FC')
    expect(variantSuffix('FT-ORG')).toBe('FO')
    expect(normaliseVariant(variantSuffix('FT-CON'))).toBe('FT-CON')
  })

  it('gives every canonical variant a distinct suffix that round-trips', () => {
    const suffixes = VARIANTS.map(v => variantSuffix(v))
    expect(new Set(suffixes).size).toBe(VARIANTS.length)
    for (const v of VARIANTS) expect(normaliseVariant(variantSuffix(v))).toBe(v)
  })
})

describe('variantFamily — the segregation rule', () => {
  it('puts RA and Fairtrade with their own family, not in a third one', () => {
    expect(VARIANTS.map(v => variantFamily(v))).toEqual([
      'conventional', 'organic', 'conventional', 'organic', 'conventional', 'organic',
    ])
  })

  it('classifies Fairtrade Organic as organic despite not containing "Organic"', () => {
    expect(variantFamily('FT-ORG')).toBe('organic')
    expect(isOrganicVariant('FT-ORG')).toBe(true)
  })

  it('fails CLOSED — an unknown variant is null, never conventional', () => {
    // The bucket-elevator copy returned 'conventional' here, which is how
    // unrecognised organic material would have entered the conventional pool.
    for (const junk of ['Rooibos', 'typo', '', null, undefined]) {
      expect(variantFamily(junk)).toBeNull()
    }
  })

  it('agrees with itself on every spelling of the same variant', () => {
    expect(['Organic', 'ORG', 'O', 'organic'].map(variantFamily))
      .toEqual(['organic', 'organic', 'organic', 'organic'])
    expect(['RA-Organic', 'RA-ORG', 'RO'].map(variantFamily))
      .toEqual(['organic', 'organic', 'organic'])
    expect(['Conventional', 'CON', 'C'].map(variantFamily))
      .toEqual(['conventional', 'conventional', 'conventional'])
  })
})

describe('the five spellings that used to be misfiled', () => {
  /**
   * Each of these was reported 'conventional' by capture-config's
   * isOrganicVariant() and by the bucket-elevator ledger built on it, while
   * scan-utils reported 'organic'. They are all organic.
   */
  it.each(['ORG', 'RA-ORG', 'O', 'RO', 'FO'])('%s is organic', v => {
    expect(variantFamily(v)).toBe('organic')
    expect(isOrganicVariant(v)).toBe(true)
    expect(mayPoolMaterial(v)).toBe(false)
  })
})

describe('variantForDb — what actually lands in the column', () => {
  /**
   * prod_sessions, bag_tags, prod_debagging, prod_bagging, shift_assignments
   * and production_runs all CHECK variant IN (the six canonical words), so a
   * short code is not stored wrongly — the write is REJECTED, and the floor
   * sees "it won't save" with nothing naming the variant as the cause.
   */
  it('turns every spelling the UI can hold into the exact stored word', () => {
    expect(variantForDb('ORG')).toBe('Organic')
    expect(variantForDb('Organic')).toBe('Organic')
    expect(variantForDb('O')).toBe('Organic')
    expect(variantForDb('RA-ORG')).toBe('RA-Organic')
    expect(variantForDb('FT ORG')).toBe('FT-ORG')
    expect(variantForDb('CON')).toBe('Conventional')
  })

  it('only ever emits a value the CHECK constraint accepts', () => {
    const ALLOWED = new Set<string>(VARIANTS)
    const everySpelling = [
      'Conventional', 'CON', 'C', 'Organic', 'ORG', 'O',
      'RA-Conventional', 'RA-CON', 'RC', 'RA Conventional',
      'RA-Organic', 'RA-ORG', 'RO', 'RA Organic',
      'FT-CON', 'FT CON', 'FC', 'FT-Conventional', 'Fairtrade Conventional',
      'FT-ORG', 'FT ORG', 'FO', 'FT-Organic', 'Fairtrade Organic',
      'Rooibos', 'typo', '', '   ', null, undefined,
    ]
    for (const v of everySpelling) {
      const out = variantForDb(v)
      expect(out === null || ALLOWED.has(out)).toBe(true)
    }
  })

  it('is null, not the raw string, for anything unrecognised', () => {
    // A null loses one field. Passing the raw value through fails the CHECK and
    // loses the whole row, which is what "it won't save" looks like on a tablet.
    expect(variantForDb('Rooibos')).toBeNull()
    expect(variantForDb('')).toBeNull()
    expect(variantForDb(null)).toBeNull()
  })

  it('is idempotent — writing back what was read never changes it', () => {
    for (const v of VARIANTS) expect(variantForDb(variantForDb(v))).toBe(v)
  })
})

describe('sameVariantFamily', () => {
  it('lets a family blend with itself', () => {
    expect(sameVariantFamily('Conventional', 'RA-Conventional')).toBe(true)
    expect(sameVariantFamily('Organic', 'FT-ORG')).toBe(true)
    expect(sameVariantFamily('ORG', 'RA-Organic')).toBe(true)
  })

  it('refuses across families', () => {
    expect(sameVariantFamily('Organic', 'Conventional')).toBe(false)
    expect(sameVariantFamily('FT-ORG', 'FT-CON')).toBe(false)
  })

  it('refuses when either side is unknown — two unknowns are not a match', () => {
    expect(sameVariantFamily('Rooibos', 'Rooibos')).toBe(false)
    expect(sameVariantFamily(null, null)).toBe(false)
    expect(sameVariantFamily('Organic', null)).toBe(false)
    expect(sameVariantFamily(null, 'Organic')).toBe(false)
  })
})

describe('mayPoolMaterial — what the changeover asks', () => {
  it('allows conventional in every spelling', () => {
    for (const v of ['Conventional', 'CON', 'C', 'RA-Conventional', 'RA-CON', 'RC', 'FT-CON', 'FC']) {
      expect(mayPoolMaterial(v)).toBe(true)
    }
  })

  it('refuses organic in every spelling', () => {
    for (const v of ['Organic', 'ORG', 'O', 'RA-Organic', 'RA-ORG', 'RO', 'FT-ORG', 'FO']) {
      expect(mayPoolMaterial(v)).toBe(false)
    }
  })

  it('refuses what it cannot identify', () => {
    // Not the same question as isOrganicVariant: unknown is "not organic" but
    // is also "not safe to pool". Both must be false.
    for (const junk of ['Rooibos', '', null, undefined]) {
      expect(isOrganicVariant(junk)).toBe(false)
      expect(mayPoolMaterial(junk)).toBe(false)
    }
  })
})
