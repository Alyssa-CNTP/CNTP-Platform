// app/api/acumatica/odata/route.ts
// GET /api/acumatica/odata?inquiry=<GIName>&$top=10&$filter=...&$select=...
//
// Read-only spike: proxies a request to an Acumatica Generic Inquiry exposed via
// OData and returns the JSON rows. This route exists so credentials stay on the
// server (the browser only ever talks to us, never to Acumatica directly).
//
// SAFETY: this can only READ. OData GIs have no write path, and we only ever
// issue GET. Gated behind an authenticated app session like the app's other routes.

import { NextResponse }       from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies }            from 'next/headers'
import { getAcumaticaConfig, fetchInquiry } from '@/lib/acumatica/odata'

export const dynamic = 'force-dynamic'  // always run at request time — never prerender

export async function GET(req: Request) {
  // ── Require a logged-in app user (don't expose Acumatica data publicly) ──────
  const cookieStore = await cookies()
  const supabase    = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Config check — clean 503 with a hint if env isn't set yet ────────────────
  const cfg = getAcumaticaConfig()
  if (!cfg) {
    return NextResponse.json(
      { error: 'Acumatica not configured — set ACUMATICA_BASE_URL, ACUMATICA_COMPANY, ACUMATICA_ODATA_USER and ACUMATICA_ODATA_PASSWORD in .env.local' },
      { status: 503 }
    )
  }

  // ── Inputs ───────────────────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url)
  const inquiry = searchParams.get('inquiry')?.trim()
  if (!inquiry) {
    return NextResponse.json(
      { error: 'Pass ?inquiry=<GenericInquiryName> (the GI must be exposed via OData in Acumatica).' },
      { status: 400 }
    )
  }

  // fetchInquiry forwards only whitelisted read-only $-options from searchParams.
  const result = await fetchInquiry(cfg, inquiry, searchParams)

  // Echo back enough to learn from: the URL we hit, row count, and the rows.
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
