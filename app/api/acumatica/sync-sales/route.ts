// app/api/acumatica/sync-sales/route.ts
// POST|GET /api/acumatica/sync-sales
//
// Triggers a full re-sync of CNTPSALESREPORT into acumatica.sales_lines (the
// typed table the EXCO sales dashboard reads from). Reads from Acumatica, writes
// only to Supabase — never writes to Acumatica.
//
// AUTH (either is sufficient):
//   (a) a logged-in app user (browser session) — handy for manual triggering, OR
//   (b) header `x-sync-secret: <N8N_WEBHOOK_SECRET>` — for cron / n8n / webhook.
//
// GET is supported so it's trivial to trigger from the browser while logged in.

import { NextResponse }               from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { syncSalesLines }             from '@/lib/acumatica/sales-sync'

export const dynamic = 'force-dynamic'

async function handle(req: Request) {
  // (b) shared-secret header for cron / n8n / webhook.
  const secret = process.env.N8N_WEBHOOK_SECRET
  const headerSecret = req.headers.get('x-sync-secret')
  const secretOk = !!secret && headerSecret === secret

  // (a) logged-in app user.
  let userOk = false
  if (!secretOk) {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    userOk = !!user
  }

  if (!secretOk && !userOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await syncSalesLines()
  return NextResponse.json(summary, { status: summary.ok ? 200 : 502 })
}

export async function POST(req: Request) { return handle(req) }
export async function GET(req: Request)  { return handle(req) }
