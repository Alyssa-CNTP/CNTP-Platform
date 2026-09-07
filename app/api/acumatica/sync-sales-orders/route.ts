// app/api/acumatica/sync-sales-orders/route.ts
// POST|GET /api/acumatica/sync-sales-orders
// GET      /api/acumatica/sync-sales-orders?probe=1
//
// Pulls open Acumatica Sales Orders into acumatica.sales_orders. Reads from
// Acumatica (contract REST + OAuth2), writes only to Supabase. NEVER writes to
// Acumatica.
//
// AUTH — same two routes in as sync-lots:
//   (a) a logged-in app user (browser session), for manual triggering, OR
//   (b) header `x-sync-secret: <N8N_WEBHOOK_SECRET>`, for cron / n8n.
//
// ── ?probe=1 ────────────────────────────────────────────────────────────────
//
// Returns ONE raw SalesOrder record, unmapped, and writes nothing.
//
// It exists because the field mapping in sales-order-sync.ts could not be
// verified when it was written: the environment has ACUMATICA_BASE_URL and
// ACUMATICA_COMPANY but no credentials, so no live call was possible and the
// names are Acumatica's standard SalesOrder entity. The CNTP endpoint is a
// CUSTOM endpoint and may well differ — LotDetail did, carrying Variant,
// TeaCourt, HarvestYear and LandName.
//
// Run the probe once against the real endpoint, read the actual field names,
// then correct `mapLine`. Guessing twice is worse than looking once.
//
// The probe is behind the same auth as the sync, because the payload is
// commercial data — customers, quantities, prices — not a health check.

import { NextResponse }               from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { syncSalesOrders, probeSalesOrders, fetchOneOrder } from '@/lib/acumatica/sales-order-sync'

export const dynamic = 'force-dynamic'

async function authorised(req: Request): Promise<boolean> {
  const secret = process.env.N8N_WEBHOOK_SECRET
  if (secret && req.headers.get('x-sync-secret') === secret) return true
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user
}

async function handle(req: Request) {
  if (!await authorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = new URL(req.url).searchParams

  /**
   * ?order=BH-SO0000387 — one known order, unfiltered, mapped and raw.
   * Distinguishes "no open orders" from "wrong status filter", which an empty
   * filtered sync cannot.
   */
  const one = params.get('order')
  if (one) {
    const result = await fetchOneOrder(one)
    return NextResponse.json(result, { status: result.ok ? 200 : 502 })
  }

  if (params.get('probe')) {
    const result = await probeSalesOrders()
    return NextResponse.json(result, { status: result.ok ? 200 : 502 })
  }

  const summary = await syncSalesOrders()
  return NextResponse.json(summary, { status: summary.ok ? 200 : 502 })
}

export async function POST(req: Request) { return handle(req) }
export async function GET(req: Request)  { return handle(req) }
