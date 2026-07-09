// app/api/staff/[id]/request-login/route.ts
// POST — a staff manager asks IT to create a LOGIN ACCOUNT for a staff member.
//
// Creating login accounts stays IT-only (that happens at /users, gated by
// can_manage_users). Anyone who manages staff (can_edit_staff_profiles) can
// RAISE THE REQUEST here — it opens an Axis ticket routed to IT rather than
// creating the account directly.
//
// Routing mirrors app/api/axis/tickets/route.ts: category 'app' auto-assigns to
// Alyssa and notifies Jan. We insert directly with the service-role client
// because the public /api/axis/tickets route requires can_assign_tickets, which
// a staff manager won't have.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_edit_staff_profiles'))
    return NextResponse.json({ error: 'You don’t have permission to request a login' }, { status: 403 })

  // Look up the person so the ticket describes who the login is for.
  const db = await getSessionClient()
  const { data: emp, error: empErr } = await db
    .schema('production' as any)
    .from('employees')
    .select('id,name,display_name,department,job_title,position,employee_code,phone')
    .eq('id', id)
    .maybeSingle()

  if (empErr) {
    console.error('[api/staff request-login] employee lookup', empErr)
    return NextResponse.json({ error: empErr.message }, { status: 500 })
  }
  if (!emp)
    return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })

  const body = await req.json().catch(() => ({} as any))
  const requestedEmail: string | null = body.email?.trim() || null
  const note:           string | null = body.note?.trim() || null

  const admin = getAdminClient()

  // Auto-routing (mirrors resolveRouting for the 'app' category in axis/tickets).
  const { data: users } = await (admin as any)
    .schema('shared')
    .from('app_roles')
    .select('user_id, full_name')
  const find = (namePart: string) =>
    (users ?? []).find((u: any) => u.full_name?.toLowerCase().includes(namePart.toLowerCase()))
  const alyssa = find('Alyssa')
  const jan    = find('Jan')

  const notifyIds: string[] = []
  let assignTo:   string | null = null
  let assignName: string | null = null
  if (alyssa) { assignTo = alyssa.user_id; assignName = alyssa.full_name }
  if (jan)    notifyIds.push(jan.user_id)

  const person = emp.display_name || emp.name
  const description = [
    'Please create a login account for a staff member (requested from the Staff Directory).',
    '',
    `Name: ${emp.name}${emp.display_name ? ` (${emp.display_name})` : ''}`,
    `Department: ${emp.department}`,
    (emp.position || emp.job_title) ? `Position: ${emp.position || emp.job_title}` : null,
    emp.employee_code ? `Employee code: ${emp.employee_code}` : null,
    requestedEmail ? `Requested email: ${requestedEmail}` : 'Email: (to be confirmed with IT)',
    emp.phone ? `Phone: ${emp.phone}` : null,
    note ? `\nNote: ${note}` : null,
  ].filter(Boolean).join('\n')

  const { data: ticket, error } = await (admin as any)
    .schema('axis')
    .from('tickets')
    .insert({
      title:           `Login account request — ${person}`,
      description,
      category:        'app',
      ticket_type:     'task',
      priority:        'medium',
      assigned_to:     assignTo,
      assigned_name:   assignName,
      created_by:      caller.userId,
      created_by_name: null,
      due_date:        null,
      notify_user_ids: notifyIds,
      auto_routed:     true,
      status:          'open',
    })
    .select('id, ticket_number')
    .single()

  if (error) {
    console.error('[api/staff request-login] ticket insert', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (notifyIds.length > 0 && ticket) {
    const notifications = notifyIds.map((uid: string) => ({
      ticket_id: ticket.id,
      user_id:   uid,
      message:   `${ticket.ticket_number}: Login account request for ${person} — app ticket auto-routed`,
    }))
    await (admin as any).schema('axis').from('ticket_notifications').insert(notifications)
  }

  return NextResponse.json({ ok: true, ticket_number: ticket?.ticket_number })
}
