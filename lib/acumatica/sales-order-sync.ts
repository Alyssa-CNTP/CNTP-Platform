// Pull open Sales Orders from Acumatica (read-only, contract-based REST) into
// acumatica.sales_orders. NEVER writes to Acumatica.
//
// The payload mapping lives in ./sales-order-map — pure, and unit tested. This
// module is the I/O half: fetch, call the upsert RPC, report.
//
// ⚠ THE FIELD NAMES ARE UNVERIFIED. Written without Acumatica credentials in
// the environment, so no live call was possible. See sales-order-map.ts, and
// use `?probe=1` on the route to see what the endpoint actually returns before
// trusting the map.

import { getAcumaticaRestConfig, acumaticaRest } from './rest'
import supabaseAdmin from '@/lib/supabase/admin'
import { rowsFromPayload, OPEN_STATUSES } from './sales-order-map'

export { mapLine, rowsFromPayload, type SalesOrderRow } from './sales-order-map'

/** The raw first record, for discovering what the endpoint actually returns. */
export async function probeSalesOrders(): Promise<{ ok: boolean; sample?: unknown; message: string }> {
  const cfg = getAcumaticaRestConfig()
  if (!cfg) {
    return { ok: false, message: 'Acumatica REST not configured (ACUMATICA_CLIENT_ID / ACUMATICA_CLIENT_SECRET / ACUMATICA_API_USER / ACUMATICA_API_PASSWORD).' }
  }
  try {
    const data = await acumaticaRest(cfg, 'GET', 'SalesOrder?$expand=Details&$top=1')
    const first = Array.isArray(data) ? data[0] : data
    return { ok: true, sample: first, message: 'One raw SalesOrder record, unmapped.' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Acumatica REST call failed.' }
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
    data = await acumaticaRest(cfg, 'GET', `SalesOrder?$expand=Details&$filter=${encodeURIComponent(filter)}`)
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
