import { describe, it, expect } from 'vitest'
import { canonicalProductType, sameProduct, stripVariantSuffix } from './product-names'

describe('canonicalProductType', () => {
  it('folds every name Sticks has had onto the Acumatica one', () => {
    // 15IGST-C is "Sticks - Conventional" in the master inventory. That is the
    // name the operator now picks and the tag now prints.
    for (const alias of ['Rolsiev Sticks', 'Heavy Sticks', 'Sticks (RS)', 'RS', 'Rolsiev E Sticks']) {
      expect(canonicalProductType(alias), alias).toBe('Sticks')
    }
  })

  it('leaves the canonical name alone', () => {
    expect(canonicalProductType('Sticks')).toBe('Sticks')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(canonicalProductType('  rolsiev   STICKS ')).toBe('Sticks')
  })

  it('does NOT fold Indent Sticks into Sticks', () => {
    // 15IGIS is a different Acumatica item. A substring rule on "stick" would
    // merge the two and put indent material under the wrong code.
    expect(canonicalProductType('Indent Sticks')).toBe('Indent Sticks')
  })

  it('does NOT fold the Refining 2 cut stick outputs', () => {
    // "Heavy Stick" is a substring of both, and both are their own Acumatica
    // items (20BGCHS-F, 20BGCHS-C).
    expect(canonicalProductType('Cut Heavy Stick Fine')).toBe('Cut Heavy Stick Fine')
    expect(canonicalProductType('Cut Heavy Stick Coarse')).toBe('Cut Heavy Stick Coarse')
  })

  it('passes an unrecognised product through unchanged', () => {
    // The property that keeps this safe to extend: a product added next year is
    // merely unaliased, never silently renamed to something else.
    expect(canonicalProductType('Corn Cutter Fine Leaf')).toBe('Corn Cutter Fine Leaf')
    expect(canonicalProductType('Something Nobody Has Built Yet')).toBe('Something Nobody Has Built Yet')
  })

  it('handles null, undefined and blank', () => {
    expect(canonicalProductType(null)).toBe('')
    expect(canonicalProductType(undefined)).toBe('')
    expect(canonicalProductType('   ')).toBe('')
  })

  it('strips a variant that was stored inside the name', () => {
    // Real rows in bag_tags: "Indent Sticks - Conventional" alongside plain
    // "Indent Sticks", which splits one product into two on every group-by.
    expect(canonicalProductType('Indent Sticks - Conventional')).toBe('Indent Sticks')
    expect(canonicalProductType('Rolsiev Sticks - RA Organic')).toBe('Sticks')
  })

  it('does not mistake a name that merely ends in a variant-like word', () => {
    // Only the " - Variant" form is a suffix; the words alone are not.
    expect(stripVariantSuffix('Raw Material Dry Organic')).toBe('Raw Material Dry Organic')
  })
})

describe('sameProduct', () => {
  it('matches a legacy row against the renamed picker value', () => {
    // The 8 bag_tags rows that still say "Rolsiev Sticks" have to group with
    // the bags tagged "Sticks" from now on, or the floor sees one material
    // under two headings.
    expect(sameProduct('Rolsiev Sticks', 'Sticks')).toBe(true)
  })

  it('keeps the two stick products apart', () => {
    expect(sameProduct('Indent Sticks', 'Sticks')).toBe(false)
    expect(sameProduct('Cut Heavy Stick Fine', 'Sticks')).toBe(false)
  })

  it('is false for blanks rather than matching everything', () => {
    expect(sameProduct('', '')).toBe(false)
    expect(sameProduct(null, undefined)).toBe(false)
  })
})
