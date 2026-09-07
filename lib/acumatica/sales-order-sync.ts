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
import { rowsFromPayload, customerNameMap, salesOrderSelect, OPEN_STATUSES } from './sales-order-map'

/**
 * Acumatica's built-in endpoint. The version is part of the URL and varies by
 * instance; 24.200.001 is the current-generation default. Overridable because
 * getting it wrong is a 404 that looks exactly like "the entity is missing".
 */
// CONFIRMED against the tenant 2026-09-07: SalesOrder answers on
// Default/24.200.001. The instance also exposes Default at 20.200.001,
// 22.200.001, 23.200.001 and 25.200.001; 24 is used because it is the version
// the probe was verified on, not because it is newest.
/**
 * Rows per request.
 *
 * The first version asked for every open order with $expand=Details, no $select
 * and no $top. That returned a 504 — Nginx gave up before Acumatica finished,
 * and the app's own fetch timeout is 60s so it would have failed either way.
 *
 * 100 is a page that comes back in seconds. Pagination costs more round trips
 * but each one completes, which is the difference between a slow sync and no
 * sync.
 */
const PAGE_SIZE = 100

/**
 * Hard stop. Without one a bad filter turns a sync into an unbounded crawl of
 * the whole order history, and the first symptom is the same 504.
 */
const MAX_PAGES = 40

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
      const data = await acumaticaRest(
        cfg, 'GET', 'SalesOrder?$expand=Details&$top=1', undefined, t.endpoint,
      )
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

/**
 * One order, by number, unmapped and unfiltered.
 *
 * The status filter is the likeliest reason a sync comes back empty, and a
 * filtered query cannot tell you "no open orders" apart from "wrong filter".
 * Fetching a KNOWN order sidesteps both: if BH-SO0000387 comes back, the
 * plumbing is fine and the filter is the problem.
 *
 * No $select — the same Acumatica NRE applies, and one order is small anyway.
 */
