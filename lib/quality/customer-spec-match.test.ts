import { describe, it, expect } from 'vitest'
import {
  normCustomerKey, cleanCustomerName, isGenericSpec, docVersionOf,
  pickSpecForCustomer, findDuplicateSpec, customerOptions,
  resolveCustomerName, wasAliased, pickSpecForCustomerWithAliases,
} from './customer-spec-match'

// The rows below are the real shape of the duplicates found in production
// qms.customer_specs on 2026-09-03 — Entyce x3 and Edelweiss x2, carrying
// different limits. Every test that names them is guarding a live bug.

describe('normCustomerKey', () => {
  it('folds the whitespace and case that split one customer into three rows', () => {
    expect(normCustomerKey('Entyce ')).toBe('entyce')
    expect(normCustomerKey('ENTYCE ')).toBe('entyce')
    expect(normCustomerKey(' Entyce')).toBe('entyce')
    expect(normCustomerKey('Entyce')).toBe('entyce')
  })
  it('collapses internal runs of whitespace, including tabs', () => {
    expect(normCustomerKey('Afri  Tea   and\tCoffee')).toBe('afri tea and coffee')
  })
  it('treats null, undefined and blank alike', () => {
    for (const v of [null, undefined, '', '   ', '\t\n']) expect(normCustomerKey(v)).toBe('')
  })
})

describe('cleanCustomerName', () => {
  it('trims and collapses but never restyles the capitalisation', () => {
    expect(cleanCustomerName('  Entyce ')).toBe('Entyce')
    expect(cleanCustomerName('ADM WILD')).toBe('ADM WILD')          // not "Adm Wild"
    expect(cleanCustomerName('Dethlefsen  &  Balk')).toBe('Dethlefsen & Balk')
  })
  it('maps every empty form to the empty string, not null', () => {
    expect(cleanCustomerName(null)).toBe('')
    expect(cleanCustomerName('   ')).toBe('')
  })
})

describe('isGenericSpec', () => {
  it('counts null, empty and whitespace-only as generic', () => {
    expect(isGenericSpec({ customer: null })).toBe(true)
    expect(isGenericSpec({ customer: '' })).toBe(true)
    expect(isGenericSpec({ customer: '  ' })).toBe(true)
    expect(isGenericSpec({ customer: 'Entyce' })).toBe(false)
  })
})

describe('pickSpecForCustomer', () => {
  const generic = { id: 38, customer: '', bd_max: 340 }
  const entyceSpaced = { id: 33, customer: 'Entyce ', bd_max: 300 }
  const entyceUpper = { id: 46, customer: 'ENTYCE ', bd_max: 300 }
  const entyceClean = { id: 47, customer: 'Entyce', bd_max: 320 }

  it('prefers the customer row over the generic one', () => {
    const r = pickSpecForCustomer([generic, entyceClean], 'Entyce')
    expect(r.spec?.id).toBe(47)
    expect(r.via).toBe('customer')
  })

  it("matches a customer whose spec row carries stray whitespace — the old code did not", () => {
    // 'entyce ' !== 'entyce' under the previous plain toLowerCase() compare, so
    // this batch silently fell through to the generic spec.
    const r = pickSpecForCustomer([generic, entyceSpaced], 'Entyce')
    expect(r.spec?.id).toBe(33)
    expect(r.via).toBe('customer')
  })

  it('matches when the stray whitespace is on the batch instead', () => {
    expect(pickSpecForCustomer([generic, entyceClean], '  Entyce  ').spec?.id).toBe(47)
  })

  it('reports ambiguity rather than quietly taking the first of three Entyce rows', () => {
    const r = pickSpecForCustomer([entyceSpaced, entyceUpper, entyceClean], 'Entyce')
    expect(r.via).toBe('customer')
    // Listed newest-id-first, which is the deterministic tie-break order.
    expect(r.ambiguous.map(x => x.id)).toEqual([47, 46, 33])
    // The limits genuinely differ, which is why silence here was a real bug.
    expect(new Set(r.ambiguous.map(x => x.bd_max))).toEqual(new Set([300, 320]))
  })

  it('does not flag ambiguity when only one row matches', () => {
    expect(pickSpecForCustomer([generic, entyceClean], 'Entyce').ambiguous).toEqual([])
  })

  it('falls back to generic for an unknown customer, and says so', () => {
    const r = pickSpecForCustomer([generic, entyceClean], 'Someone New')
    expect(r.spec?.id).toBe(38)
    expect(r.via).toBe('generic')
  })

  it('uses the generic row when no customer is given at all', () => {
    expect(pickSpecForCustomer([generic, entyceClean], '').via).toBe('generic')
    expect(pickSpecForCustomer([generic, entyceClean], null).spec?.id).toBe(38)
  })

  it('never returns null limits when any row exists', () => {
    const r = pickSpecForCustomer([entyceClean], 'Nobody')
    expect(r.spec?.id).toBe(47)
    expect(r.via).toBe('fallback')
  })

  it('returns none for an empty or missing row set', () => {
    expect(pickSpecForCustomer([], 'Entyce')).toEqual({ spec: null, via: 'none', ambiguous: [], superseded: [] })
    expect(pickSpecForCustomer(null, 'Entyce').via).toBe('none')
  })

  it('flags two generic rows for one product as ambiguous too', () => {
    const r = pickSpecForCustomer([{ id: 1, customer: '' }, { id: 2, customer: null }], 'Nobody')
    expect(r.via).toBe('generic')
    expect(r.ambiguous.map(x => x.id)).toEqual([2, 1])
  })
})

