/**
 * acumatica-items — resolve a floor product to a real item in the synced
 * master inventory, instead of constructing an id from a template.
 *
 * The only public surface of this feature (ARCHITECTURE.md §3). Everything
 * else in the folder is private.
 *
 *     const catalogue = buildCatalogue(rowsTheCallerAlreadyHas)
 *     const r = resolveItem(catalogue, { productType: 'Heavy Sticks', variant: 'CON', grade: 'A' })
 *     switch (r.kind) {
 *       case 'resolved':        // r.item.inventoryId is guaranteed to exist
 *       case 'not-stocked':     // r.availableVariants says what does exist
 *       case 'no-item':         // deliberately has no code
 *       case 'unknown-product': // needs adding to stems.ts
 *       case 'bad-input':       // caller passed a variant/grade we don't know
 *     }
 *
 * Wired into capture behind NEXT_PUBLIC_FF_ACUMATICA_RESOLVER. With the flag
 * off, lib/production/acumatica-codes.ts remains the live path and nothing
 * changes; the changeover is owned by lib/production/use-item-codes.ts, not by
 * this feature — a feature that reaches back into the code it replaces can
 * never be finished.
 */
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

/**
 * This feature performs NO I/O. The caller supplies the rows.
 *
 * It used to own a loadCatalogue() that queried inventory_items itself. That
 * was a mistake with a measurable cost: lib/production/inventory.ts already
 * caches exactly those rows via loadAllInventory(), so a Refining capture
 * screen fetched the same ~630-row table TWICE on every load — once for the
 * item picker, once for code resolution. A feature is not allowed to make a
 * core screen slower.
 *
 * The fetch was there to dodge an import cycle (inventory.ts imports this
 * feature). Taking the rows as an argument removes the cycle AND the second
 * read, and leaves this module pure and unit-testable with no mocks — the same
 * reason lib/core may not perform I/O (ARCHITECTURE.md §2).
 *
 * The app owns loading: see lib/production/use-item-codes.ts.
 */
