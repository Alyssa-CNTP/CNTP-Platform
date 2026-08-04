/**
 * Dust "Carry-over" ledger (production.dust_carryover_log) — see
 * supabase/migrations/20260804_002_dust_carryover.sql for the schema and why
 * this is an append-only ledger rather than a single mutable balance row.
 *
 * A leftover is 'generated' when a shift's mass balance shows dust unaccounted
 * for (the afternoon shutdown, on the Granule Line today), and 'consumed' when
 * a later shift adds it into a blend as an input. The outstanding balance for
 * an (section_id, item_key) pair is simply generated minus consumed — never
 * summed across different item_keys, so SG Dust and SF Dust carry-over never mix.
 */
import { getDb } from '@/lib/supabase/db'

export interface CarryoverEntry {
  sectionId: string
  itemKey: string
  kg: number
  date: string
  shift: string
  sessionId?: string | null
  note?: string
}

export async function logCarryover(kind: 'generated' | 'consumed', e: CarryoverEntry): Promise<void> {
  if (e.kg <= 0) return
  await getDb().schema('production').from('dust_carryover_log').insert({
    section_id: e.sectionId, item_key: e.itemKey, kind, kg: e.kg,
    date: e.date, shift: e.shift, session_id: e.sessionId ?? null, note: e.note ?? null,
  } as any)
}

/** Outstanding balance for one section + exact dust type (generated − consumed). */
export async function outstandingCarryover(sectionId: string, itemKey: string): Promise<number> {
  const { data } = await getDb().schema('production').from('dust_carryover_log')
    .select('kind, kg').eq('section_id', sectionId).eq('item_key', itemKey)
  let balance = 0
  ;((data as any[]) ?? []).forEach(r => { balance += r.kind === 'generated' ? Number(r.kg) || 0 : -(Number(r.kg) || 0) })
  return Math.max(0, Math.round(balance * 10) / 10)
}