describe('findDuplicateSpec', () => {
  const rows = [
    { id: 47, customer: 'Entyce', product_family: 'Rooibos', grade: 'Super Grade', variant: 'Conventional' },
    { id: 50, customer: 'Edelweiss', product_family: 'Botanicals', grade: 'Phytoblend', variant: 'Conventional' },
    { id: 38, customer: '', product_family: 'Rooibos', grade: 'Super Grade', variant: 'Conventional' },
  ]

  it('catches the trailing-space duplicate that created Entyce twice', () => {
    const dup = findDuplicateSpec(rows, {
      customer: 'Entyce ', product_family: 'Rooibos', grade: 'Super Grade', variant: 'Conventional',
    })
    expect(dup?.id).toBe(47)
  })

  it('catches the case-only duplicate that created Edelweiss twice', () => {
    const dup = findDuplicateSpec(rows, {
      customer: 'EDELWEISS', product_family: 'Botanicals', grade: 'Phytoblend', variant: 'Conventional',
    })
    expect(dup?.id).toBe(50)
  })

  it('normalises the product fields too — Botanicals with a trailing space is the same product', () => {
    const dup = findDuplicateSpec(rows, {
      customer: 'Edelweiss', product_family: 'Botanicals ', grade: 'Phytoblend ', variant: 'Conventional',
    })
    expect(dup?.id).toBe(50)
  })

  it('allows the same customer on a different product', () => {
    expect(findDuplicateSpec(rows, {
      customer: 'Entyce', product_family: 'Rooibos', grade: 'Long Cut', variant: 'Conventional',
    })).toBeNull()
  })

  it('allows a different customer on the same product', () => {
    expect(findDuplicateSpec(rows, {
      customer: 'Kunitaro', product_family: 'Rooibos', grade: 'Super Grade', variant: 'Conventional',
    })).toBeNull()
  })

  it('treats a second generic row for one product as a duplicate', () => {
    expect(findDuplicateSpec(rows, {
      customer: '', product_family: 'Rooibos', grade: 'Super Grade', variant: 'Conventional',
    })?.id).toBe(38)
    expect(findDuplicateSpec(rows, {
      customer: null, product_family: 'Rooibos', grade: 'Super Grade', variant: 'Conventional',
    })?.id).toBe(38)
  })

  it('lets one customer hold two specs for one product under DIFFERENT doc numbers', () => {
    // Entyce legitimately has IPS-ENT-001..007 for Rooibos / Super Grade /
    // Conventional. Refusing the second would refuse real data.
    const withDoc = [{ id: 47, customer: 'Entyce', product_family: 'Rooibos', grade: 'Super Grade', variant: 'Conventional', doc_no: 'IPS-ENT-007' }]
    expect(findDuplicateSpec(withDoc, {
      customer: 'Entyce', product_family: 'Rooibos', grade: 'Super Grade', variant: 'Conventional', doc_no: 'IPS-ENT-003',
    })).toBeNull()
    // ...but the SAME doc number twice is still a duplicate, whitespace and all.
    expect(findDuplicateSpec(withDoc, {
      customer: 'Entyce ', product_family: 'Rooibos', grade: 'Super Grade', variant: 'Conventional', doc_no: ' ips-ent-007 ',
    })?.id).toBe(47)
  })

  it('skips the row being edited, so saving a row over itself is not a duplicate', () => {
    expect(findDuplicateSpec(rows, {
      customer: 'Entyce', product_family: 'Rooibos', grade: 'Super Grade', variant: 'Conventional',
    }, 47)).toBeNull()
  })

  it('still catches a duplicate when editing a different row', () => {
    expect(findDuplicateSpec(rows, {
      customer: 'Entyce', product_family: 'Rooibos', grade: 'Super Grade', variant: 'Conventional',
    }, 99)?.id).toBe(47)
  })
})

