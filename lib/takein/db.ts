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
import type { Site } from './types'

/** The `takein` schema. The default browser client is locked to `production`. */
export function takeinDb() {
  return getDb().schema('takein' as never)
}

/** The site registry lives in `notebooks` — the same five sites that drive the
 *  Warehousing tabs. Take-in reads them through its own `takein.sites` view,
 *  which joins that registry to the per-site take-in configuration, so there is
 *  one list of sites on the platform and not two. */
export function sitesDb() {
  return takeinDb()
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

export async function loadSites(): Promise<Site[]> {
  const { data, error } = await takeinDb()
    .from('sites').select('*').eq('active', true).order('sort_order')
  if (error) throw error
  return (data as Site[]) ?? []
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
export function visibleSites(sites: Site[], userDepotCodes: string[] | null | undefined): Site[] {
  // Trimmed, because a whitespace-only entry is noise rather than a depot. Left
  // untrimmed it is truthy, so it counts as a scope, matches no depot code and
  // silently blanks the user's dashboard — which reads exactly like the module
  // being broken rather than like a bad row.
  const codes = (userDepotCodes ?? []).map(c => (c ?? '').trim()).filter(Boolean)
  if (!codes.length) return sites
  return sites.filter(d => codes.includes(d.code))
}

/**
 * Narrow a user's visible sites to ONE, when the screen was reached from that
 * site's page in Warehousing (`?site=GD`).
 *
 * It narrows and never widens: a site the user is not scoped to is ignored
 * rather than granted, so a hand-typed query string cannot reach another
 * depot's deliveries. An unknown or absent code leaves the scope alone.
 */
/**
 * The site a take-in screen is working on, from the route.
 *
 * `/take-in/site/GD/intake` puts the code in the path; the older `?site=GD`
 * form is still read so a bookmark or a link from elsewhere keeps working.
 * The path wins, because it is the thing the sidebar and the tab bar build.
 */
export function siteCodeFrom(
  routeCode: string | string[] | undefined, queryCode?: string | null,
): string | null {
  const fromRoute = Array.isArray(routeCode) ? routeCode[0] : routeCode
  const code = (fromRoute ?? queryCode ?? '').trim().toUpperCase()
  return code || null
}

export function scopedSites(
  sites: Site[], userDepotCodes: string[] | null | undefined, siteParam?: string | null,
): Site[] {
  const allowed = visibleSites(sites, userDepotCodes)
  const want = (siteParam ?? '').trim().toUpperCase()
  if (!want) return allowed
  const one = allowed.filter(s => s.code.toUpperCase() === want)
  return one.length ? one : allowed
}

export function seesSite(userDepotCodes: string[] | null | undefined, code: string): boolean {
  const codes = (userDepotCodes ?? []).map(c => (c ?? '').trim()).filter(Boolean)
  return !codes.length || codes.includes(code)
}

/** Sites that actually take a farmer delivery — Blackheath does not; it is the
 *  consolidated view over the other four. */
export const deliverySites = (sites: Site[]) => sites.filter(d => d.takes_farmer_delivery)

// ════════════════════════════════════════════════════════════════════════════
// NUMBER ALLOCATION — always through the database
// ════════════════════════════════════════════════════════════════════════════
// app-side max+1 is the documented cause of 44 % of Fine/Coarse Leaf bags lost
// from prod_bagging (ARCHITECTURE.md §5). These wrap the RPCs so no screen is
// ever tempted to compute a number itself.

export async function allocateBatchNo(locationCode: string): Promise<string> {
  const { data, error } = await getDb()
    .schema('takein' as never).rpc('next_batch_no', { p_location: locationCode })
  if (error) throw error
  return data as string
}

/** A returned load hands its number back; the next delivery at that depot
 *  takes it, so the sequence on the shelf stays unbroken. */
export async function releaseBatchNo(locationCode: string, batchNo: string): Promise<void> {
  const { error } = await getDb()
    .schema('takein' as never).rpc('release_batch_no', { p_location: locationCode, p_batch_no: batchNo })
  if (error) throw error
}

/** GRN and Ontvangsnota numbers are NEVER recycled — they have been printed
 *  and signed, and a second document carrying one could not be told apart. */
export async function allocateDocNo(locationCode: string, kind: 'grn' | 'doc'): Promise<string> {
  const { data, error } = await getDb()
    .schema('takein' as never).rpc('next_doc_no', { p_location: locationCode, p_kind: kind })
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
