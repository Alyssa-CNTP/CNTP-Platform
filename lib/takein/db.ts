// lib/takein/db.ts
//
// Data access for the raw-material take-in. Two things live here and nowhere
// else: the schema handle, and the depot scope.
//
// DEPOT SCOPE is not a UI convenience. A Graafwater clerk holding every
// permission in the module still only sees Graafwater, because the list they
// query is filtered before it leaves this file. Blackheath and Management hold
// no depot codes at all, which means every depot — they are the consolidation
// view, and farmers do not deliver there.

import { getDb } from '@/lib/supabase/db'
import type { Depot } from './types'

/** The `takein` schema. The default browser client is locked to `production`. */
export function takeinDb() {
  return getDb().schema('takein' as never)
}

/** The shared depot registry lives in `logistics`, so take-in and warehousing
 *  agree on what a depot is rather than keeping two lists. */
export function depotDb() {
  return getDb().schema('logistics' as never)
}

/** A thrown value's message, or `fallback` when it carries none.
 *
 *  `catch (e: any)` is the repo's commonest lint error; this is the same lines
 *  written once so the take-in screens do not add 20 more of them.
 *
 *  IT MUST NOT TEST `instanceof Error`. Supabase throws a PostgrestError, which
 *  is a PLAIN OBJECT — `{ message, details, hint, code }` — so an instanceof
 *  check reports false and the real message is replaced by the generic
 *  fallback. That cost a whole debugging session: every take-in screen said
 *  "Could not load contracts." while PostgREST was actually returning PGRST106,
 *  "the schema must be one of the following", because a new schema had not been
 *  added to the project's exposed-schema list. The code is the diagnosis, so it
 *  is carried through rather than swallowed. */
export function errMsg(e: unknown, fallback: string): string {
  if (typeof e === 'string' && e.trim()) return e.trim()
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; hint?: unknown; code?: unknown }
    const msg  = typeof o.message === 'string' ? o.message.trim() : ''
    const hint = typeof o.hint    === 'string' ? o.hint.trim()    : ''
    const code = typeof o.code    === 'string' ? o.code.trim()    : ''
    const parts = [msg || fallback, hint, code && `[${code}]`].filter(Boolean)
    if (msg || hint || code) return parts.join(' — ')
  }
  return fallback
}

export async function loadDepots(): Promise<Depot[]> {
  const { data, error } = await depotDb()
    .from('warehouses').select('*').eq('active', true).order('code')
  if (error) throw error
  return (data as Depot[]) ?? []
}

/**
 * Which depots may this user see?
 *
 * An EMPTY depot_codes array means every depot. That is deliberate and it is
 * the safe default for this business: Blackheath's lab and Management need the
 * consolidated picture, and a new user who has not been scoped yet is far more
 * likely to be one of those than a depot clerk. A clerk is scoped the moment
 * their account is made, on Users & Access.
 */
export function visibleDepots(depots: Depot[], userDepotCodes: string[] | null | undefined): Depot[] {
  // Trimmed, because a whitespace-only entry is noise rather than a depot. Left
  // untrimmed it is truthy, so it counts as a scope, matches no depot code and
  // silently blanks the user's dashboard — which reads exactly like the module
  // being broken rather than like a bad row.
  const codes = (userDepotCodes ?? []).map(c => (c ?? '').trim()).filter(Boolean)
  if (!codes.length) return depots
  return depots.filter(d => codes.includes(d.code))
}

export function seesDepot(userDepotCodes: string[] | null | undefined, code: string): boolean {
  const codes = (userDepotCodes ?? []).filter(Boolean)
  return !codes.length || codes.includes(code)
}

/** Depots that actually take a farmer delivery — Blackheath does not. */
export const deliveryDepots = (depots: Depot[]) => depots.filter(d => d.takes_farmer_delivery)

// ════════════════════════════════════════════════════════════════════════════
// NUMBER ALLOCATION — always through the database
// ════════════════════════════════════════════════════════════════════════════
// app-side max+1 is the documented cause of 44 % of Fine/Coarse Leaf bags lost
// from prod_bagging (ARCHITECTURE.md §5). These wrap the RPCs so no screen is
// ever tempted to compute a number itself.

export async function allocateBatchNo(warehouseId: string): Promise<string> {
  const { data, error } = await getDb()
    .schema('takein' as never).rpc('next_batch_no', { p_warehouse: warehouseId })
  if (error) throw error
  return data as string
}

/** A returned load hands its number back; the next delivery at that depot
 *  takes it, so the sequence on the shelf stays unbroken. */
export async function releaseBatchNo(warehouseId: string, batchNo: string): Promise<void> {
  const { error } = await getDb()
    .schema('takein' as never).rpc('release_batch_no', { p_warehouse: warehouseId, p_batch_no: batchNo })
  if (error) throw error
}

/** GRN and Ontvangsnota numbers are NEVER recycled — they have been printed
 *  and signed, and a second document carrying one could not be told apart. */
export async function allocateDocNo(warehouseId: string, kind: 'grn' | 'doc'): Promise<string> {
  const { data, error } = await getDb()
    .schema('takein' as never).rpc('next_doc_no', { p_warehouse: warehouseId, p_kind: kind })
  if (error) throw error
  return data as string
}

// ════════════════════════════════════════════════════════════════════════════
// THE AUDIT TRAIL
// ════════════════════════════════════════════════════════════════════════════
/**
 * Append an event. UPDATE and DELETE are revoked on this table at the database,
 * so this is the only way anything reaches it — and nothing can tidy it later.
 *
 * Never throws into the caller's path: a failed audit write must not also lose
 * the operator's work. It is logged loudly instead.
 */
export async function logBatchEvent(
  batchId: string, action: string, detail: string,
  actor: { id?: string | null; name: string },
  payload?: Record<string, unknown>,
): Promise<void> {
  const { error } = await takeinDb().from('batch_events').insert({
    batch_id: batchId, action, detail,
    actor_id: actor.id ?? null, actor_name: actor.name,
    payload: payload ?? null,
  })
  if (error) console.error('[takein] audit event failed to write', { batchId, action, error })
}
