// Pull open Sales Orders from Acumatica (read-only, contract-based REST) into
// acumatica.sales_orders. NEVER writes to Acumatica.
//
// The payload mapping lives in ./sales-order-map — pure, and unit tested. This
// module is the I/O half: fetch, call the upsert RPC, report.
//
// ── Which endpoint ─────────────────────────────────────────────────────────
//
// NOT the CNTP one. CNTP/25.201.0213 is a CUSTOM endpoint and exposes only what
// was added to it, which today is LotDetail and nothing else — Alyssa confirmed
// this. SalesOrder is a STANDARD entity and lives in Acumatica's built-in
// `Default` endpoint, which exists in every instance and needs no work from an
// Acumatica developer.
//
// So the sync targets Default, overridable with ACUMATICA_DEFAULT_ENDPOINT if
// the version differs on this tenant.
//
// ⚠ THE FIELD NAMES ARE STILL UNVERIFIED — no live call has been made. Run
// `?probe=1` on the route (it tries several endpoints and reports what each
// returns) before trusting the map in sales-order-map.ts.

import { getAcumaticaRestConfig, acumaticaRest } from './rest'
import supabaseAdmin from '@/lib/supabase/admin'
import { rowsFromPayload, OPEN_STATUSES } from './sales-order-map'

/**
 * Acumatica's built-in endpoint. The version is part of the URL and varies by
 * instance; 24.200.001 is the current-generation default. Overridable because
 * getting it wrong is a 404 that looks exactly like "the entity is missing".
 */
const DEFAULT_ENDPOINT = process.env.ACUMATICA_DEFAULT_ENDPOINT ?? 'Default/24.200.001'

/** Endpoints the probe tries, in order of how likely they are to work. */
const CANDIDATE_ENDPOINTS = [
  DEFAULT_ENDPOINT,
  'Default/20.200.001',
  'Default/18.200.001',
]

export { mapLine, rowsFromPayload, type SalesOrderRow } from './sales-order-map'

export interface ProbeAttempt {
  target: string
  ok: boolean
  detail: string
  /** Field names found on the header and the first line, when it worked. */
  headerFields?: string[]
  lineFields?: string[]
  sample?: unknown
}

/**
 * Discovery: what can this tenant actually serve?
 *
 * Rather than one call that either works or 404s — leaving "wrong endpoint",
 * "wrong version" and "entity not exposed" indistinguishable — this tries the
 * candidates and reports each outcome. One run answers the question instead of
 * a round trip per guess.
 *
 * It also lists the FIELD NAMES it found, which is the thing the mapper needs
 * and the thing that cannot be guessed: the CNTP endpoint's LotDetail carried
 * Variant, TeaCourt, HarvestYear and LandName that no standard schema predicts.
 */
export async function probeSalesOrders(): Promise<{
  ok: boolean
  message: string
  attempts: ProbeAttempt[]
}> {
  const cfg = getAcumaticaRestConfig()
  if (!cfg) {
    return {
      ok: false,
      attempts: [],
      message: 'Acumatica REST not configured (ACUMATICA_CLIENT_ID / ACUMATICA_CLIENT_SECRET / ACUMATICA_API_USER / ACUMATICA_API_PASSWORD).',
    }
  }

  const attempts: ProbeAttempt[] = []

  // The CNTP endpoint first, to record what it says rather than assume.
  const targets: Array<{ endpoint: string; label: string }> = [
    { endpoint: cfg.endpoint, label: `${cfg.endpoint} (the custom CNTP endpoint)` },
    ...CANDIDATE_ENDPOINTS.map(e => ({ endpoint: e, label: e })),
  ]

  for (const t of targets) {
    try {
      const data = await acumaticaRest(cfg, 'GET', 'SalesOrder?$expand=Details&$top=1', undefined, t.endpoint)
      const first = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
      if (!first) {
        attempts.push({ target: t.label, ok: true, detail: 'Reachable, but returned no orders. Try widening the filter.' })
        continue
      }
      const details = (first.Details ?? first.SalesOrderDetails ?? []) as Record<string, unknown>[]
      attempts.push({
        target: t.label,
        ok: true,
        detail: 'Reachable. Field names below are what the mapper must use.',
        headerFields: Object.keys(first).sort(),
        lineFields: Array.isArray(details) && details[0] ? Object.keys(details[0]).sort() : [],
        sample: first,
      })
      // Stop at the first that works — the rest would only repeat it.
      break
    } catch (e) {
      attempts.push({
        target: t.label,
        ok: false,
        detail: e instanceof Error ? e.message : 'Call failed.',
      })
    }
  }

  const win = attempts.find(a => a.ok)
  return {
    ok: !!win,
    attempts,
    message: win
      ? `SalesOrder is reachable on ${win.target}. Set ACUMATICA_DEFAULT_ENDPOINT to it if it is not the default, and correct sales-order-map.ts to the field names listed.`
      : 'SalesOrder was not reachable on any endpoint tried. If every attempt says 404, the entity is not exposed and an Acumatica developer needs to add it — see the detail per attempt.',
  }
}

export async function syncSalesOrders(): Promise<{ ok: boolean; count: number; message: string }> {
  const cfg = getAcumaticaRestConfig()
  if (!cfg) {
    return { ok: false, count: 0, message: 'Acumatica REST not configured (ACUMATICA_CLIENT_ID / ACUMATICA_CLIENT_SECRET / ACUMATICA_API_USER / ACUMATICA_API_PASSWORD).' }
  }

  let data: unknown
  try {
    const filter = OPEN_STATUSES.map(s => `Status eq '${s}'`).join(' or ')
    data = await acumaticaRest(
      cfg, 'GET', `SalesOrder?$expand=Details&$filter=${encodeURIComponent(filter)}`,
      undefined, DEFAULT_ENDPOINT,
    )
  } catch (e) {
    return { ok: false, count: 0, message: e instanceof Error ? e.message : 'Acumatica REST call failed.' }
  }

  const rows = rowsFromPayload(data)

  // Unlike the lot sync, an empty fetch is NOT dangerous here — the upsert
  // deletes nothing, so there is no table to protect. It is still reported,
  // because "0 open orders" and "the filter is wrong" look identical from the
  // outside and only the person running it can tell them apart.
  if (rows.length === 0) {
    return { ok: true, count: 0, message: 'Fetched 0 sales order lines. Nothing written — check the status filter if that is unexpected.' }
  }

  const { data: cnt, error } = await supabaseAdmin.rpc('acumatica_upsert_sales_orders', { p_rows: rows })
  if (error) {
    return { ok: false, count: 0, message: `Fetched ${rows.length} lines but the DB write failed: ${error.message}` }
  }
  return { ok: true, count: Number(cnt ?? rows.length), message: `Synced ${rows.length} sales order lines.` }
}
