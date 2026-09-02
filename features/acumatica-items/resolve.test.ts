import { describe, it, expect } from 'vitest'
import { buildCatalogue, variantCodeOf, variantCodeForWord, stemOf, type InventoryRow } from './catalogue'
import { resolveItem, resolveInputItem, explain, resolvedId } from './resolve'

/**
 * A slice of the real master inventory (production.inventory_items on staging).
 * Ids, descriptions and the `variant` column are copied verbatim, including the
 * rows where Acumatica's own data is inconsistent — those are the cases worth
 * pinning, not idealised ones.
 */
const ROWS: InventoryRow[] = [
  // Leaf, all three grade families, Conventional + Organic
  { inventory_id: '10LGEF-C',  description: 'Sieved Fine Leaf: Export - Conventional',   product_group: 'Leaf', variant: 'Conventional' },
  { inventory_id: '10LGEC-C',  description: 'Sieved Coarse Leaf: Export - Conventional', product_group: 'Leaf', variant: 'Conventional' },
  { inventory_id: '10LGDC-C',  description: 'Sieved Coarse Leaf Domestic - Conventional', product_group: 'Leaf', variant: 'Conventional' },
  { inventory_id: 'S10LGE-C',  description: 'Sieved Leaf: Export - Conventional',        product_group: 'Leaf', variant: 'Conventional' },
  // The floor calls this Heavy Sticks; Acumatica calls the item 'Sticks'.
  // ('Sticks' is also the product_group name, which is a different thing again.)
  { inventory_id: '15IGST-C',  description: 'Sticks - Conventional',    product_group: 'Sticks', variant: 'Conventional' },
  { inventory_id: '15IGST-O',  description: 'Sticks - Organic',         product_group: 'Sticks', variant: 'Organic' },
  { inventory_id: '15IGST-RC', description: 'Sticks - RA Conventional', product_group: 'Sticks', variant: 'RA-Conventional' },
  { inventory_id: '15IGIS-C',  description: 'Indent Sticks - Conventional', product_group: 'Sticks', variant: 'Conventional' },
  // Blocks — the three rows whose `variant` COLUMN is wrong in Acumatica.
  { inventory_id: '15IGBL-C-C',  description: 'Blocks: Clean - Conventional',    product_group: 'Sticks', variant: 'Conventional' },
  { inventory_id: '15IGBL-C-O',  description: 'Blocks: Clean - Organic',         product_group: 'Sticks', variant: 'Conventional' },
  { inventory_id: '15IGBL-C-RO', description: 'Blocks: Clean - RA Organic',      product_group: 'Sticks', variant: 'Conventional' },
  // Granules — Export exists in 001 for CON/ORG only, and in 002 for RA too.
  { inventory_id: '20BGGE-001-C',  description: 'Granule Export : (67BD|25IS|8POW) - Conventional', product_group: 'Granules', variant: 'Conventional' },
  { inventory_id: '20BGGE-001-O',  description: 'Granule Export : (67BD|25IS|8POW) - Organic',      product_group: 'Granules', variant: 'Organic' },
  { inventory_id: '20BGGE-002-RC', description: 'Granules: Export: (56BD|36IS|8POW) - RA Conventional', product_group: 'Granules', variant: 'RA-Conventional' },
  { inventory_id: '20BGGSG-001-C', description: 'Granules SG: (29BD|18WD|45IS|8PWD  ) - Conventional',   product_group: 'Granules', variant: 'Conventional' },
  // Raw material, including the Fairtrade item that really does exist.
  { inventory_id: '05RMDE-C',  description: 'Raw Material Dry: Export Conventional',            product_group: 'Raw Dry', variant: 'Conventional' },
  { inventory_id: '05RMDE-FC', description: 'Raw Material Dry: Export Fairtrade Conventional',  product_group: 'Raw Dry', variant: 'FT-Conventional' },
]

const cat = buildCatalogue(ROWS)

