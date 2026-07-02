// app/api/accounts/[id]/interactions/route.ts
// POST /api/accounts/[id]/interactions — add a timeline entry

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authorize()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body?.summary) return NextResponse.json({ error: 'summary required' }, { status: 400 })

  const { data, error } = await salesDb.from('account_interactions').insert({
    account_id:       id,
    interaction_type: body.interaction_type ?? 'note',
    summary:          body.summary,
    sentiment:        body.sentiment        ?? null,
    ai_assisted:      false,
    next_step:        body.next_step        ?? null,
    next_step_due:    body.next_step_due    ?? null,
    occurred_at:      body.occurred_at      ?? new Date().toISOString(),
    logged_by:        user.id,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ interaction: data }, { status: 201 })
}
