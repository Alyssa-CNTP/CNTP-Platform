// app/api/axis/tickets/route.ts
// GET  — list tickets (IT sees all; others see only their assigned)
// POST — create a new ticket (IT / managers with can_assign_tickets)

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

// ─── Auto-routing config ──────────────────────────────────────────────────────
// Only app-category tickets auto-assign to Alyssa + notify Jan.
// All other categories: notify Jan only — she assigns manually.
// Database tickets additionally notify Gustav.

async function resolveRouting(category: string, admin: ReturnType<typeof getAdminClient>) {
  const { data: users } = await (admin as any)
    .schema('shared')
    .from('app_roles')
    .select('user_id, full_name')

  if (!users) return { assignTo: null, assignName: null, notifyIds: [] }

  function findUser(namePart: string): { user_id: string; full_name: string } | undefined {
    return users.find((u: any) =>
      u.full_name?.toLowerCase().includes(namePart.toLowerCase())
    )
  }

  const alyssa = findUser('Alyssa')
  const jan    = findUser('Jan')
  const gustav = findUser('Gustav')

  const notifyIds: string[] = []
  let assignTo:   string | null = null
  let assignName: string | null = null

  if (category === 'app') {
    // App tickets → auto-assign Alyssa, notify Jan
    if (alyssa) { assignTo = alyssa.user_id; assignName = alyssa.full_name }
    if (jan)    notifyIds.push(jan.user_id)
  } else if (category === 'database') {
    // Database tickets → notify Gustav + Jan (Jan assigns)
    if (jan)    notifyIds.push(jan.user_id)
    if (gustav) notifyIds.push(gustav.user_id)
  } else {
    // All other categories → notify Jan only (Jan assigns)
    if (jan) notifyIds.push(jan.user_id)
  }

  return { assignTo, assignName, notifyIds }
}

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

  // Auto-routing if no explicit assignee provided
  let finalAssignTo   = assigned_to   ?? null
  let finalAssignName = assigned_name ?? null
  let notifyIds: string[] = []
  let autoRouted = false

  if (!finalAssignTo) {
    const route = await resolveRouting(category, admin)
    finalAssignTo   = route.assignTo
    finalAssignName = route.assignName
    notifyIds       = route.notifyIds
    autoRouted      = true
  }

  const { data: ticket, error } = await (admin as any)
    .schema('axis')
    .from('tickets')
    .insert({
      title:           title.trim(),
      description:     description?.trim() ?? null,
      category,
      ticket_type:     ticket_type   ?? 'task',
      priority:        priority       ?? 'medium',
      assigned_to:     finalAssignTo,
      assigned_name:   finalAssignName,
      created_by:      caller.userId,
      created_by_name: created_by_name ?? null,
      due_date:        due_date ?? null,
      notify_user_ids: notifyIds,
      auto_routed:     autoRouted,
      status:          'open',
    })
    .select('id, ticket_number')
    .single()

  if (error) {
    console.error('[api/axis/tickets POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Insert notifications for notified users
  if (notifyIds.length > 0 && ticket) {
    const notifications = notifyIds.map(uid => ({
      ticket_id: ticket.id,
      user_id:   uid,
      message:   `${ticket.ticket_number}: ${title.trim()} — ${category} ticket ${autoRouted ? 'auto-routed' : 'assigned'}`,
    }))
    await (admin as any).schema('axis').from('ticket_notifications').insert(notifications)
  }

  return NextResponse.json({ ok: true, ticket_number: ticket?.ticket_number })
}
