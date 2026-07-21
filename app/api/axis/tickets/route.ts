// app/api/axis/tickets/route.ts
// GET  — list tickets (IT sees all; others see only their assigned)
// POST — create a new ticket (IT / managers with can_assign_tickets)

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { getTicketManagerIds, resolveRecipients } from '@/lib/notifications/recipients'

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const admin = getAdminClient()
  const isIT  = caller.department === 'IT'

  const query = (admin as any)
    .schema('axis')
    .from('tickets')
    .select('*')
    .order('created_at', { ascending: false })

  const { data, error } = isIT
    ? await query
    : await query.eq('assigned_to', caller.userId)

  if (error) {
    console.error('[api/axis/tickets GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const isIT      = caller.department === 'IT'
  const canAssign = caller.can('can_assign_tickets')
  if (!isIT && !canAssign)
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const {
    title, description, category, ticket_type,
    priority, assigned_to, assigned_name,
    due_date, created_by_name,
  } = await req.json()

  if (!title?.trim()) return NextResponse.json({ error: 'Title required' }, { status: 400 })

  const validCategories = ['app', 'database', 'infrastructure', 'security', 'ai_ml', 'general']
  const validTypes      = ['task', 'bug', 'feature', 'maintenance', 'incident']
  const validPriorities = ['critical', 'high', 'medium', 'low']

  if (!validCategories.includes(category))
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  if (ticket_type && !validTypes.includes(ticket_type))
    return NextResponse.json({ error: 'Invalid ticket_type' }, { status: 400 })
  if (priority && !validPriorities.includes(priority))
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })

  const admin = getAdminClient()

  // No auto-routing — tickets are created unassigned unless an assignee was
  // explicitly chosen, and IT/managers pick who owns it from the queue.
  const { data: ticket, error } = await (admin as any)
    .schema('axis')
    .from('tickets')
    .insert({
      title:           title.trim(),
      description:     description?.trim() ?? null,
      category,
      ticket_type:     ticket_type   ?? 'task',
      priority:        priority       ?? 'medium',
      assigned_to:     assigned_to   ?? null,
      assigned_name:   assigned_name ?? null,
      created_by:      caller.userId,
      created_by_name: created_by_name ?? null,
      due_date:        due_date ?? null,
      status:          'open',
    })
    .select('id, ticket_number')
    .single()

  if (error) {
    console.error('[api/axis/tickets POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Notify eligible ticket managers when a ticket lands unassigned, so it
  // doesn't sit unnoticed in the queue.
  if (!assigned_to && ticket) {
    const managerIds = await getTicketManagerIds()
    const recipients  = await resolveRecipients(managerIds)
    if (recipients.length > 0) {
      await notify({
        recipients,
        kind:     'ticket_created',
        title:    `New ticket ${ticket.ticket_number}`,
        body:     title.trim(),
        url:      '/axis/tickets',
        channels: ['inApp'],
      })
    }
  }

  return NextResponse.json({ ok: true, ticket_number: ticket?.ticket_number })
}