describe('customerOptions', () => {
  it('collapses whitespace/case spellings of one customer into a single entry', () => {
    const opts = customerOptions([
      { customer: 'Entyce ' }, { customer: 'ENTYCE ' }, { customer: 'Entyce' },
    ])
    expect(opts).toEqual(['Entyce'])   // two clean 'Entyce' after trimming beats one 'ENTYCE'
  })

  it('leaves genuinely different names alone — merging those is a business decision', () => {
    const opts = customerOptions([
      { customer: 'Alveus' }, { customer: 'Alveus GmbH' },
      { customer: 'East West Tea Co.' }, { customer: 'East West Tea Company' },
    ])
    expect(opts).toEqual(['Alveus', 'Alveus GmbH', 'East West Tea Co.', 'East West Tea Company'])
  })

  it('drops generic rows — those are not customers', () => {
    expect(customerOptions([{ customer: '' }, { customer: null }, { customer: '  ' }, { customer: 'Acor' }]))
      .toEqual(['Acor'])
  })

  it('sorts case-insensitively so ADM WILD does not jump the list', () => {
    expect(customerOptions([{ customer: 'Kunitaro' }, { customer: 'ADM WILD' }, { customer: 'acor' }]))
      .toEqual(['acor', 'ADM WILD', 'Kunitaro'])
  })

  it('is stable when spellings tie on frequency', () => {
    const rows = [{ customer: 'Edelweiss' }, { customer: 'EDELWEISS' }]
    expect(customerOptions(rows)).toEqual(customerOptions([...rows].reverse()))
    // localeCompare puts 'Edelweiss' before 'EDELWEISS', so that is the winner;
    // what matters is that it is the SAME winner regardless of row order.
    expect(customerOptions(rows)).toEqual(['Edelweiss'])
  })

  it('handles an empty or missing row set', () => {
    expect(customerOptions([])).toEqual([])
    expect(customerOptions(null)).toEqual([])
  })
})

describe('docVersionOf', () => {
  it('reads the trailing number of a controlled doc number', () => {
    expect(docVersionOf('IPS-ENT-007')).toBe(7)
    expect(docVersionOf('IPS-KUN-009')).toBe(9)
    expect(docVersionOf('IPS-BAO-006')).toBe(6)
  })
  it('treats 007 and 7 as the same version', () => {
    expect(docVersionOf('IPS-ENT-7')).toBe(docVersionOf('IPS-ENT-007'))
  })
  it('anchors to the END, so digits inside the customer code do not win', () => {
    expect(docVersionOf('IPS-3M-004')).toBe(4)
  })
  it('tolerates padding', () => {
    expect(docVersionOf('  IPS-ENT-007  ')).toBe(7)
  })
  it('is null when there is no document number at all', () => {
    for (const v of [null, undefined, '', '   ', 'DRAFT']) expect(docVersionOf(v)).toBeNull()
  })
})

