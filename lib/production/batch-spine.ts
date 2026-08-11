// Server-only helper for joining a raw lot/batch string into the canonical
// batch spine (production.batches, see supabase/migrations/20260721_002_batch_spine.sql).
// Used by job-card approval routes — this is the moment a batch number becomes
// final, so it's when the card should join the spine, not on every draft save.

import { getAdminClient } from '@/lib/auth/server-helpers'
import { normalizeBatch } from './batch-key'

/**
 * Resolves rawBatchNumber to a production.batches row, creating one if none
 * exists yet for its normalized key. Returns null if rawBatchNumber is
 * blank/unusable. Race-safe: if a concurrent request creates the same
 * batch_key between our lookup and insert, falls back to re-selecting it
 * rather than erroring (batch_key is UNIQUE).
 */
export async function resolveBatchId(
  rawBatchNumber: string | null | undefined,
  firstSection: string,
): Promise<string | null> {
  const key = normalizeBatch(rawBatchNumber)
  if (!key) return null

  const admin = getAdminClient() as any
  const { data: existing } = await admin.schema('production').from('batches')
    .select('id').eq('batch_key', key).maybeSingle()
  if (existing?.id) return existing.id

  const { data: created, error } = await admin.schema('production').from('batches')
    .insert({ batch_key: key, display_lot: rawBatchNumber, first_section: firstSection } as any)
    .select('id').maybeSingle()
  if (created?.id) return created.id

  if (error) {
    const { data: retry } = await admin.schema('production').from('batches')
      .select('id').eq('batch_key', key).maybeSingle()
    return retry?.id ?? null
  }
  return null
}
