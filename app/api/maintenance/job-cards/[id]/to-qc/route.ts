// app/api/maintenance/job-cards/[id]/to-qc/route.ts
// Hand-off to Quality when a completed job card needs a post-maintenance QC
// check. Notifies the station QC mapped to the card's area (area_qc.qc_user_id)
// if set, otherwise every Quality-department user, so the Quality dashboard can
// surface the pending QC check. Best-effort: the card is already in the
// maintenance qc_check queue regardless of whether this notification lands.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients, getQualityUserIds } from '@/lib/notifications/recipients'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const { id } = await params
    const cardId = Number(id)
    const b = await req.json().catch(() => ({}))
    const area: string = b.area ?? ''
    const cardNo: string = b.card_no ?? `#${cardId}`

    const db = await getSessionClient()

    // Prefer the QC mapped to this station/area; fall back to all Quality users.
    let recipientIds: string[] = []
    if (area) {
      const { data: map } = await db.schema('maintenance' as any).from('area_qc')
        .select('qc_user_id').eq('area', area).maybeSingle()
      if (map?.qc_user_id) recipientIds = [map.qc_user_id]
    }
    if (recipientIds.length === 0) recipientIds = await getQualityUserIds()

    const recipients = await resolveRecipients(recipientIds)
    if (recipients.length) {
      await notify({
        recipients, kind: 'qc_check', cardId,
        url: `/maintenance/job-cards/${cardId}`,
        title: `QC check required — job card ${cardNo}`,
        body: `Maintenance is complete on ${area || 'a job card'} and needs a post-maintenance QC check before the work can be verified.`,
        channels: ['inApp', 'email'],
      })
    }

    return NextResponse.json({ ok: true, notified: recipients.length })
  } catch (err: any) {
    console.error('[api/maintenance/job-cards/[id]/to-qc POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
