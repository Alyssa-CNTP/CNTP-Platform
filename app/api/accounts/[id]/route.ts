// app/api/accounts/[id]/route.ts
// GET  /api/accounts/[id] — account + company_profile + interactions + linked signals
// PATCH /api/accounts/[id] — update stage / notes / sales_angle / assigned_to / status

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authorize()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [{ data: account, error: accErr }, { data: profile }, { data: interactions }] =
    await Promise.all([
      salesDb.from('accounts').select('*').eq('id', id).single(),
      salesDb.from('company_profiles').select('*').eq('account_id', id).maybeSingle(),
      salesDb.from('account_interactions')
        .select('id, interaction_type, summary, sentiment, ai_assisted, next_step, next_step_due, occurred_at, logged_by, created_at')
        .eq('account_id', id)
        .order('occurred_at', { ascending: false })
        .limit(30),
    ])

  if (accErr || !account) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // fetch linked signals (signal_ids is uuid[])
  let signals: unknown[] = []
  const ids: string[] = (account as any).signal_ids ?? []
  if (ids.length > 0) {
    const { data: sigs } = await salesDb
      .from('signals')
      .select('id, title, classification, relevance_score, sales_angle, region, created_at, source_url')
      .in('id', ids.slice(0, 20))
    signals = sigs ?? []
  }

  return NextResponse.json({
    account,
    profile:      profile ?? null,
    interactions: interactions ?? [],
    signals,
  })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authorize()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const PATCHABLE = ['stage', 'notes', 'assigned_to', 'sales_angle', 'status', 'tags']
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of PATCHABLE) {
    if (k in body) patch[k] = body[k]
  }

  const { data, error } = await salesDb
    .from('accounts')
    .update(patch).eq('id', id)
    .select('id, name, stage')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ account: data })
}
