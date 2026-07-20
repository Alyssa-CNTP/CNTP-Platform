// lib/production/it-ticket.ts
// Raise an 'app'-category Axis ticket routed to IT — created unassigned,
// notifies everyone eligible to manage tickets (IT department, or holding
// can_assign_tickets) rather than a hardcoded person.
//
// Used by flows where the caller can't reach the public /api/axis/tickets
// route because it requires can_assign_tickets (e.g. a staff manager
// requesting a login, or an offboard needing IT to delete an auth account).
// Inserts directly with the service-role client instead.

import { getAdminClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { getTicketManagerIds, resolveRecipients } from '@/lib/notifications/recipients'

// Throws on ticket-insert failure — the ticket is the actual deliverable here,
// not a side channel, so callers must not treat a failure as silent success.
export async function raiseItTicket(opts: {
  title: string
  description: string
  createdBy: string | null
}): Promise<{ ticket_number: string | null }> {
  const admin = getAdminClient()

  const { data: ticket, error } = await (admin as any)
    .schema('axis')
    .from('tickets')
    .insert({
      title:           opts.title,
      description:     opts.description,
      category:        'app',
      ticket_type:     'task',
      priority:        'medium',
      assigned_to:     null,
      assigned_name:   null,
      created_by:      opts.createdBy,
      created_by_name: null,
      due_date:        null,
      status:          'open',
    })
    .select('id, ticket_number')
    .single()

  if (error) {
    console.error('[raiseItTicket]', error)
    throw new Error(error.message || 'Could not create the IT ticket')
  }

  const managerIds = await getTicketManagerIds()
  const recipients  = await resolveRecipients(managerIds)
  if (recipients.length > 0 && ticket) {
    await notify({
      recipients,
      kind:     'ticket_created',
      title:    `New ticket ${ticket.ticket_number}`,
      body:     opts.title,
      url:      '/axis/tickets',
      channels: ['inApp'],
    })
  }

  return { ticket_number: ticket?.ticket_number ?? null }
}