describe('catalogue', () => {
  it('reads the variant off the id, not off the drifted column', () => {
    // 15IGBL-C-O is filed as Conventional in the synced data even though it is
    // the Organic block. Code that filters on the column drops Blocks out of
    // the Organic picker; the id is what Acumatica matches on, so the id wins.
    const organicBlocks = cat.byId.get('15IGBL-C-O')!
    expect(organicBlocks.declaredVariant).toBe('Conventional')
    expect(organicBlocks.variant).toBe('Organic')
    expect(organicBlocks.variantDrifted).toBe(true)
  })

  it('does not flag agreement as drift', () => {
    expect(cat.byId.get('15IGST-C')!.variantDrifted).toBe(false)
  })

  it('reads the longer suffixes before the shorter ones', () => {
    // '-RC' ends in 'C'; tested the other way round every RA item is Conventional.
    expect(variantCodeOf('15IGST-RC')).toBe('RC')
    expect(variantCodeOf('15IGST-C')).toBe('C')
    expect(variantCodeOf('05RMDE-FC')).toBe('FC')
  })

  it('keeps a hyphenated stem intact', () => {
    // '15IGBL-C-O' is the stem '15IGBL-C' plus '-O', NOT '15IGBL' plus '-C-O'.
    expect(stemOf('15IGBL-C-O')).toBe('15IGBL-C')
    expect(stemOf('20BGCHS-F-RC')).toBe('20BGCHS-F')
  })

  it('leaves an id with no variant suffix alone', () => {
    // '-BL' is not a variant code, so the whole id is the stem. Trimming a
    // trailing segment just because there is one would fold '15IGCP-BL'
    // (Contract Processing: Blocks) and '15IGCP-IS' (Indent Sticks) together.
    expect(stemOf('15IGCP-BL')).toBe('15IGCP-BL')
    expect(variantCodeOf('20BGGF-CL-001')).toBe(null)
  })
})

describe('resolveItem', () => {
  it('resolves Heavy Sticks under every name it has ever had', () => {
    // Floor name 'Heavy Sticks' resolves to the Acumatica item called 'Sticks'.
    for (const name of ['Heavy Sticks', 'Sticks', 'Rolsiev Sticks', 'RS']) {
      const r = resolveItem(cat, { productType: name, variant: 'CON', grade: 'A' })
      expect(r.kind, name).toBe('resolved')
      expect(resolvedId(r), name).toBe('15IGST-C')
    }
  })

  it('gives the Acumatica description, not the floor name and not one the app made up', () => {
    // The operator sees "Heavy Sticks"; the import must carry Acumatica's own
    // wording. Both are right, and this is where they meet.
    const r = resolveItem(cat, { productType: 'Heavy Sticks', variant: 'ORG', grade: 'A' })
    expect(r.kind === 'resolved' && r.item.inventoryId).toBe('15IGST-O')
    expect(r.kind === 'resolved' && r.item.description).toBe('Sticks - Organic')
  })

  it('keeps Indent Sticks on its own item', () => {
    const r = resolveItem(cat, { productType: 'Indent Sticks', variant: 'CON', grade: 'A' })
    expect(resolvedId(r)).toBe('15IGIS-C')
  })

  it('picks the leaf family from the grade', () => {
    expect(resolvedId(resolveItem(cat, { productType: 'Fine Leaf', variant: 'CON', grade: 'A' }))).toBe('10LGEF-C')
    expect(resolvedId(resolveItem(cat, { productType: 'Coarse Leaf', variant: 'CON', grade: 'C' }))).toBe('10LGDC-C')
  })

  it('returns the phantom only when the phantom itself exists', () => {
    const a = resolveItem(cat, { productType: 'Fine Leaf', variant: 'CON', grade: 'A' })
    expect(a.kind === 'resolved' && a.phantomId).toBe('S10LGE-C')
    // Grade C's phantom S10LGD-C is not in this slice — reported as absent
    // rather than passed on, because the production order is raised against it.
    const c = resolveItem(cat, { productType: 'Coarse Leaf', variant: 'CON', grade: 'C' })
    expect(c.kind === 'resolved' && c.phantomId).toBe(null)
  })

  it('refuses to invent an id that is not stocked', () => {
    // THE bug this module exists for. The template returns 20BGGE-001-RC for
    // this; no such item exists, so the bag shipped a code Acumatica rejects.
    const r = resolveItem(cat, { productType: 'Export Granules', variant: 'RA CON', grade: 'A' })
    expect(r.kind).toBe('not-stocked')
    expect(resolvedId(r)).toBe(null)
    expect(r.kind === 'not-stocked' && r.wantedId).toBe('20BGGE-001-RC')
    // and says what DOES exist, so the answer is actionable
    expect(r.kind === 'not-stocked' && r.availableVariants).toEqual(['Conventional', 'Organic'])
  })

  it('does not collapse the 002 recipes onto the 001 ones', () => {
    // The template mapped 'SG Granules 002' to 20BGGSG-001 — the SAME id as
    // 'SG Granules'. Two different recipes, one code, silently.
    const r = resolveItem(cat, { productType: 'SG Granules 002', variant: 'CON', grade: 'A' })
    expect(r.kind).toBe('not-stocked')
    expect(r.kind === 'not-stocked' && r.wantedId).toBe('20BGGSG-002-C')
  })

  it('finds the Organic block despite the drifted variant column', () => {
    const r = resolveItem(cat, { productType: 'RB Blocks', variant: 'ORG', grade: 'A' })
    expect(resolvedId(r)).toBe('15IGBL-C-O')
  })

  it('separates "no code on purpose" from "could not find it"', () => {
    const spill = resolveItem(cat, { productType: 'Bucket Elevator Spillage', variant: 'CON', grade: 'A' })
    expect(spill.kind).toBe('no-item')
    const blend = resolveItem(cat, { productType: 'Blended Batch', variant: 'CON', grade: 'A' })
    expect(blend.kind).toBe('no-item')
    // Both produce a blank code today, indistinguishable from a broken lookup.
    const typo = resolveItem(cat, { productType: 'Rolsev Sticks', variant: 'CON', grade: 'A' })
    expect(typo.kind).toBe('unknown-product')
  })

  it('rejects a variant or grade it does not know instead of guessing', () => {
    const badVariant = resolveItem(cat, { productType: 'Heavy Sticks', variant: 'PURPLE', grade: 'A' })
    expect(badVariant.kind).toBe('bad-input')
    const badGrade = resolveItem(cat, { productType: 'Fine Leaf', variant: 'CON', grade: 'Z' })
    expect(badGrade.kind).toBe('bad-input')
    // A grade is only required by the items that are graded.
    expect(resolveItem(cat, { productType: 'Heavy Sticks', variant: 'CON', grade: '' }).kind).toBe('resolved')
  })

  it('explains every outcome in one actionable line', () => {
    expect(explain(resolveItem(cat, { productType: 'Heavy Sticks', variant: 'CON', grade: 'A' })))
      .toBe('15IGST-C — Sticks - Conventional')
    expect(explain(resolveItem(cat, { productType: 'Export Granules', variant: 'RA CON', grade: 'A' })))
      .toContain('It exists in Conventional, Organic.')
  })
})

