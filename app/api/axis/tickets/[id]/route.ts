// app/api/axis/tickets/[id]/route.ts
// GET    — fetch single ticket + comments
// PATCH  — update status, priority, assignee, resolution_notes
// DELETE — close ticket (IT only)

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const admin = getAdminClient()

  const [{ data: ticket, error: te }, { data: comments, error: ce }] = await Promise.all([
    (admin as any).schema('axis').from('tickets').select('*').eq('id', id).single(),
    (admin as any).schema('axis').from('ticket_comments').select('*').eq('ticket_id', id).order('created_at', { ascending: true }),
  ])

  if (te) return NextResponse.json({ error: te.message }, { status: 500 })

  // Non-IT users can only see their own tickets
  if (caller.department !== 'IT' && ticket?.assigned_to !== caller.userId)
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  return NextResponse.json({ ticket, comments: comments ?? [] })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const isIT      = caller.department === 'IT'
  const canAssign = caller.can('can_assign_tickets')
  if (!isIT && !canAssign)
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const body = await req.json()
  const allowed = ['status','priority','assigned_to','assigned_name','due_date','resolution_notes','description','title']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  const admin = getAdminClient()
  const axis  = (admin as any).schema('axis')

  // Fetch the current ticket to know previous state
  const { data: current } = await axis.from('tickets').select('title,status,assigned_to,assigned_name').eq('id', id).single()

  // Capture resolver when marking resolved
  if (body.status === 'resolved' && current?.status !== 'resolved') {
    const { data: resolverRow } = await (admin as any)
      .schema('shared').from('app_roles').select('full_name').eq('user_id', caller.userId).single()
    update.resolved_by      = caller.userId
    update.resolved_by_name = resolverRow?.full_name ?? null
    update.resolved_at      = new Date().toISOString()
  }
  // Clear resolver fields when re-opening a resolved/closed ticket
  if ((body.status === 'open' || body.status === 'in_progress') &&
      (current?.status === 'resolved' || current?.status === 'closed')) {
    update.resolved_by      = null
    update.resolved_by_name = null
    update.resolved_at      = null
  }

  const { error } = await axis.from('tickets').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify new assignee when assigned_to changes
  if (body.assigned_to && body.assigned_to !== current?.assigned_to) {
    const { data: callerRow } = await (admin as any)
      .schema('shared').from('app_roles').select('full_name').eq('user_id', caller.userId).single()
    const assignerName = callerRow?.full_name ?? 'IT'
    await axis.from('notifications').insert({
      recipient_id:    body.assigned_to,
      type:            'ticket_assigned',
      title:           `Ticket assigned to you`,
      body:            `${assignerName} assigned "${current?.title ?? ''}" to you.`,
      reference_id:    id,
      reference_table: 'tickets',
    }).then(({ error: ne }: any) => { if (ne) console.error('[tickets PATCH] notify assign:', ne) })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { error } = await (getAdminClient() as any)
    .schema('axis')
    .from('tickets')
    .update({ status: 'closed' })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
