// lib/production/it-ticket.ts
// Raise an 'app'-category Axis ticket routed to IT (auto-assigns Alyssa,
// notifies Jan — mirrors resolveRouting() in app/api/axis/tickets/route.ts).
//
// Used by flows where the caller can't reach the public /api/axis/tickets
// route because it requires can_assign_tickets (e.g. a staff manager
// requesting a login, or an offboard needing IT to delete an auth account).
// Inserts directly with the service-role client instead.

import { getAdminClient } from '@/lib/auth/server-helpers'

// Throws on ticket-insert failure — the ticket is the actual deliverable here,
// not a side channel, so callers must not treat a failure as silent success.
export async function raiseItTicket(opts: {
  title: string
  description: string
  createdBy: string | null
}): Promise<{ ticket_number: string | null }> {
  const admin = getAdminClient()

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

  const { data: ticket, error } = await (admin as any)
    .schema('axis')
    .from('tickets')
    .insert({
      title:           opts.title,
      description:     opts.description,
      category:        'app',
      ticket_type:     'task',
      priority:        'medium',
      assigned_to:     assignTo,
      assigned_name:   assignName,
      created_by:      opts.createdBy,
      created_by_name: null,
      due_date:        null,
      notify_user_ids: notifyIds,
      auto_routed:     true,
      status:          'open',
    })
    .select('id, ticket_number')
    .single()

  if (error) {
    console.error('[raiseItTicket]', error)
    throw new Error(error.message || 'Could not create the IT ticket')
  }

  if (notifyIds.length > 0 && ticket) {
    const notifications = notifyIds.map((uid: string) => ({
      ticket_id: ticket.id,
      user_id:   uid,
      message:   `${ticket.ticket_number}: ${opts.title} — app ticket auto-routed`,
    }))
    await (admin as any).schema('axis').from('ticket_notifications').insert(notifications)
  }

  return { ticket_number: ticket?.ticket_number ?? null }
}
