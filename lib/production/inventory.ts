/**
 * Inventory + AI helpers for capture.
 *
 * Principle: don't drown the operator in 630 items. By default we surface only
 * the handful of items that fit the active section + variant (derived from the
 * known material→output flow). Full-list search hits the DB only when the
 * operator explicitly looks for something else.
 */
import { getDb } from '@/lib/supabase/db'
import { getAcumaticaCode } from '@/lib/production/acumatica-codes'
import { variantToShort, PRODUCTION_ORDER_PREFIXES } from '@/lib/production/capture-config'
import { SECTION_CONFIG } from '@/lib/production/live-types'
import type { InventoryItem } from '@/lib/supabase/database.types'

export interface SuggestedItem {
  productType: string
  code: string | null      // Acumatica inventory id (derived)
  description: string
  isLeaf: boolean
  match: number            // 0–100 relevance, for display
}

const LEAF = new Set(['Fine Leaf', 'Coarse Leaf'])

/**
 * The short, relevant output list for a section + variant — the default the
 * picker shows. Derived from the section's known output types (no DB needed,
 * instant). Ranked so the most common outputs sit first.
 */
export function suggestOutputs(sectionId: string, variantWord: string): SuggestedItem[] {
  const cfg = SECTION_CONFIG[sectionId]
  if (!cfg) return []
  const vShort = variantToShort(variantWord as any)
  return cfg.outputTypes.map((type, i) => {
    const acu = getAcumaticaCode(type, vShort, 'A')
    return {
      productType: type,
      code: acu?.inventoryId ?? null,
      description: acu?.description ?? type,
      isLeaf: LEAF.has(type),
      // Earlier in the list = more common for the section → higher match.
      match: Math.max(60, 95 - i * 6),
    }
  })
}

/**
 * Load the full master list ONCE and cache it. It's small (~630 rows), so we
 * filter in memory per keystroke rather than hitting the DB on every character
 * — instant refinement, no network races.
 */
let _cache: InventoryItem[] | null = null
export async function loadAllInventory(): Promise<InventoryItem[]> {
  if (_cache) return _cache
  const { data } = await getDb().schema('production').from('inventory_items')
    .select('*').eq('active', true).order('inventory_id')
  _cache = (data as InventoryItem[]) ?? []
  return _cache
}

/** Client-side filter — refines as the operator types. */
export function filterInventory(all: InventoryItem[], query: string, variantWord?: string): InventoryItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const matched = all.filter(it =>
    it.inventory_id.toLowerCase().includes(q) ||
    (it.description ?? '').toLowerCase().includes(q))
  // Same-variant items first.
  matched.sort((a, b) => (b.variant === variantWord ? 1 : 0) - (a.variant === variantWord ? 1 : 0))
  return matched.slice(0, 30)
}

/**
 * The production-order target items for a section + variant — the phantom /
 * final items a PO is created against (e.g. Sieving → S10LG* leaf phantoms).
 * Filtered from the already-loaded master list.
 */
export function productionOrderItems(all: InventoryItem[], sectionId: string, variantWord: string): InventoryItem[] {
  const prefixes = PRODUCTION_ORDER_PREFIXES[sectionId] ?? []
  if (!prefixes.length || !variantWord) return []
  return all
    .filter(it => it.variant === variantWord && prefixes.some(p => it.inventory_id.startsWith(p)))
    .sort((a, b) => a.inventory_id.localeCompare(b.inventory_id))
}

/**
 * Next-step nudge — a gentle prompt about what's likely missing. Rule-based.
 */
export function nextStepNudge(sectionId: string, hasByType: Record<string, number>): string | null {
  const has = (t: string) => (hasByType[t] ?? 0) > 0
  if (sectionId === 'sieving') {
    if (has('Fine Leaf') && !has('Coarse Leaf')) return 'Fine Leaf bagged — no Coarse Leaf yet. Expected for this run?'
    if (Object.keys(hasByType).length === 0)     return 'No output bagged yet — add your first bag as material comes off the line.'
  }
  return null
}
