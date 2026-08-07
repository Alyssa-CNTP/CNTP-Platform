// app/api/maintenance/checklists/notify-assignment/route.ts
// Fires an in-app + email notification to a technician when a weekly / monthly
// maintenance checklist is allocated to them (manual pick or auto-allocate).
// The allocation itself is written client-side (checklist_completions upsert);
// this route only sends the notification, best-effort.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients } from '@/lib/notifications/recipients'

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const b = await req.json()
    const techUserId = b.techUserId as string | undefined
    const area = b.area as string | undefined
    const frequency = b.frequency as 'weekly' | 'monthly' | undefined
    const period = b.period as string | undefined
    if (!techUserId || !area || !frequency) return NextResponse.json({ error: 'techUserId, area, frequency required' }, { status: 400 })

    const [tech] = await resolveRecipients([techUserId])
    if (tech) {
      await notify({
        recipients: [tech], kind: 'checklist_assign', url: '/maintenance/scheduled',
        title: `New ${frequency} checklist assigned — ${area}`,
        body: `You've been assigned the ${area} ${frequency} checklist${period ? ` for ${period}` : ''}. Please complete it.`,
        channels: ['inApp', 'email'], source: 'maintenance',
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[api/maintenance/checklists/notify-assignment POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
