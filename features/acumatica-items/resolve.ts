/**
 * Resolve a floor product to a real Acumatica item.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * lib/production/acumatica-codes.ts does not look anything up. It CONSTRUCTS an
 * id from a template keyed on an exact display string:
 *
 *     if (productType === 'Rolsiev Sticks') return { inventoryId: `15IGST${vs}` }
 *
 * For a system whose master inventory and BOMs are synced from Acumatica
 * continuously, that is backwards: the app guesses at an answer it could ask
 * for. Three things follow from it, all of them live today —
 *
 *   1. It can return an id that does not exist. 'Export Granules' in RA
 *      Conventional yields 20BGGE-001-RC; the master inventory has no such
 *      item (only 20BGGE-002-RC). A bag ships with a code Acumatica will
 *      reject on import, and nothing in the app says so.
 *   2. It cannot tell "no code" from "wrong name". Anything unmatched falls
 *      through to `return null`, so a renamed product and a genuine waste
 *      stream are indistinguishable — both just produce a blank field.
 *   3. 65 of its descriptions no longer match the ones in Acumatica.
 *
 * ── The rule here ───────────────────────────────────────────────────────────
 *
 * Never emit an id that is not in the catalogue. When the item is missing, say
 * which stem was looked for and which variants of it DO exist, so the answer is
 * actionable instead of blank. Every outcome is a distinct variant of one
 * discriminated union, so a caller that forgets one fails to compile rather
 * than falling into a default branch at a printer.
 */
import { canonicalProductType } from '@/lib/core/product-names'
import {
  type Catalogue, type CatalogueItem, type VariantCode,
  SUFFIX_BY_SHORT_VARIANT, variantsOf,
} from './catalogue'
import { STEMS, STEM_ALIASES, INPUT_STEMS } from './stems'

export interface ResolveQuery {
  /** Floor product name, in any spelling — folded before lookup. */
  productType: string
  /** Short variant label: 'CON' | 'ORG' | 'RA CON' | 'RA ORG' | 'FT CON' | 'FT ORG'. */
  variant: string
  /** Destination grade letter: 'A' | 'B' | 'C'. Only the leaf items use it. */
  grade: string
}

export type ItemResolution =
  /** Found. `item` is a row that exists in the synced master inventory. */
  | { kind: 'resolved'; item: CatalogueItem; phantomId: string | null; product: string }
  /** No Acumatica item exists for this product on purpose (waste, WIP, blends). */
  | { kind: 'no-item'; product: string; reason: string }
  /** The product is known but not stocked in this variant/grade. */
  | { kind: 'not-stocked'; product: string; stem: string; wantedId: string; availableVariants: readonly string[] }
  /** The product name is not in the stem table at all. */
  | { kind: 'unknown-product'; product: string }
  /** The variant or grade is not one this resolver knows. */
  | { kind: 'bad-input'; product: string; reason: string }

/** Exhaustiveness guard — see ARCHITECTURE.md §2. */
export function assertNeverResolution(x: never): never {
  throw new Error(`Unhandled item resolution: ${JSON.stringify(x)}`)
}

function suffixFor(variant: string): VariantCode | null {
  return SUFFIX_BY_SHORT_VARIANT[String(variant ?? '').trim().toUpperCase()] ?? null
}

/** Resolve one production output to its Acumatica item. */
export function resolveItem(catalogue: Catalogue, q: ResolveQuery): ItemResolution {
  const canonical = canonicalProductType(q.productType)
  const product = STEM_ALIASES[canonical] ?? canonical
  if (!product) return { kind: 'bad-input', product: '', reason: 'No product type given.' }

  const rule = STEMS[product]
  if (!rule) return { kind: 'unknown-product', product }
  if (rule.noItem) return { kind: 'no-item', product, reason: rule.noItem }

  const grade = String(q.grade ?? '').trim().toUpperCase()
  const stem = typeof rule.stem === 'function' ? rule.stem(grade) : rule.stem
  if (!stem) {
    return { kind: 'bad-input', product, reason: `${product} is graded, and '${q.grade}' is not a grade (expected A, B or C).` }
  }

  const code = suffixFor(q.variant)
  if (!code) {
    return { kind: 'bad-input', product, reason: `'${q.variant}' is not a variant this resolver knows.` }
  }

  const wantedId = `${stem}-${code}`
  const item = catalogue.byId.get(wantedId.toUpperCase())
  if (item) {
    const phantom = rule.phantom?.(grade) ?? null
    // A phantom that isn't in the catalogue is reported as absent rather than
    // passed on — the production order is raised against it.
    const phantomId = phantom && catalogue.byId.has(`${phantom}-${code}`.toUpperCase())
      ? `${phantom}-${code}`
      : null
    return { kind: 'resolved', item, phantomId, product }
  }

  return {
    kind: 'not-stocked',
    product,
    stem,
    wantedId,
    availableVariants: variantsOf(catalogue, stem).map(i => i.variant ?? i.inventoryId),
  }
}

/** Resolve the farm-bag raw material consumed at Sieving. */
export function resolveInputItem(catalogue: Catalogue, grade: string, variant: string): ItemResolution {
  const g = String(grade ?? '').trim().toUpperCase()
  const stem = INPUT_STEMS[g]
  const product = `Raw Material Dry (${g || '?'})`
  if (!stem) return { kind: 'bad-input', product, reason: `'${grade}' is not a grade (expected A, B or C).` }

  const code = suffixFor(variant)
  if (!code) return { kind: 'bad-input', product, reason: `'${variant}' is not a variant this resolver knows.` }

  const wantedId = `${stem}-${code}`
  const item = catalogue.byId.get(wantedId.toUpperCase())
  if (item) return { kind: 'resolved', item, phantomId: null, product }
  return {
    kind: 'not-stocked', product, stem, wantedId,
    availableVariants: variantsOf(catalogue, stem).map(i => i.variant ?? i.inventoryId),
  }
}

/**
 * The id to send to Acumatica, or null when there is not one.
 *
 * A convenience for the many call sites that only need the code — but note it
 * flattens four different reasons into one null, which is exactly the failure
 * mode this module exists to remove. Prefer switching on the resolution and
 * telling the operator which of the four happened.
 */
export function resolvedId(r: ItemResolution): string | null {
  return r.kind === 'resolved' ? r.item.inventoryId : null
}

/** A short line an operator can act on, for every outcome. */
export function explain(r: ItemResolution): string {
  switch (r.kind) {
    case 'resolved':
      return `${r.item.inventoryId} — ${r.item.description}`
    case 'no-item':
      return `${r.product}: no Acumatica item. ${r.reason}`
    case 'not-stocked':
      return r.availableVariants.length
        ? `${r.product}: ${r.wantedId} is not in the master inventory. It exists in ${r.availableVariants.join(', ')}.`
        : `${r.product}: ${r.wantedId} is not in the master inventory, and neither is any other variant of ${r.stem}.`
    case 'unknown-product':
      return `${r.product}: not mapped to an Acumatica item. Add it to features/acumatica-items/stems.ts.`
    case 'bad-input':
      return `${r.product}: ${r.reason}`
    default:
      return assertNeverResolution(r)
  }
}
