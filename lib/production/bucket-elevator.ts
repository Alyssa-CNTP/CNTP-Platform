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
import { variantFamily, type VariantFamily } from '@/lib/core/variants'

/**
 * Re-exported from core so this module's callers keep their import, but the
 * rule itself lives in exactly one place now.
 *
 * It returns `VariantFamily | null` rather than defaulting to 'conventional'.
 * The old local version could not return null: anything that wasn't in a
 * hard-coded organic Set became conventional, including 'ORG' and 'RA-ORG' —
 * the short codes the capture forms send. This ledger is keyed on family
 * precisely so the two pools cannot combine, so a fail-open default here was
 * the one place it mattered most.
 */
export { variantFamily }
export type { VariantFamily }

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
  // The type says this is non-null, but the capture page reaches here through
  // several `as any` casts, so the guard is real. Refusing the write is the
  // safe failure: material stays where it is and someone asks. Filing it under
  // a guessed family would silently pool organic with conventional.
  if (e.variantFamily !== 'conventional' && e.variantFamily !== 'organic') {
    throw new Error(
      `Bucket-elevator carry-over refused: the variant family could not be determined ` +
      `(got ${JSON.stringify(e.variantFamily)}). Material cannot be carried over until the ` +
      `run's variant is recognised — organic and conventional must never share a pool.`,
    )
  }
  await getDb().schema('production').from('bucket_elevator_log').insert({
    section_id: e.sectionId, variant_family: e.variantFamily, kind, kg: e.kg,
    date: e.date, shift: e.shift, session_id: e.sessionId ?? null, note: e.note ?? null,
  } as any)
}

/**
 * Outstanding balance for one section + variant family (generated − consumed).
 *
 * A null family means the run's variant was not recognised, so there is no pool
 * to read. Return 0 — offer no carry-over — rather than falling back to the
 * conventional pool's balance.
 */
export async function outstandingBucketElevator(sectionId: string, family: VariantFamily | null): Promise<number> {
  if (!family) return 0
  const { data } = await getDb().schema('production').from('bucket_elevator_log')
    .select('kind, kg').eq('section_id', sectionId).eq('variant_family', family)
  let balance = 0
  ;((data as any[]) ?? []).forEach(r => { balance += r.kind === 'generated' ? Number(r.kg) || 0 : -(Number(r.kg) || 0) })
  return Math.max(0, Math.round(balance * 10) / 10)
}
