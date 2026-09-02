// app/api/acumatica/sync-lots/route.ts
// POST|GET /api/acumatica/sync-lots
//
// Triggers a full re-sync of Acumatica Lot Details (BHW) into acumatica.lot_details.
// Reads from Acumatica (contract REST + OAuth2), writes only to Supabase.
//
// AUTH (either is sufficient):
//   (a) a logged-in app user (browser session) — for manual triggering, OR
//   (b) header `x-sync-secret: <N8N_WEBHOOK_SECRET>` — for cron / n8n / webhook.

import { NextResponse }               from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { syncLotDetails }             from '@/lib/acumatica/lot-sync'

export const dynamic = 'force-dynamic'

async function handle(req: Request) {
  const secret = process.env.N8N_WEBHOOK_SECRET
  const secretOk = !!secret && req.headers.get('x-sync-secret') === secret

  let userOk = false
  if (!secretOk) {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    userOk = !!user
  }

  if (!secretOk && !userOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await syncLotDetails()
  return NextResponse.json(summary, { status: summary.ok ? 200 : 502 })
}

export async function POST(req: Request) { return handle(req) }
export async function GET(req: Request)  { return handle(req) }
