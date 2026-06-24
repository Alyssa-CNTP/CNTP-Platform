// app/api/signals/route.ts
// GET /api/signals — server-side proxy to sales.signals table.
// Uses the service role client so the sales schema doesn't need to be
// listed in Supabase's "Exposed schemas" public API setting.
// Auth: any authenticated user whose department is IT, Sales, Management, or Marketing.

import { NextResponse }       from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient }       from '@supabase/supabase-js'
import { cookies }            from 'next/headers'

const salesDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'sales' } }
)

const ALLOWED_DEPARTMENTS = ['IT', 'Sales', 'Management', 'Marketing']

export async function GET(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cookieStore = await cookies()
  const authClient  = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appRole } = await authClient
    .schema('shared' as any)
    .from('app_roles')
    .select('department, permissions')
    .eq('user_id', user.id)
    .single()

  const dept      = (appRole as any)?.department as string | null
  const overrides = ((appRole as any)?.permissions ?? {}) as Record<string, boolean>
  const canAccess = ALLOWED_DEPARTMENTS.includes(dept ?? '')
                    || overrides['can_access_sales'] === true
                    || overrides['can_access_intelligence'] === true

  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── Parse query params ────────────────────────────────────────────────────
  const url        = new URL(req.url)
  const sourceType = url.searchParams.get('source_type')   // comma-separated list
  const cls        = url.searchParams.get('classification')
  const limit      = Math.min(parseInt(url.searchParams.get('limit') ?? '150', 10), 300)
  const countOnly  = url.searchParams.get('count') === 'true'

  // ── Query ────────────────────────────────────────────────────────────────
  if (countOnly) {
    const { count } = await salesDb
      .from('signals')
      .select('*', { count: 'exact', head: true })
    return NextResponse.json({ count: count ?? 0 })
  }

  let q = salesDb
    .from('signals')
    .select('id, source_type, title, summary_en, classification, relevance_score, region, media_url, source_url, source_domain, keyword_group, sections, sales_angle, urgency, tier, intel, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (sourceType) {
    const types = sourceType.split(',').map(s => s.trim()).filter(Boolean)
    if (types.length === 1) {
      q = q.eq('source_type', types[0])
    } else if (types.length > 1) {
      q = q.in('source_type', types)
    }
  }

  if (cls) q = q.eq('classification', cls)

  const { data, error } = await q

  if (error) {
    console.error('[api/signals] query error:', error.message)
    return NextResponse.json({ error: 'Failed to load signals' }, { status: 500 })
  }

  return NextResponse.json({ signals: data ?? [] })
}

export async function HEAD(req: Request) {
  // HEAD /api/signals?count=true — returns just the count in a header
  const cookieStore = await cookies()
  const authClient  = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response(null, { status: 401 })

  const { count } = await salesDb
    .from('signals')
    .select('*', { count: 'exact', head: true })

  return new Response(null, { headers: { 'X-Total-Count': String(count ?? 0) } })
}
