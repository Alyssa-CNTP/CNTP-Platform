import { describe, it, expect, vi, afterEach } from 'vitest'
import type { InventoryRow } from '@/features/acumatica-items'

/**
 * suggestOutputs() is what fills the output picker. It is the one place the
 * resolver changes what an operator can see, so both paths are pinned here.
 */

const KEY = 'NEXT_PUBLIC_FF_ACUMATICA_RESOLVER'
const original = process.env[KEY]

afterEach(() => {
  if (original === undefined) delete process.env[KEY]
  else process.env[KEY] = original
  vi.resetModules()
})

// A slice of the real master inventory. Sieving's outputs are Fine Leaf,
// Coarse Leaf, RB Blocks, Heavy Sticks, Indent Sticks, Brown Dust, Powder Dust
// and Bucket Elevator Spillage. Heavy Sticks is deliberately ABSENT in Organic
// so the not-stocked path has something real to report.
const ROWS: InventoryRow[] = [
  { inventory_id: '10LGEF-O', description: 'Sieved Fine Leaf: Export - Organic',   product_group: 'Leaf',   variant: 'Organic' },
  { inventory_id: '10LGEC-O', description: 'Sieved Coarse Leaf: Export - Organic', product_group: 'Leaf',   variant: 'Organic' },
  { inventory_id: '15IGBL-C-O', description: 'Blocks: Clean - Organic',            product_group: 'Sticks', variant: 'Conventional' },
  { inventory_id: '15IGIS-O', description: 'Indent Sticks - Organic',              product_group: 'Sticks', variant: 'Organic' },
  { inventory_id: '15IGDB-O', description: 'Dust: Brown  - Organic',               product_group: 'Dust',   variant: 'Organic' },
  { inventory_id: '15IGDPOWDR-O', description: 'Dust: Powder - Organic',           product_group: 'Dust',   variant: 'Organic' },
]

async function load(flagOn: boolean) {
  if (flagOn) process.env[KEY] = 'true'
  else delete process.env[KEY]
  vi.resetModules()
  const inv = await import('./inventory')
  return { ...inv, catalogue: inv.catalogueFrom(ROWS as never) }
}

describe('suggestOutputs — resolver off (today)', () => {
  it('builds every code from the templates, including ones that do not exist', async () => {
    const { suggestOutputs } = await load(false)
    const got = suggestOutputs('sieving', 'Organic', 'A')
    const sticks = got.find(o => o.productType === 'Heavy Sticks')!
    // 15IGST-O is not in ROWS, but the template emits it regardless and
    // nothing flags it. That is the behaviour the flag replaces.
    expect(sticks.code).toBe('15IGST-O')
    expect(sticks.problem ?? null).toBe(null)
  })

  it('ignores a catalogue while the flag is off', async () => {
    const { suggestOutputs, catalogue } = await load(false)
    const got = suggestOutputs('sieving', 'Organic', 'A', catalogue)
    expect(got.find(o => o.productType === 'Heavy Sticks')!.code).toBe('15IGST-O')
  })
})

describe('suggestOutputs — resolver on', () => {
  it('returns the real id and the Acumatica description', async () => {
    const { suggestOutputs, catalogue } = await load(true)
    const got = suggestOutputs('sieving', 'Organic', 'A', catalogue)
    const fine = got.find(o => o.productType === 'Fine Leaf')!
    expect(fine.code).toBe('10LGEF-O')
    expect(fine.description).toBe('Sieved Fine Leaf: Export - Organic')
  })

  it('refuses to emit an id that is not stocked, and says so', async () => {
    const { suggestOutputs, catalogue } = await load(true)
    const sticks = suggestOutputs('sieving', 'Organic', 'A', catalogue)
      .find(o => o.productType === 'Heavy Sticks')!
    expect(sticks.code).toBe(null)
    expect(sticks.problem).toContain('15IGST-O')
    expect(sticks.problem).toContain('not in the master inventory')
  })

  it('keeps an unresolved output in the list rather than dropping it', async () => {
    // The picker filters on `code || problem`. If a missing code silently
    // removed the row, the operator would find the output simply absent with
    // no reason given — worse than a blank code.
    const { suggestOutputs, catalogue } = await load(true)
    const got = suggestOutputs('sieving', 'Organic', 'A', catalogue)
    const shown = got.filter(o => o.code || o.problem).map(o => o.productType)
    expect(shown).toContain('Heavy Sticks')
  })

  it('still drops a product that legitimately has no Acumatica item', async () => {
    // Bucket Elevator Spillage is captured for mass balance and never booked
    // into stock. No code and no problem — it should not reach the picker.
    const { suggestOutputs, catalogue } = await load(true)
    const spill = suggestOutputs('sieving', 'Organic', 'A', catalogue)
      .find(o => o.productType === 'Bucket Elevator Spillage')!
    expect(spill.code).toBe(null)
    expect(spill.problem ?? null).toBe(null)
  })

  it('finds the Organic block despite the drifted variant column', async () => {
    // 15IGBL-C-O is filed as Conventional in the synced data.
    const { suggestOutputs, catalogue } = await load(true)
    const blocks = suggestOutputs('sieving', 'Organic', 'A', catalogue)
      .find(o => o.productType === 'RB Blocks')!
    expect(blocks.code).toBe('15IGBL-C-O')
  })

  it('falls back to the templates when there is no catalogue yet', async () => {
    // The catalogue is a network read; until it lands, capture must behave
    // exactly as it does today rather than showing every output as missing.
    const { suggestOutputs } = await load(true)
    const got = suggestOutputs('sieving', 'Organic', 'A', null)
    expect(got.find(o => o.productType === 'Heavy Sticks')!.code).toBe('15IGST-O')
  })
})
