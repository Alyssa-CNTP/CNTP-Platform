// app/api/maintenance/notify/parts-issued/route.ts
// Notification-only endpoint: the manager has issued / received the parts a
// technician was waiting on, so tell that technician the parts are available and
// the job can resume. The spare_requests row itself is still written
// client-side (setRequestStatus) — this route only notifies.
//
// The recipient is the technician who RAISED the request
// (spare_requests.requested_by_user_id), looked up server-side so the client
// never has to pass a user id it may not hold.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients } from '@/lib/notifications/recipients'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const b = await req.json().catch(() => ({}))
    const requestId = Number(b.requestId)
    if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 })

    const db = await getSessionClient()
    const { data: reqRow } = await db.schema('maintenance' as any).from('spare_requests')
      .select('id, description, part_no, qty, card_id, requested_by, requested_by_user_id')
      .eq('id', requestId).single()
    if (!reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    if (!reqRow.requested_by_user_id) return NextResponse.json({ ok: true, skipped: 'no requester user id' })

    // Card number (if the request came off a job card) so the tech can jump straight to it.
    let cardNo = ''
    if (reqRow.card_id) {
      const { data: card } = await db.schema('maintenance' as any).from('job_cards')
        .select('card_no').eq('id', reqRow.card_id).single()
      cardNo = card?.card_no ?? ''
    }

    const [tech] = await resolveRecipients([reqRow.requested_by_user_id])
    if (tech) {
      await notify({
        recipients: [tech],
        kind: 'parts_issued',
        cardId: reqRow.card_id ?? null,
        url: reqRow.card_id ? `/maintenance/job-cards/${reqRow.card_id}` : '/maintenance/stock',
        title: `Parts available${cardNo ? ` for ${cardNo}` : ''}`,
        body: `${reqRow.qty} × ${reqRow.part_no || reqRow.description} has been issued and is available for collection.` +
          (cardNo ? ` You can resume ${cardNo}.` : ''),
        channels: ['inApp', 'email'],
        source: 'maintenance',
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[api/maintenance/notify/parts-issued POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
