import { describe, it, expect } from 'vitest'
import {
  normCustomerKey, cleanCustomerName, isGenericSpec,
  pickSpecForCustomer, findDuplicateSpec, customerOptions,
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
    expect(r.ambiguous.map(x => x.id)).toEqual([33, 46, 47])
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
    expect(pickSpecForCustomer([], 'Entyce')).toEqual({ spec: null, via: 'none', ambiguous: [] })
    expect(pickSpecForCustomer(null, 'Entyce').via).toBe('none')
  })

  it('flags two generic rows for one product as ambiguous too', () => {
    const r = pickSpecForCustomer([{ id: 1, customer: '' }, { id: 2, customer: null }], 'Nobody')
    expect(r.via).toBe('generic')
    expect(r.ambiguous.map(x => x.id)).toEqual([1, 2])
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
