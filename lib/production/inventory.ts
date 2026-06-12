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
import { variantToShort, PRODUCTION_ORDER_PREFIXES, SECTION_OUTPUT_GROUPS, leafFamily } from '@/lib/production/capture-config'
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
export function suggestOutputs(sectionId: string, variantWord: string, grade: string = 'A'): SuggestedItem[] {
  const cfg = SECTION_CONFIG[sectionId]
  if (!cfg) return []
  const vShort = variantToShort(variantWord as any)
  return cfg.outputTypes.map((type, i) => {
    const acu = getAcumaticaCode(type, vShort, grade)
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
 * The section's bagged outputs, straight from the master inventory — filtered to
 * the production's variant and (for Leaf) the chosen destination. Guarantees the
 * code + name match Acumatica exactly. Leaf items are batch-tracked; the rest are
 * tracked by barcode only.
 */
export interface OutputItem { code: string; description: string; group: string; batchTracked: boolean }
export function sectionOutputItems(all: InventoryItem[], sectionId: string, variantWord: string, gradeLetter: string): OutputItem[] {
  const groups = SECTION_OUTPUT_GROUPS[sectionId] ?? []
  if (!groups.length || !variantWord) return []
  const leafRe = new RegExp(`^10LG${leafFamily(gradeLetter)}[FC]`)
  return all
    .filter(it => {
      if (it.variant !== variantWord) return false
      const g = it.product_group ?? ''
      if (!groups.includes(g)) return false
      if (g === 'Leaf') return leafRe.test(it.inventory_id)
      return true
    })
    .map(it => ({ code: it.inventory_id, description: it.description ?? it.inventory_id, group: it.product_group ?? '', batchTracked: (it.product_group ?? '') === 'Leaf' }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.code.localeCompare(b.code))
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
 * Recent batch / lot numbers used at this section — for type-ahead suggestions
 * so operators reuse an existing batch instead of re-typing (and risking typos).
 */
export async function recentBatches(sectionId: string): Promise<string[]> {
  const { data } = await getDb().schema('production').from('bag_tags')
    .select('lot_number').eq('section_id', sectionId).not('lot_number', 'is', null)
    .order('created_at', { ascending: false }).limit(150)
  const seen = new Set<string>(); const out: string[] = []
  ;(data ?? []).forEach((r: any) => {
    const l = (r.lot_number ?? '').trim()
    if (l && l !== 'NOT TRACKED' && !seen.has(l)) { seen.add(l); out.push(l) }
  })
  return out.slice(0, 40)
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
