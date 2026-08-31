// app/api/maintenance/notify/pause/route.ts
// Notification-only endpoint for the job-card pause flow. The pause itself is
// still written client-side (pauseJob → upJC), so this route never mutates the
// card — it only tells the maintenance manager(s) that a job has stopped and
// why. Fired best-effort; a failure here must never block the pause.
//
// "Waiting for parts or tools" is called out explicitly in the notification so
// the manager sees a parts hold without opening the card.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients, getMaintenanceManagerIds } from '@/lib/notifications/recipients'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const b = await req.json().catch(() => ({}))
    const cardId = Number(b.cardId)
    const cardNo = (b.cardNo ?? '').toString()
    const area = (b.area ?? '').toString()
    const reason = (b.reason ?? '').toString().trim()
    const tech = (b.tech ?? caller.name ?? '').toString()
    if (!cardId) return NextResponse.json({ error: 'cardId required' }, { status: 400 })

    const waitingForParts = /parts|tools/i.test(reason)

    const managers = await resolveRecipients(await getMaintenanceManagerIds())
    if (managers.length) {
      await notify({
        recipients: managers,
        kind: waitingForParts ? 'pause_parts' : 'pause',
        cardId,
        url: `/maintenance/job-cards/${cardId}`,
        title: waitingForParts
          ? `Job card ${cardNo} paused — PARTS NEEDED`
          : `Job card ${cardNo} paused`,
        body: `${area}${tech ? ` · ${tech}` : ''} — ${reason || 'on hold'}.` +
          (waitingForParts ? ' The technician is waiting on parts or tools before work can continue.' : ''),
        channels: ['inApp', 'email'],
        source: 'maintenance',
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[api/maintenance/notify/pause POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
