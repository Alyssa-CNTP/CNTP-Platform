import { describe, it, expect } from 'vitest'
import {
  groupLibraryByCustomer, pickHeadline, customerOptions,
  GENERIC_GROUP_LABEL, type LibraryTemplate,
} from './library'

const t = (
  code: string, version: number, status: LibraryTemplate['status'],
  customer?: string | null, name = code,
): LibraryTemplate => ({ id: `${code}-v${version}`, code, name, version, status, customer })

describe('pickHeadline', () => {
  it('prefers the approved version — that is what can actually be printed', () => {
    const v = [t('EU-ORG', 1, 'superseded'), t('EU-ORG', 2, 'approved'), t('EU-ORG', 3, 'draft')]
    expect(pickHeadline(v).version).toBe(2)
  })

  it('falls back to pending, then draft, when nothing is approved', () => {
    expect(pickHeadline([t('X', 1, 'draft'), t('X', 2, 'pending_approval')]).version).toBe(2)
    expect(pickHeadline([t('X', 1, 'rejected'), t('X', 2, 'draft')]).version).toBe(2)
  })

  it('does NOT surface a superseded label over a draft', () => {
    // Superseded is history. Showing it as the headline reads as "usable".
    expect(pickHeadline([t('X', 3, 'superseded'), t('X', 1, 'draft')]).status).toBe('draft')
  })

  it('takes the newest approved when there are several', () => {
    expect(pickHeadline([t('X', 2, 'approved'), t('X', 5, 'approved')]).version).toBe(5)
  })

  it('does not mutate the array it was given', () => {
    const v = [t('X', 1, 'draft'), t('X', 9, 'approved')]
    pickHeadline(v)
    expect(v.map(x => x.version)).toEqual([1, 9])
  })
})

describe('groupLibraryByCustomer', () => {
  it('groups by customer and puts generic last', () => {
    const g = groupLibraryByCustomer([
      t('LOCAL', 1, 'approved', null),
      t('KUN-RA', 1, 'approved', 'Kunitaro'),
      t('LIP-EU', 1, 'approved', 'Lipton and Infusion'),
    ])
    expect(g.map(x => x.label)).toEqual(['Kunitaro', 'Lipton and Infusion', GENERIC_GROUP_LABEL])
  })

  it('keeps a customer’s several products as SEPARATE families', () => {
    // Rooibos carries the importer address, rosehips does not. Both approved,
    // independently. They are not versions of each other.
    const g = groupLibraryByCustomer([
      t('LIP-ROOI', 1, 'approved', 'Lipton and Infusion', 'Lipton Rooibos'),
      t('LIP-ROSE', 1, 'approved', 'Lipton and Infusion', 'Lipton Rosehips'),
    ])
    expect(g).toHaveLength(1)
    expect(g[0].families.map(f => f.code).sort()).toEqual(['LIP-ROOI', 'LIP-ROSE'])
  })

  it('collects versions of one family together, newest first', () => {
    const g = groupLibraryByCustomer([
      t('KUN-RA', 1, 'superseded', 'Kunitaro'),
      t('KUN-RA', 3, 'draft', 'Kunitaro'),
      t('KUN-RA', 2, 'approved', 'Kunitaro'),
    ])
    const fam = g[0].families[0]
    expect(fam.versions.map(v => v.version)).toEqual([3, 2, 1])
    expect(fam.headline.version).toBe(2)     // the approved one
  })

  it('folds spelling and whitespace variants into one group', () => {
    const g = groupLibraryByCustomer([
      t('A', 1, 'approved', 'Kunitaro'),
      t('B', 1, 'approved', ' kunitaro '),
    ])
    expect(g).toHaveLength(1)
    expect(g[0].label).toBe('Kunitaro')      // display keeps the first real spelling
  })

  it('treats empty string and whitespace as generic, not as a customer named ""', () => {
    const g = groupLibraryByCustomer([t('A', 1, 'approved', '   '), t('B', 1, 'approved', null)])
    expect(g).toHaveLength(1)
    expect(g[0].customer).toBeNull()
    expect(g[0].label).toBe(GENERIC_GROUP_LABEL)
  })

  it('sorts families within a customer by NAME, which is what sales knows', () => {
    const g = groupLibraryByCustomer([
      t('ZZ-1', 1, 'approved', 'Kunitaro', 'Apple'),
      t('AA-1', 1, 'approved', 'Kunitaro', 'Zebra'),
    ])
    expect(g[0].families.map(f => f.headline.name)).toEqual(['Apple', 'Zebra'])
  })

  it('returns nothing for no templates, rather than an empty generic group', () => {
    expect(groupLibraryByCustomer([])).toEqual([])
  })

  it('loses no template', () => {
    const rows = [
      t('A', 1, 'approved', 'Kunitaro'), t('A', 2, 'draft', 'Kunitaro'),
      t('B', 1, 'approved', 'Lupicia'), t('C', 1, 'approved', null),
    ]
    const total = groupLibraryByCustomer(rows)
      .flatMap(g => g.families).flatMap(f => f.versions).length
    expect(total).toBe(rows.length)
  })
})

describe('customerOptions', () => {
  it('unions the quality specs with names already on labels', () => {
    expect(customerOptions(['Kunitaro', 'Lupicia'], ['Tanganda'])).toEqual(
      ['Kunitaro', 'Lupicia', 'Tanganda'],
    )
  })

  it('de-duplicates case-insensitively, keeping the first spelling', () => {
    // Two spellings of one customer in a dropdown is how the drift starts.
    expect(customerOptions(['Kunitaro'], ['KUNITARO', 'kunitaro'])).toEqual(['Kunitaro'])
  })

  it('drops blanks rather than offering an empty option', () => {
    expect(customerOptions(['', '  ', 'Alveus'], [null, undefined])).toEqual(['Alveus'])
  })

  it('sorts alphabetically', () => {
    expect(customerOptions(['Tanganda', 'Alveus', 'Kunitaro'])).toEqual(
      ['Alveus', 'Kunitaro', 'Tanganda'],
    )
  })
})
