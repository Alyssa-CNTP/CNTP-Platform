// app/api/production/notify-line-message/route.ts
// Fan an operator's line message (sendMessage(), lib/production/messages.ts)
// out to every production supervisor's notification bell, so a message
// logged during capture doesn't sit unseen until someone happens to open
// that section's chat. Best-effort side effect — never blocks the chat send
// that triggers it.

import { NextRequest, NextResponse } from 'next/server'
import { notify } from '@/lib/notifications'
import { resolveRecipients, getProductionSupervisorIds } from '@/lib/notifications/recipients'
import { sectionMeta } from '@/lib/production/capture-config'

export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    const sectionId: string | null = b.sectionId || null
    const body: string = (b.body ?? '').trim()
    const authorName: string = b.authorName || 'An operator'
    if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 })

    const supervisorIds = await getProductionSupervisorIds()
    const recipients = await resolveRecipients(supervisorIds)
    if (recipients.length === 0) return NextResponse.json({ notified: 0 })

    const sectionName = sectionId ? sectionMeta(sectionId).name : 'All lines'
    const params = new URLSearchParams({ tab: 'messages' })
    if (b.date)  params.set('date', b.date)
    if (b.shift) params.set('shift', b.shift)
    const url = sectionId ? `/production/capture/${sectionId}?${params.toString()}` : '/supervisor/productions'

    const result = await notify({
      recipients,
      kind: 'production_message',
      title: `${authorName} — ${sectionName}`,
      body,
      url,
      urgent: !!b.urgent,
      channels: b.urgent ? ['inApp', 'email'] : ['inApp'],
    })
    return NextResponse.json({ notified: result.inApp })
  } catch (err: any) {
    console.error('[api/production/notify-line-message POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
