// app/api/maintenance/notify/qc-done/route.ts
// Notification-only endpoint fired when QC finishes a post-maintenance check.
// The status change itself is still written client-side (qcSubmit); this route
// only tells people where the card now sits, so nobody has to go looking:
//
//   • PASSED → the maintenance manager (it is now waiting on their final
//     sign-off) and the technician(s) who did the work.
//   • FAILED → the technician(s), because the card has come straight back to
//     them, plus the manager so a rework is visible.
//
// Recipients are resolved server-side from the card itself.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients, getMaintenanceManagerIds } from '@/lib/notifications/recipients'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const b = await req.json().catch(() => ({}))
    const cardId = Number(b.cardId)
    const passed = b.passed === true
    const qcName = (b.qcName ?? '').toString()
    const note = (b.note ?? '').toString().trim()
    if (!cardId) return NextResponse.json({ error: 'cardId required' }, { status: 400 })

    const db = await getSessionClient()
    const { data: card } = await db.schema('maintenance' as any).from('job_cards')
      .select('card_no, area, description, assigned_user_id, assigned_user_id_2').eq('id', cardId).single()
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    const url = `/maintenance/job-cards/${cardId}`
    const techIds = [card.assigned_user_id, card.assigned_user_id_2].filter(Boolean) as string[]
    const techs = techIds.length ? await resolveRecipients(techIds) : []
    const managers = await resolveRecipients(await getMaintenanceManagerIds())

    if (passed) {
      if (managers.length) await notify({
        recipients: managers, kind: 'qc_passed', cardId, url,
        title: `Job card ${card.card_no} passed QC — awaiting your sign-off`,
        body: `${card.area}: ${card.description}. QC${qcName ? ` (${qcName})` : ''} passed the check — it now needs your final sign-off.`,
        channels: ['inApp', 'email'], source: 'maintenance',
      })
      if (techs.length) await notify({
        recipients: techs, kind: 'qc_passed', cardId, url,
        title: `Job card ${card.card_no} passed QC`,
        body: `${card.area}: ${card.description}. QC${qcName ? ` (${qcName})` : ''} passed your work — the card is now with the maintenance manager for final sign-off.`,
        channels: ['inApp', 'email'], source: 'maintenance',
      })
    } else {
      if (techs.length) await notify({
        recipients: techs, kind: 'qc_failed', cardId, url,
        title: `Job card ${card.card_no} FAILED QC — back with you`,
        body: `${card.area}: ${card.description}. QC${qcName ? ` (${qcName})` : ''} found an issue${note ? `: ${note}` : ''}. The card has been returned to you to redo.`,
        channels: ['inApp', 'email'], source: 'maintenance',
      })
      if (managers.length) await notify({
        recipients: managers, kind: 'qc_failed', cardId, url,
        title: `Job card ${card.card_no} failed QC`,
        body: `${card.area}: ${card.description}. QC${qcName ? ` (${qcName})` : ''} returned it to the technician${note ? `: ${note}` : ''}.`,
        channels: ['inApp', 'email'], source: 'maintenance',
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[api/maintenance/notify/qc-done POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
