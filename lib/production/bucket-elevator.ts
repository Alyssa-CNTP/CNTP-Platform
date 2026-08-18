/**
 * Sieving Tower bucket-elevator carry-over ledger
 * (production.bucket_elevator_log) — see
 * supabase/migrations/20260818_003_bucket_elevator_carryover.sql for the
 * schema and why this is an append-only ledger rather than a single mutable
 * balance row.
 *
 * The afternoon shift leaves material in the elevator for tomorrow —
 * that's 'generated'. The following morning shift consumes it — that's
 * 'consumed'. The outstanding balance for a variant family is simply
 * generated minus consumed — never summed across conventional and organic,
 * so the two never mix.
 */
import { getDb } from '@/lib/supabase/db'
import { isOrganicVariant } from '@/lib/production/capture-config'

export type VariantFamily = 'conventional' | 'organic'

export function variantFamily(variant: string | null | undefined): VariantFamily {
  return isOrganicVariant(variant) ? 'organic' : 'conventional'
}

export interface BucketElevatorEntry {
  sectionId: string
  variantFamily: VariantFamily
  kg: number
  date: string
  shift: string
  sessionId?: string | null
  note?: string
}

export async function logBucketElevator(kind: 'generated' | 'consumed', e: BucketElevatorEntry): Promise<void> {
  if (e.kg <= 0) return
  await getDb().schema('production').from('bucket_elevator_log').insert({
    section_id: e.sectionId, variant_family: e.variantFamily, kind, kg: e.kg,
    date: e.date, shift: e.shift, session_id: e.sessionId ?? null, note: e.note ?? null,
  } as any)
}

/** Outstanding balance for one section + variant family (generated − consumed). */
export async function outstandingBucketElevator(sectionId: string, family: VariantFamily): Promise<number> {
  const { data } = await getDb().schema('production').from('bucket_elevator_log')
    .select('kind, kg').eq('section_id', sectionId).eq('variant_family', family)
  let balance = 0
  ;((data as any[]) ?? []).forEach(r => { balance += r.kind === 'generated' ? Number(r.kg) || 0 : -(Number(r.kg) || 0) })
  return Math.max(0, Math.round(balance * 10) / 10)
}
