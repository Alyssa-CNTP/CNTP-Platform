import { describe, it, expect } from 'vitest'
import { canonicalProductType, sameProduct, stripVariantSuffix } from './product-names'

describe('canonicalProductType', () => {
  it('folds every name Heavy Sticks has had onto the floor name', () => {
    // The floor calls it Heavy Sticks. Acumatica calls the same item 15IGST
    // "Sticks", which is resolved separately — 'Sticks' is an ALIAS here, not
    // the canonical name.
    for (const alias of ['Rolsiev Sticks', 'Sticks', 'Sticks (RS)', 'RS', 'Rolsiev E Sticks']) {
      expect(canonicalProductType(alias), alias).toBe('Heavy Sticks')
    }
  })

  it('leaves the canonical name alone', () => {
    expect(canonicalProductType('Heavy Sticks')).toBe('Heavy Sticks')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(canonicalProductType('  rolsiev   STICKS ')).toBe('Heavy Sticks')
  })

  it('does NOT fold Indent Sticks into Heavy Sticks', () => {
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
    expect(canonicalProductType('Rolsiev Sticks - RA Organic')).toBe('Heavy Sticks')
  })

  it('does not mistake a name that merely ends in a variant-like word', () => {
    // Only the " - Variant" form is a suffix; the words alone are not.
    expect(stripVariantSuffix('Raw Material Dry Organic')).toBe('Raw Material Dry Organic')
  })
})

describe('sameProduct', () => {
  it('matches a legacy row against the renamed picker value', () => {
    // The 8 bag_tags rows that still say "Rolsiev Sticks" have to group with
    // the bags tagged "Heavy Sticks" from now on, or the floor sees one
    // material under two headings.
    expect(sameProduct('Rolsiev Sticks', 'Heavy Sticks')).toBe(true)
    // ...and so does anything stored under the Acumatica spelling.
    expect(sameProduct('Sticks', 'Heavy Sticks')).toBe(true)
  })

  it('keeps the two stick products apart', () => {
    expect(sameProduct('Indent Sticks', 'Heavy Sticks')).toBe(false)
    expect(sameProduct('Cut Heavy Stick Fine', 'Heavy Sticks')).toBe(false)
  })

  it('is false for blanks rather than matching everything', () => {
    expect(sameProduct('', '')).toBe(false)
    expect(sameProduct(null, undefined)).toBe(false)
  })
})

describe('RB Blocks — the same drift as Heavy Sticks', () => {
  it('folds every name the three layers used onto the floor name', () => {
    // Acumatica said "Blocks: Clean" (15IGBL-C), so the picker read
    // "15IGBL-C-C · Blocks: Clean - Conventional"; Sieving capture and the
    // Acumatica summary said "RB Blocks"; Quality said "Rooibos Blocks".
    for (const alias of ['Blocks: Clean', 'Blocks Clean', 'Rooibos Blocks', 'RB Block', 'Blocks', 'RB Blocks']) {
      expect(canonicalProductType(alias)).toBe('RB Blocks')
    }
  })

  it('strips the variant suffix the picker appended', () => {
    expect(canonicalProductType('Blocks: Clean - Conventional')).toBe('RB Blocks')
    expect(canonicalProductType('Rooibos Blocks - Organic')).toBe('RB Blocks')
  })

  it('does NOT fold cut blocks in — they are a different material', () => {
    // The Acumatica summary reports Blocks Clean (C) and Blocks Cut (D) on
    // separate lines; merging them would add the two together.
    expect(canonicalProductType('Blocks: Cut')).not.toBe('RB Blocks')
    expect(canonicalProductType('Blocks Cut / CHS')).not.toBe('RB Blocks')
    expect(canonicalProductType('Cut Heavy Stick Fine')).not.toBe('RB Blocks')
  })
})
