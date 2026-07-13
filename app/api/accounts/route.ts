// app/api/accounts/route.ts
// GET /api/accounts?stage=lead&limit=500  — list accounts (all or by stage)
// POST /api/accounts                      — create / promote signal → lead

import { NextResponse }       from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient }       from '@supabase/supabase-js'
import { cookies }            from 'next/headers'

const ALLOWED = ['IT', 'Sales', 'Management', 'Marketing']

const salesDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'sales' } }
)

async function authorize() {
  const cookieStore = await cookies()
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return null
  const { data: role } = await auth
    .schema('shared' as any).from('app_roles')
    .select('department, permissions').eq('user_id', user.id).single()
  const dept      = (role as any)?.department as string | null
  const overrides = ((role as any)?.permissions ?? {}) as Record<string, boolean>
  const ok = ALLOWED.includes(dept ?? '')
          || overrides['can_access_sales']
          || overrides['can_access_intelligence']
  return ok ? user : null
}

export async function GET(req: Request) {
  const user = await authorize()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url   = new URL(req.url)
  const stage = url.searchParams.get('stage')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '500', 10), 1000)

  let q = salesDb
    .from('accounts')
    .select('id, name, country, region, account_type, stage, status, sales_angle, assigned_to, tags, notes, signal_ids, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (stage) q = q.eq('stage', stage)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ accounts: data ?? [] })
}

export async function POST(req: Request) {
  const user = await authorize()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  // Check if an account with this name already exists (avoid upsert which needs a unique constraint)
  const { data: existing } = await salesDb
    .from('accounts')
    .select('id, name, stage')
    .eq('name', body.name)
    .maybeSingle()

  if (existing) {
    // Already a lead — treat as success
    return NextResponse.json({ account: existing }, { status: 200 })
  }

  const row: Record<string, unknown> = {
    name:        body.name,
    stage:       body.stage ?? 'lead',
    notes:       body.notes ?? null,
    assigned_to: user.id,
  }
  // Only include optional columns if they have values (avoids unknown-column errors)
  if (body.country)      row.country      = body.country
  if (body.region)       row.region       = body.region
  if (body.sales_angle)  row.sales_angle  = body.sales_angle
  if (body.signal_ids?.length) row.signal_ids = body.signal_ids

  const { data, error } = await salesDb
    .from('accounts')
    .insert(row)
    .select('id, name, stage')
    .single()

  if (error) {
    console.error('[accounts POST] insert error:', error.message, error.details, error.hint)
    // If it failed due to duplicate name (race condition), return success anyway
    if (error.code === '23505') {
      const { data: race } = await salesDb.from('accounts').select('id, name, stage').eq('name', body.name).maybeSingle()
      if (race) return NextResponse.json({ account: race }, { status: 200 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // log genesis interaction when promoted from a signal (best-effort)
  if (body.source_signal_id && data?.id) {
    try {
      await salesDb.from('account_interactions').insert({
        account_id:       data.id,
        interaction_type: 'note',
        summary:          `Promoted from signal: ${body.signal_title ?? body.source_signal_id}`,
        ai_assisted:      false,
        logged_by:        user.id,
      })
    } catch (interactionErr) {
      console.warn('[accounts POST] interaction log failed (non-fatal):', interactionErr)
    }
  }

  return NextResponse.json({ account: data }, { status: 201 })
}