export async function fetchOneOrder(orderNbr: string): Promise<{
  ok: boolean; message: string; order?: unknown; mapped?: unknown
}> {
  const cfg = getAcumaticaRestConfig()
  if (!cfg) return { ok: false, message: 'Acumatica REST not configured.' }
  try {
    const data = await acumaticaRest(
      cfg, 'GET',
      `SalesOrder?$expand=Details&$filter=${encodeURIComponent(`OrderNbr eq '${orderNbr}'`)}&$top=1`,
      undefined, DEFAULT_ENDPOINT,
    )
    const first = Array.isArray(data) ? data[0] : data
    if (!first) return { ok: false, message: `No order found with OrderNbr '${orderNbr}'.` }
    return {
      ok: true,
      message: `Found ${orderNbr}. 'mapped' is what the sync would store; 'order' is the raw record.`,
      order: first,
      mapped: rowsFromPayload(first),
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Acumatica REST call failed.' }
  }
}

export async function syncSalesOrders(): Promise<{ ok: boolean; count: number; message: string }> {
  const cfg = getAcumaticaRestConfig()
  if (!cfg) {
    return { ok: false, count: 0, message: 'Acumatica REST not configured (ACUMATICA_CLIENT_ID / ACUMATICA_CLIENT_SECRET / ACUMATICA_API_USER / ACUMATICA_API_PASSWORD).' }
  }

  /**
   * Paged. $select cuts the payload to the 16 fields the mapper reads (the
   * sampled order carried ~105), and $top/$skip keeps every request short
   * enough to answer before the proxy gives up.
   */
  const started = Date.now()
  const filter = OPEN_STATUSES.map(s => `Status eq '${s}'`).join(' or ')
  const select = salesOrderSelect()
  const orders: unknown[] = []
  let pages = 0
  let truncated = false
  let usedSelect = true

  /**
   * One page, trying the slim query first and falling back to the full record.
   *
   * $select is an OPTIMISATION here, not a requirement, because Acumatica 500s
   * on it:
   *
   *   NullReferenceException at
   *   PX.Objects.SO.GraphExtensions.SOOrderEntryExt.PurchaseSupplyBaseExt._(FieldDefaulting)
   *
   * That is a bug in their graph extension — omitting fields breaks the
   * defaulting logic on SO lines — and no query shape we can write fixes it.
   * The probe proved the same request WITHOUT $select returns a full record, so
   * the fallback is known to work rather than hopeful.
   *
   * $top/$skip is what actually bounds the payload, and that still applies. The
   * cost of falling back is a bigger record (~105 fields instead of 16), not an
   * unbounded one.
   */
  async function fetchPage(skip: number): Promise<unknown[]> {
    const base =
      `SalesOrder?$expand=Details&$filter=${encodeURIComponent(filter)}` +
      `&$top=${PAGE_SIZE}&$skip=${skip}`
    if (usedSelect) {
      try {
        const slim = await acumaticaRest(
          cfg!, 'GET', `${base}&$select=${encodeURIComponent(select)}`, undefined, DEFAULT_ENDPOINT,
        )
        return Array.isArray(slim) ? slim : slim ? [slim] : []
      } catch {
        // Stop retrying it: if it failed once it will fail on every page, and
        // doubling the request count to rediscover that helps nobody.
        usedSelect = false
      }
    }
    const full = await acumaticaRest(cfg!, 'GET', base, undefined, DEFAULT_ENDPOINT)
    return Array.isArray(full) ? full : full ? [full] : []
  }

  try {
    for (let skip = 0; pages < MAX_PAGES; skip += PAGE_SIZE) {
      const batch = await fetchPage(skip)
      pages += 1
      orders.push(...batch)
      // A short page is the last page. Acumatica returns no total count, so
      // this is the only end signal available.
      if (batch.length < PAGE_SIZE) break
      if (pages >= MAX_PAGES) truncated = true
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Acumatica REST call failed.'
    if (orders.length === 0) return { ok: false, count: 0, message: msg }
    return {
      ok: false,
      count: 0,
      message: `Failed after ${pages} page(s) with ${orders.length} orders fetched: ${msg}`,
    }
  }

  const data: unknown = orders

  /**
   * Customer names come from a SECOND call. SalesOrder carries CustomerID
   * ("C-KUN001") and no name — verified against the live payload, and the whole
   * point of this sync is that a person can find their customer's order.
   *
   * Best-effort: a failure here leaves customer_name null and the rows still
   * land, because an order without a display name is far better than no order.
   */
  let names: Map<string, string> | undefined
  try {
    const customers = await acumaticaRest(
      cfg, 'GET', `Customer?$select=CustomerID,CustomerName&$top=${PAGE_SIZE * 5}`,
      undefined, DEFAULT_ENDPOINT,
    )
    names = customerNameMap(customers)
  } catch {
    names = undefined
  }

  const rows = rowsFromPayload(data, names)

  // Unlike the lot sync, an empty fetch is NOT dangerous here — the upsert
  // deletes nothing, so there is no table to protect. It is still reported,
  // because "0 open orders" and "the filter is wrong" look identical from the
  // outside and only the person running it can tell them apart.
  if (rows.length === 0) {
    return {
      ok: true,
      count: 0,
      message:
        `Fetched 0 sales order lines from ${orders.length} orders over ${pages} page(s). ` +
        `Nothing written. If that is unexpected, the status filter (${OPEN_STATUSES.join(', ')}) ` +
        'is the thing to widen — every line on the sampled order was Completed.',
    }
  }

  const { data: cnt, error } = await supabaseAdmin.rpc('acumatica_upsert_sales_orders', { p_rows: rows })
  if (error) {
    return { ok: false, count: 0, message: `Fetched ${rows.length} lines but the DB write failed: ${error.message}` }
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  return {
    ok: true,
    count: Number(cnt ?? rows.length),
    message:
      `Synced ${rows.length} sales order lines from ${orders.length} orders ` +
      `over ${pages} page(s) in ${secs}s` +
      (usedSelect ? '' : ' [full records — Acumatica 500s on $select]') +
      (names ? '' : ' (customer names unavailable — ids only)') +
      (truncated ? `. STOPPED AT THE ${MAX_PAGES}-PAGE CAP — there is more; narrow the filter.` : '.'),
  }
}
