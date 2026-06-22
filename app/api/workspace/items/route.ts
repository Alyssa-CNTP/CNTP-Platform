import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

async function requireWorkspace() {
  const caller = await getCallerPermissions()
  if (!caller.userId) {
    console.error('[workspace] not authenticated')
    return { caller: null, error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }
  if (!caller.can('can_access_workspace') && caller.department !== 'IT') {
    console.error('[workspace] permission denied — dept:', caller.department)
    return { caller: null, error: NextResponse.json({ error: 'Permission denied' }, { status: 403 }) }
  }
  return { caller, error: null }
}

export async function GET() {
  const { caller, error } = await requireWorkspace()
  if (error) return error

  const { data, error: dbErr } = await (getAdminClient() as any)
    .schema('workspace')
    .from('items')
    .select('*')
    .eq('user_id', caller!.userId)
    .order('sort_order', { ascending: true })

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const { caller, error } = await requireWorkspace()
  if (error) return error

  const { zone, title, project_label, contact_name, notes, priority } = await req.json()
  if (!zone?.trim() || !title?.trim())
    return NextResponse.json({ error: 'zone and title required' }, { status: 400 })

  const validZones = ['runway', 'focus', 'blocker', 'followup']
  if (!validZones.includes(zone))
    return NextResponse.json({ error: 'Invalid zone' }, { status: 400 })

  const { data, error: dbErr } = await (getAdminClient() as any)
    .schema('workspace')
    .from('items')
    .insert({
      user_id:       caller!.userId,
      zone,
      title:         title.trim(),
      project_label: project_label ?? null,
      contact_name:  contact_name  ?? null,
      notes:         notes         ?? null,
      priority:      priority       ?? 'medium',
    })
    .select('*')
    .single()

  if (dbErr) {
    console.error('[workspace/items POST] db error:', JSON.stringify(dbErr))
    return NextResponse.json({ error: dbErr.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const { caller, error } = await requireWorkspace()
  if (error) return error

  const body = await req.json()
  const admin = getAdminClient()

  if (body.id) {
    const allowed = ['title','zone','project_label','contact_name','notes','priority','completed','sort_order']
    const update: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) update[key] = body[key]
    }
    const { error: dbErr } = await (admin as any)
      .schema('workspace')
      .from('items')
      .update(update)
      .eq('id', body.id)
      .eq('user_id', caller!.userId)

    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (Array.isArray(body.updates)) {
    await Promise.all(
      body.updates.map((u: { id: string; sort_order: number; zone?: string }) =>
        (admin as any)
          .schema('workspace')
          .from('items')
          .update({ sort_order: u.sort_order, ...(u.zone ? { zone: u.zone } : {}) })
          .eq('id', u.id)
          .eq('user_id', caller!.userId)
      )
    )
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const { caller, error } = await requireWorkspace()
  if (error) return error

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error: dbErr } = await (getAdminClient() as any)
    .schema('workspace')
    .from('items')
    .delete()
    .eq('id', id)
    .eq('user_id', caller!.userId)

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
