/**
 * acumatica-items — resolve a floor product to a real item in the synced
 * master inventory, instead of constructing an id from a template.
 *
 * The only public surface of this feature (ARCHITECTURE.md §3). Everything
 * else in the folder is private.
 *
 *     const catalogue = await loadCatalogue()
 *     const r = resolveItem(catalogue, { productType: 'Heavy Sticks', variant: 'CON', grade: 'A' })
 *     switch (r.kind) {
 *       case 'resolved':        // r.item.inventoryId is guaranteed to exist
 *       case 'not-stocked':     // r.availableVariants says what does exist
 *       case 'no-item':         // deliberately has no code
 *       case 'unknown-product': // needs adding to stems.ts
 *       case 'bad-input':       // caller passed a variant/grade we don't know
 *     }
 *
 * NOT yet wired into capture. lib/production/acumatica-codes.ts is still the
 * live path; this ships alongside it so the two can be compared on real data
 * before anything switches over.
 */
import { getDb } from '@/lib/supabase/db'
import { buildCatalogue, type Catalogue, type InventoryRow } from './catalogue'

export type { Catalogue, CatalogueItem, InventoryRow, VariantCode } from './catalogue'
export {
  buildCatalogue, variantCodeOf, variantCodeForWord, stemOf, variantsOf,
  VARIANT_BY_SUFFIX,
} from './catalogue'
export {
  resolveItem, resolveInputItem, resolvedId, explain, assertNeverResolution,
  type ItemResolution, type ResolveQuery,
} from './resolve'
export { STEMS, INPUT_STEMS } from './stems'

let cached: Catalogue | null = null

/**
 * Load and index the master inventory. Cached for the page's lifetime — it is
 * ~630 rows and every capture keystroke would otherwise hit the network.
 *
 * Mirrors loadAllInventory() in lib/production/inventory.ts deliberately: that
 * one stays the loader for the item PICKER, this one for code RESOLUTION, and
 * they are merged only once the picker moves over too.
 */
export async function loadCatalogue(force = false): Promise<Catalogue> {
  if (cached && !force) return cached
  const { data } = await getDb().schema('production').from('inventory_items')
    .select('inventory_id, description, product_group, variant')
    .eq('active', true)
    .order('inventory_id')
  cached = buildCatalogue((data as InventoryRow[]) ?? [])
  return cached
}

/** Drop the cache — after an inventory sync, or in a test. */
export function clearCatalogueCache(): void {
  cached = null
}
