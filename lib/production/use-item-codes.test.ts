import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { Catalogue } from '@/features/acumatica-items'

/**
 * The reliability contract for the resolver adapter.
 *
 * useItemCodes() is a HOOK, called by the capture page itself, so
 * <FeatureBoundary> cannot protect it — an error boundary catches a throw from
 * a child during render, not one from a hook the page called. If the resolver
 * threw, an operator mid-shift would lose the screen with a half-captured
 * session behind it.
 *
 * These tests pin the property that makes that impossible: every resolver call
 * degrades to the template path, which is the behaviour that shipped for
 * months. Losing the stricter warnings is recoverable. Losing the screen is not.
 */

const KEY = 'NEXT_PUBLIC_FF_ACUMATICA_RESOLVER'
const original = process.env[KEY]

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })

afterEach(() => {
  if (original === undefined) delete process.env[KEY]
  else process.env[KEY] = original
  vi.resetModules()
  vi.restoreAllMocks()
})

async function load(flagOn: boolean) {
  if (flagOn) process.env[KEY] = 'true'
  else delete process.env[KEY]
  vi.resetModules()
  return import('./use-item-codes')
}

/** A catalogue that throws the moment the resolver touches it. */
const HOSTILE = {
  items: [],
  get byId(): never { throw new Error('catalogue exploded') },
  byStem: new Map(),
} as unknown as Catalogue

/** A catalogue holding exactly one real item. */
async function realCatalogue(): Promise<Catalogue> {
  const { buildCatalogue } = await import('@/features/acumatica-items')
  return buildCatalogue([
    { inventory_id: '15IGST-C', description: 'Sticks - Conventional', product_group: 'Sticks', variant: 'Conventional' },
  ])
}

describe('the resolver cannot take down a capture screen', () => {
  it('falls back to the template instead of throwing', async () => {
    const { itemCodesFrom } = await load(true)
    const codes = itemCodesFrom(HOSTILE)
    // The template answer for Heavy Sticks in Conventional.
    expect(() => codes.codeFor('Heavy Sticks', 'CON', 'A')).not.toThrow()
    expect(codes.codeFor('Heavy Sticks', 'CON', 'A')?.inventoryId).toBe('15IGST-C')
  })

  it('falls back on the input path too', async () => {
    const { itemCodesFrom } = await load(true)
    const codes = itemCodesFrom(HOSTILE)
    expect(codes.inputCodeFor('A', 'CON')?.inventoryId).toBe('05RMDE-C')
  })

  it('invents no warning when the resolver is broken', async () => {
    // A failure must not manufacture an alarming message for the operator.
    // No news is the safe answer; the console line is the record.
    const { itemCodesFrom } = await load(true)
    expect(itemCodesFrom(HOSTILE).problemFor('Heavy Sticks', 'CON', 'A')).toBe(null)
  })

  it('says so on the console rather than swallowing it', async () => {
    // Silent degradation would let capture run on the template path for weeks
    // with nobody knowing why the stricter warnings stopped appearing.
    const { itemCodesFrom } = await load(true)
    itemCodesFrom(HOSTILE).codeFor('Heavy Sticks', 'CON', 'A')
    expect(console.error).toHaveBeenCalled()
  })
})

describe('flag off — nothing changes', () => {
  it('uses the templates and never touches the catalogue', async () => {
    const { itemCodesFrom } = await load(false)
    // HOSTILE would throw if it were read at all.
    const codes = itemCodesFrom(HOSTILE)
    expect(codes.ready).toBe(false)
    expect(codes.source).toBe('template')
    expect(codes.codeFor('Heavy Sticks', 'CON', 'A')?.inventoryId).toBe('15IGST-C')
    expect(codes.problemFor('Nonsense Product', 'CON', 'A')).toBe(null)
  })

  it('treats a missing catalogue as not ready', async () => {
    const { itemCodesFrom } = await load(true)
    const codes = itemCodesFrom(null)
    expect(codes.ready).toBe(false)
    expect(codes.source).toBe('template')
  })
})

describe('flag on with a healthy catalogue', () => {
  it('resolves from the master inventory', async () => {
    const { itemCodesFrom } = await load(true)
    const codes = itemCodesFrom(await realCatalogue())
    expect(codes.ready).toBe(true)
    expect(codes.source).toBe('resolver')
    expect(codes.codeFor('Heavy Sticks', 'CON', 'A')?.description).toBe('Sticks - Conventional')
  })

  it('reports a product the master inventory does not stock', async () => {
    const { itemCodesFrom } = await load(true)
    const codes = itemCodesFrom(await realCatalogue())
    expect(codes.codeFor('Heavy Sticks', 'ORG', 'A')).toBe(null)
    expect(codes.problemFor('Heavy Sticks', 'ORG', 'A')).toContain('15IGST-O')
  })
})

describe('the feature performs no I/O', () => {
  it('exports no loader, so it cannot add a second fetch to a capture screen', async () => {
    // The feature briefly owned a loadCatalogue() that queried inventory_items
    // itself, which made a Refining capture screen read the same ~630-row
    // table twice per load — once for the item picker, once for code
    // resolution. The rows are supplied by the caller now.
    const mod = await import('@/features/acumatica-items')
    expect('loadCatalogue' in mod).toBe(false)
    expect('clearCatalogueCache' in mod).toBe(false)
  })
})
