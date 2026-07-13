/**
 * Blender BOM (bill of materials) helpers — reads production.bom_components,
 * the table the new Blends page edits. Blender capture calls these directly
 * (no cache), so an edit on the Blends page is visible to capture immediately.
 */
import { getDb } from '@/lib/supabase/db'
import { BLENDER_INPUT_COLUMNS } from '@/lib/production/live-types'
import type { Variant as DbVariant } from '@/lib/supabase/database.types'

export interface BlenderBomSummary {
  bomId: string
  outputItemId: string
  outputDescription: string | null
  workCentre: string
  variant: DbVariant | null   // resolved from Master Inventory, null if the item isn't found there
  itemFound: boolean          // false = output_item_id doesn't currently resolve in inventory_items
  componentCount: number
}

export interface BlendComponent {
  id: string
  bomId: string
  lineNbr: number
  componentItemId: string
  componentDescription: string | null
  qtyRequired: number   // fraction 0..1
  column: string         // 'A'..'F', derived from componentDescription
  itemFound: boolean
}

// ── Ingredient column matching ────────────────────────────────────────────────
// Reuses the same keys the Blender section config already defines for its input
// types (lib/production/live-types.ts) so capture and the Blends page agree on
// what "column A" etc. means. Longest key first so e.g. "Cut Heavy Stick Coarse"
// matches before the shorter "Coarse Leaf" style substrings could confuse it.
const COLUMN_KEYS = Object.keys(BLENDER_INPUT_COLUMNS).sort((a, b) => b.length - a.length)

export function matchColumn(description: string | null | undefined): string {
  const d = (description ?? '').toLowerCase()
  for (const key of COLUMN_KEYS) {
    if (d.includes(key.toLowerCase())) return BLENDER_INPUT_COLUMNS[key]
  }
  return 'F'   // Other — unmatched components still get released, just under "Other"
}

// ── Variant derivation from an Acumatica item code suffix ────────────────────
// Used only as a fallback when the item isn't in inventory_items yet (itemFound
// false) so the picker still has something reasonable to filter/display by.
function variantFromSuffix(itemId: string): DbVariant | null {
  if (itemId.endsWith('-RO')) return 'RA-Organic'
  if (itemId.endsWith('-RC')) return 'RA-Conventional'
  if (itemId.endsWith('-FO')) return 'FT-ORG'
  if (itemId.endsWith('-FC')) return 'FT-CON'
  if (itemId.endsWith('-O'))  return 'Organic'
  if (itemId.endsWith('-C'))  return 'Conventional'
  return null
}

/**
 * All distinct blend BOMs, optionally filtered to one variant (matched against
 * the output item's row in Master Inventory when it exists, else derived from
 * the item code's suffix). Used by the Assign screen's blend-code picker.
 */
export async function listBlenderBoms(variantWord?: string | null): Promise<BlenderBomSummary[]> {
  const db = getDb()
  const { data: rows } = await db.schema('production').from('bom_components')
    .select('bom_id, output_item_id, output_description, work_centre')
    .order('bom_id')
  const all = (rows as any[]) ?? []

  const byBom = new Map<string, { outputItemId: string; outputDescription: string | null; workCentre: string; count: number }>()
  for (const r of all) {
    const existing = byBom.get(r.bom_id)
    if (existing) { existing.count += 1; continue }
    byBom.set(r.bom_id, { outputItemId: r.output_item_id, outputDescription: r.output_description, workCentre: r.work_centre, count: 1 })
  }

  const outputIds = Array.from(new Set(Array.from(byBom.values()).map(v => v.outputItemId)))
  const { data: items } = outputIds.length
    ? await db.schema('production').from('inventory_items').select('inventory_id, variant').in('inventory_id', outputIds)
    : { data: [] as any[] }
  const itemMap = new Map((items as any[] ?? []).map(it => [it.inventory_id, it.variant as DbVariant]))

  const summaries: BlenderBomSummary[] = Array.from(byBom.entries()).map(([bomId, v]) => {
    const foundVariant = itemMap.get(v.outputItemId)
    return {
      bomId, outputItemId: v.outputItemId, outputDescription: v.outputDescription, workCentre: v.workCentre,
      variant: foundVariant ?? variantFromSuffix(v.outputItemId),
      itemFound: itemMap.has(v.outputItemId),
      componentCount: v.count,
    }
  })

  if (!variantWord) return summaries
  return summaries.filter(s => s.variant === variantWord)
}

/**
 * The components for one BOM, each tagged with its ingredient column. This is
 * the "release only the right materials" mechanism — Blender capture renders
 * exactly the columns present here, nothing else.
 */
export async function getBlendComponents(bomId: string): Promise<BlendComponent[]> {
  if (!bomId) return []
  const db = getDb()
  const { data: rows } = await db.schema('production').from('bom_components')
    .select('id, bom_id, line_nbr, component_item_id, component_description, qty_required, ingredient_column')
    .eq('bom_id', bomId).order('line_nbr')
  const all = (rows as any[]) ?? []
  if (!all.length) return []

  const componentIds = Array.from(new Set(all.map(r => r.component_item_id)))
  const { data: items } = await db.schema('production').from('inventory_items').select('inventory_id').in('inventory_id', componentIds)
  const found = new Set((items as any[] ?? []).map(it => it.inventory_id))

  return all.map(r => ({
    id: r.id, bomId: r.bom_id, lineNbr: r.line_nbr,
    componentItemId: r.component_item_id, componentDescription: r.component_description,
    qtyRequired: Number(r.qty_required) || 0,
    // Stored value wins (set on the Blends page when the auto-match is wrong);
    // falls back to a fresh description match for rows that predate the column.
    column: r.ingredient_column || matchColumn(r.component_description),
    itemFound: found.has(r.component_item_id),
  }))
}

/** Ingredient columns present in a BOM, grouped, for the capture screen. */
export interface BlendColumnGroup {
  column: string
  label: string
  targetPct: number   // sum of qtyRequired for this column, as a fraction
  allowedTypes: string[]   // component descriptions, for validateBagScan's allowedTypes
  hasLot: boolean          // Fine Leaf / Coarse Leaf columns track a lot number, per the paper form
}

export function groupComponentsByColumn(components: BlendComponent[]): BlendColumnGroup[] {
  const byCol = new Map<string, BlendComponent[]>()
  for (const c of components) {
    const list = byCol.get(c.column) ?? []
    list.push(c)
    byCol.set(c.column, list)
  }
  const LABELS: Record<string, string> = {
    A: 'Fine Leaf', B: 'Coarse Leaf', C: 'Blocks Clean', D: 'Blocks / Cut Heavy Stick', E: 'Granules', F: 'Other',
  }
  return Array.from(byCol.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([column, comps]) => ({
      column,
      label: LABELS[column] ?? column,
      targetPct: comps.reduce((s, c) => s + c.qtyRequired, 0),
      allowedTypes: Array.from(new Set(comps.map(c => c.componentDescription).filter(Boolean) as string[])),
      hasLot: column === 'A' || column === 'B',
    }))
}