describe('pickSpecForCustomer — latest document wins', () => {
  const ent = (v: string, id: number, bdMax: number) => ({
    id, customer: 'Entyce', doc_no: `IPS-ENT-${v}`, bd_max: bdMax,
  })

  it('picks IPS-ENT-007 over 001 and 003, in any row order', () => {
    const rows = [ent('001', 10, 300), ent('007', 12, 340), ent('003', 11, 320)]
    for (const order of [rows, [...rows].reverse(), [rows[1], rows[0], rows[2]]]) {
      const r = pickSpecForCustomer(order, 'Entyce')
      expect(r.spec?.doc_no).toBe('IPS-ENT-007')
      expect(r.via).toBe('customer')
    }
  })

  it('does NOT call several different documents ambiguous — it lists them as superseded', () => {
    const r = pickSpecForCustomer([ent('001', 10, 300), ent('007', 12, 340)], 'Entyce')
    expect(r.ambiguous).toEqual([])
    expect(r.superseded.map(x => x.doc_no)).toEqual(['IPS-ENT-001'])
  })

  it('still reports a genuine tie on the same version as ambiguous', () => {
    const r = pickSpecForCustomer([ent('007', 10, 300), ent('007', 12, 340)], 'Entyce')
    expect(r.ambiguous.map(x => x.id)).toEqual([12, 10])
  })

  it('treats rows with no doc number as tied — the pre-migration Entyce case', () => {
    const bare = [
      { id: 33, customer: 'Entyce ', bd_max: 300 },
      { id: 46, customer: 'ENTYCE ', bd_max: 300 },
      { id: 47, customer: 'Entyce',  bd_max: 320 },
    ]
    expect(pickSpecForCustomer(bare, 'Entyce').ambiguous.map(x => x.id)).toEqual([47, 46, 33])
  })

  it('prefers ANY numbered document over an unnumbered row', () => {
    const r = pickSpecForCustomer([
      { id: 1, customer: 'Entyce', doc_no: null },
      { id: 2, customer: 'Entyce', doc_no: 'IPS-ENT-001' },
    ], 'Entyce')
    expect(r.spec?.id).toBe(2)
    expect(r.ambiguous).toEqual([])
  })

  it('applies the same rule to generic rows', () => {
    const r = pickSpecForCustomer([
      { id: 1, customer: '', doc_no: 'IPS-GEN-001' },
      { id: 2, customer: '', doc_no: 'IPS-GEN-004' },
    ], 'Nobody')
    expect(r.via).toBe('generic')
    expect(r.spec?.doc_no).toBe('IPS-GEN-004')
  })

  it('a customer document beats a newer generic one', () => {
    const r = pickSpecForCustomer([
      { id: 1, customer: '', doc_no: 'IPS-GEN-009' },
      { id: 2, customer: 'Entyce', doc_no: 'IPS-ENT-001' },
    ], 'Entyce')
    expect(r.spec?.id).toBe(2)
    expect(r.via).toBe('customer')
  })
})

// The aliases below are the real rows seeded by migration 20260903_002, each
// one backed by production runs that were resolving to the generic spec.
const ALIASES = [
  { alias: 'EWTC',                         canonical_name: 'East West Tea Company (EWTC)' },
  { alias: 'East West Tea Company',        canonical_name: 'East West Tea Company (EWTC)' },
  { alias: 'East West Tea Co.',            canonical_name: 'East West Tea Company (EWTC)' },
  { alias: 'Afri Tea and Coffee Blenders', canonical_name: "Afri Tea and Coffee's" },
  { alias: 'Lipton&Infusion (Ekaterra)',   canonical_name: 'Lipton and Infusion' },
  { alias: 'Alveus GmbH',                  canonical_name: 'Alveus' },
]