describe('resolveInputItem', () => {
  it('resolves the farm-bag raw material by grade', () => {
    expect(resolvedId(resolveInputItem(cat, 'A', 'CON'))).toBe('05RMDE-C')
  })

  it('keeps Fairtrade on its own certified item', () => {
    // variantToShort() used to fold FT-CON onto CON before this was ever
    // called, booking certified Fairtrade material against the plain
    // conventional item — a wrong code that imports cleanly, which is worse
    // than a blank one. 05RMDE-FC is a real, separate item.
    expect(resolvedId(resolveInputItem(cat, 'A', 'FT CON'))).toBe('05RMDE-FC')
    expect(resolvedId(resolveInputItem(cat, 'A', 'CON'))).toBe('05RMDE-C')
  })

  it('accepts Fairtrade in any of the three vocabularies', () => {
    for (const v of ['FT CON', 'FT-CON', 'FT-Conventional']) {
      expect(resolvedId(resolveInputItem(cat, 'A', v)), v).toBe('05RMDE-FC')
    }
  })

  it('reports a grade it does not know', () => {
    expect(resolveInputItem(cat, 'Z', 'CON').kind).toBe('bad-input')
  })
})

describe('variantCodeForWord', () => {
  it('maps all three vocabularies onto one code', () => {
    // inventory_items.variant | app DbVariant | short UI label
    expect(['Conventional', 'CON'].map(variantCodeForWord)).toEqual(['C', 'C'])
    expect(['Organic', 'ORG'].map(variantCodeForWord)).toEqual(['O', 'O'])
    expect(['RA-Conventional', 'RA CON'].map(variantCodeForWord)).toEqual(['RC', 'RC'])
    expect(['RA-Organic', 'RA ORG'].map(variantCodeForWord)).toEqual(['RO', 'RO'])
  })

  it('reconciles the two spellings of Fairtrade', () => {
    // This is the pair that made a direct string comparison impossible:
    // inventory_items says 'FT-Organic', the app's DbVariant says 'FT-ORG'.
    expect(['FT-Organic', 'FT-ORG', 'FT ORG'].map(variantCodeForWord)).toEqual(['FO', 'FO', 'FO'])
    expect(['FT-Conventional', 'FT-CON', 'FT CON'].map(variantCodeForWord)).toEqual(['FC', 'FC', 'FC'])
  })

  it('agrees with the code read off an item id', () => {
    // The whole point: a row and a variant word have to land on the same code.
    expect(variantCodeForWord('Organic')).toBe(variantCodeOf('15IGBL-C-O'))
    expect(variantCodeForWord('RA-Organic')).toBe(variantCodeOf('15IGBL-C-RO'))
  })

  it('returns null for something it does not know, rather than a default', () => {
    expect(variantCodeForWord('Purple')).toBe(null)
    expect(variantCodeForWord('')).toBe(null)
    expect(variantCodeForWord(null)).toBe(null)
  })
})
