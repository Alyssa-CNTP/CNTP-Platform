/**
 * The master inventory, indexed. Pure — the rows come in as an argument.
 *
 * production.inventory_items is synced from Acumatica, so it is the authority
 * on what items exist. Nothing here invents an id.
 */

/** Variants as the id suffix spells them. */
export type VariantCode = 'C' | 'O' | 'RC' | 'RO' | 'FC' | 'FO'

/** Variant word (as Acumatica writes it) ↔ id suffix. */
export const VARIANT_BY_SUFFIX: Readonly<Record<VariantCode, string>> = {
  C:  'Conventional',
  O:  'Organic',
  RC: 'RA-Conventional',
  RO: 'RA-Organic',
  FC: 'FT-Conventional',
  FO: 'FT-Organic',
}

/** The platform's short variant labels → the id suffix. */
export const SUFFIX_BY_SHORT_VARIANT: Readonly<Record<string, VariantCode>> = {
  'CON':    'C',
  'ORG':    'O',
  'RA CON': 'RC',
  'RA ORG': 'RO',
  'FT CON': 'FC',
  'FT ORG': 'FO',
}

/**
 * Any spelling of a variant → its id suffix.
 *
 * There are THREE vocabularies for the same six variants and they do not agree:
 *
 *   inventory_items.variant   'Conventional' … 'FT-Conventional', 'FT-Organic'
 *   app DbVariant             'Conventional' … 'FT-CON', 'FT-ORG'
 *   short labels in the UI    'CON', 'ORG', 'RA CON', 'RA ORG', 'FT CON', 'FT ORG'
 *
 * They line up for the four common variants and diverge on Fairtrade, so a
 * direct string comparison between an item row and an app variant silently
 * never matches for FT. Comparing CODES instead is immune to all three.
 */
const CODE_BY_WORD: Readonly<Record<string, VariantCode>> = {
  // inventory_items.variant
  'conventional': 'C', 'organic': 'O',
  'ra-conventional': 'RC', 'ra-organic': 'RO',
  'ft-conventional': 'FC', 'ft-organic': 'FO',
  // app DbVariant
  'ft-con': 'FC', 'ft-org': 'FO',
  // short labels
  'con': 'C', 'org': 'O', 'ra con': 'RC', 'ra org': 'RO',
  'ft con': 'FC', 'ft org': 'FO',
}

/** The variant code for a variant written in any of the three vocabularies. */
export function variantCodeForWord(word: string | null | undefined): VariantCode | null {
  const k = String(word ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  return k ? (CODE_BY_WORD[k] ?? null) : null
}

/** Longest first, so '-RC' is tested before '-C'. */
const SUFFIXES: readonly VariantCode[] = ['RC', 'RO', 'FC', 'FO', 'C', 'O']

/**
 * The variant an item id encodes.
 *
 * Read from the id, NOT from the row's `variant` column. Eight rows in the
 * synced master inventory disagree with their own id — 15IGBL-C-O ("Blocks:
 * Clean - Organic") is filed as Conventional, and so are its RA siblings.
 * Anything that filters on the column drops Blocks out of the Organic and RA
 * pickers entirely, which is a live bug on the floor today. The id is the key
 * Acumatica actually matches on, so the id wins.
 */
export function variantCodeOf(inventoryId: string): VariantCode | null {
  const id = String(inventoryId ?? '').toUpperCase()
  for (const s of SUFFIXES) if (id.endsWith(`-${s}`)) return s
  return null
}

/** The id with its variant suffix removed — '15IGST-RC' → '15IGST'. */
export function stemOf(inventoryId: string): string {
  const code = variantCodeOf(inventoryId)
  const id = String(inventoryId ?? '')
  return code ? id.slice(0, -(code.length + 1)) : id
}

export interface CatalogueItem {
  inventoryId: string
  description: string
  productGroup: string | null
  /** From the id suffix — see variantCodeOf. */
  variant: string | null
  variantCode: VariantCode | null
  /** What the row's own `variant` column claims, kept only so drift is visible. */
  declaredVariant: string | null
  /** True when the column and the id disagree. */
  variantDrifted: boolean
}

export interface Catalogue {
  readonly items: readonly CatalogueItem[]
  /** Exact id → item. */
  readonly byId: ReadonlyMap<string, CatalogueItem>
  /** Stem → every variant of it that exists. */
  readonly byStem: ReadonlyMap<string, readonly CatalogueItem[]>
}

/** A master-inventory row, as loaded. Only the fields this module reads. */
export interface InventoryRow {
  inventory_id: string
  description?: string | null
  product_group?: string | null
  variant?: string | null
}

export function buildCatalogue(rows: readonly InventoryRow[]): Catalogue {
  const items: CatalogueItem[] = []
  for (const r of rows ?? []) {
    const inventoryId = String(r?.inventory_id ?? '').trim()
    if (!inventoryId) continue
    const variantCode = variantCodeOf(inventoryId)
    const variant = variantCode ? VARIANT_BY_SUFFIX[variantCode] : null
    const declaredVariant = r.variant ?? null
    items.push({
      inventoryId,
      description: (r.description ?? '').trim() || inventoryId,
      productGroup: r.product_group ?? null,
      variant,
      variantCode,
      declaredVariant,
      variantDrifted: variant !== null && declaredVariant !== null && variant !== declaredVariant,
    })
  }

  const byId = new Map<string, CatalogueItem>()
  const byStem = new Map<string, CatalogueItem[]>()
  for (const it of items) {
    byId.set(it.inventoryId.toUpperCase(), it)
    const stem = stemOf(it.inventoryId).toUpperCase()
    const list = byStem.get(stem)
    if (list) list.push(it)
    else byStem.set(stem, [it])
  }

  return { items, byId, byStem }
}

/** Every item sharing a stem, whatever their variant. */
export function variantsOf(catalogue: Catalogue, stem: string): readonly CatalogueItem[] {
  return catalogue.byStem.get(String(stem ?? '').toUpperCase()) ?? []
}