describe('resolveCustomerName', () => {
  it('maps the short form onto the spec row name (2 real runs)', () => {
    expect(resolveCustomerName('EWTC', ALIASES)).toBe('East West Tea Company (EWTC)')
  })
  it('maps the spec-sheet spelling onto the spec row name', () => {
    expect(resolveCustomerName('East West Tea Company', ALIASES)).toBe('East West Tea Company (EWTC)')
    expect(resolveCustomerName('East West Tea Co.', ALIASES)).toBe('East West Tea Company (EWTC)')
  })
  it('maps the group name onto the customer name (1 real run)', () => {
    expect(resolveCustomerName('Lipton&Infusion (Ekaterra)', ALIASES)).toBe('Lipton and Infusion')
  })
  it('handles an apostrophe in the canonical name', () => {
    expect(resolveCustomerName('Afri Tea and Coffee Blenders', ALIASES)).toBe("Afri Tea and Coffee's")
  })

  it('matches the alias case-insensitively and through stray whitespace', () => {
    // The whole point: a QC typing 'ewtc ' must land in the same place.
    for (const v of ['ewtc', 'EWTC ', ' Ewtc', 'E W T C'.replace(/ /g, '')]) {
      expect(resolveCustomerName(v, ALIASES)).toBe('East West Tea Company (EWTC)')
    }
  })

  it('returns the name unchanged when there is no alias', () => {
    expect(resolveCustomerName('Kunitaro', ALIASES)).toBe('Kunitaro')
    expect(resolveCustomerName('Entyce', ALIASES)).toBe('Entyce')
  })

  it('cleans the name even when no alias applies', () => {
    expect(resolveCustomerName('  Kunitaro  ', ALIASES)).toBe('Kunitaro')
    expect(resolveCustomerName('Afri  Tea', ALIASES)).toBe('Afri Tea')
  })

  it('is safe with no alias list at all', () => {
    expect(resolveCustomerName('EWTC', null)).toBe('EWTC')
    expect(resolveCustomerName('EWTC', [])).toBe('EWTC')
    expect(resolveCustomerName('EWTC', undefined)).toBe('EWTC')
  })

  it('returns empty for a blank name — generic stays generic', () => {
    for (const v of ['', '  ', null, undefined]) expect(resolveCustomerName(v, ALIASES)).toBe('')
  })

  it('does NOT chain aliases — a single hop only', () => {
    // a -> b -> c would make the answer depend on traversal order, and invites
    // cycles. One hop, deterministically.
    const chained = [
      { alias: 'A', canonical_name: 'B' },
      { alias: 'B', canonical_name: 'C' },
    ]
    expect(resolveCustomerName('A', chained)).toBe('B')
  })

  it('ignores a self-referential or blank alias row rather than returning empty', () => {
    // The DB constraints forbid both, but a wrong answer here would be a real
    // customer resolving to '' and silently taking the generic spec.
    expect(resolveCustomerName('Kunitaro', [{ alias: 'Kunitaro', canonical_name: 'kunitaro ' }])).toBe('Kunitaro')
    expect(resolveCustomerName('Kunitaro', [{ alias: 'Kunitaro', canonical_name: '' }])).toBe('Kunitaro')
    expect(resolveCustomerName('Kunitaro', [{ alias: 'Kunitaro', canonical_name: null }])).toBe('Kunitaro')
  })
})

describe('wasAliased', () => {
  it('is true only when the name actually changed', () => {
    expect(wasAliased('EWTC', ALIASES)).toBe(true)
    expect(wasAliased('Kunitaro', ALIASES)).toBe(false)
    expect(wasAliased('  Kunitaro ', ALIASES)).toBe(false)   // cleaning is not aliasing
    expect(wasAliased('', ALIASES)).toBe(false)
  })
})

describe('pickSpecForCustomerWithAliases', () => {
  const rows = [
    { id: 48, customer: 'East West Tea Company (EWTC)', doc_no: 'IPS-EAS-002' },
    { id: 38, customer: '', doc_no: null },
  ]

  it('finds the customer spec for a run recorded as EWTC — previously generic', () => {
    const r = pickSpecForCustomerWithAliases(rows, 'EWTC', ALIASES)
    expect(r.spec?.id).toBe(48)
    expect(r.via).toBe('customer')
    expect(r.aliased).toBe(true)
    expect(r.resolvedCustomer).toBe('East West Tea Company (EWTC)')
  })

  it('without the alias list the same run still falls back to generic', () => {
    // Guards the regression: this is the behaviour before the alias table.
    const r = pickSpecForCustomerWithAliases(rows, 'EWTC', [])
    expect(r.spec?.id).toBe(38)
    expect(r.via).toBe('generic')
    expect(r.aliased).toBe(false)
  })

  it('leaves an un-aliased customer exactly as before', () => {
    const r = pickSpecForCustomerWithAliases(rows, 'Nobody', ALIASES)
    expect(r.via).toBe('generic')
    expect(r.aliased).toBe(false)
    expect(r.resolvedCustomer).toBe('Nobody')
  })

  it('still reports superseded documents through an alias', () => {
    const many = [
      { id: 1, customer: 'East West Tea Company (EWTC)', doc_no: 'IPS-EAS-001' },
      { id: 2, customer: 'East West Tea Company (EWTC)', doc_no: 'IPS-EAS-002' },
    ]
    const r = pickSpecForCustomerWithAliases(many, 'EWTC', ALIASES)
    expect(r.spec?.doc_no).toBe('IPS-EAS-002')
    expect(r.superseded.map(x => x.doc_no)).toEqual(['IPS-EAS-001'])
  })
})
