/**
 * Dust "Carry-over" ledger (production.dust_carryover_log) — see
 * supabase/migrations/20260804_002_dust_carryover.sql for the schema and why
 * this is an append-only ledger rather than a single mutable balance row.
 *
 * A leftover is 'generated' when a shift's mass balance shows dust unaccounted
 * for (the afternoon shutdown, on the Granule Line today), and 'consumed' when
 * a later shift adds it into a blend as an input. The outstanding balance for
 * an (section_id, item_key, variant_family) triple is simply generated minus
 * consumed — never summed across different item_keys, so SG Dust and SF Dust
 * carry-over never mix, and never across variant families, because
 * conventional and organic are separate physical pools (a mix is a
 * certification failure, not a rounding error). See
 * 20260901_002_dust_carryover_variant.sql.
 */
import { getDb } from '@/lib/supabase/db'
import type { VariantFamily } from '@/lib/production/bucket-elevator'

export interface CarryoverEntry {
  sectionId: string
  itemKey: string
  variantFamily: VariantFamily
  kg: number
  date: string
  shift: string
  sessionId?: string | null
  note?: string
}

export async function logCarryover(kind: 'generated' | 'consumed', e: CarryoverEntry): Promise<void> {
  if (e.kg <= 0) return
  await getDb().schema('production').from('dust_carryover_log').insert({
    section_id: e.sectionId, item_key: e.itemKey, variant_family: e.variantFamily,
    kind, kg: e.kg,
    date: e.date, shift: e.shift, session_id: e.sessionId ?? null, note: e.note ?? null,
  } as any)
}

/**
 * Outstanding balance for one section + exact dust type + variant family
 * (generated − consumed). All three are matched exactly; nothing is ever
 * aggregated across them.
 */
export async function outstandingCarryover(
  sectionId: string, itemKey: string, family: VariantFamily,
): Promise<number> {
  const { data } = await getDb().schema('production').from('dust_carryover_log')
    .select('kind, kg')
    .eq('section_id', sectionId).eq('item_key', itemKey).eq('variant_family', family)
  let balance = 0
  ;((data as any[]) ?? []).forEach(r => { balance += r.kind === 'generated' ? Number(r.kg) || 0 : -(Number(r.kg) || 0) })
  return Math.max(0, Math.round(balance * 10) / 10)
}
