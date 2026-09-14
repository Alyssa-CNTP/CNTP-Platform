// app/api/maintenance/job-cards/[id]/to-qc/route.ts
// Hand-off to Quality when a completed job card needs a post-maintenance QC
// check. Notifies the station QC mapped to the card's area (area_qc.qc_user_id)
// if set, otherwise every Quality-department user.
//
// IN-APP ONLY — no email. It surfaces as a popup on whatever screen the person
// is working at (components/layout/WorkRequestPopup) and stays there until they
// open it or defer it. The lab works at a bench, not in an inbox.
//
// Best-effort: the card is already in the maintenance qc_check queue regardless
// of whether this notification lands.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients, getQualityStaff } from '@/lib/notifications/recipients'

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

    // Prefer the QC mapped to this station/area — that is one named person, so
    // they get the in-app notification AND the email.
    let mappedQcId: string | null = null
    if (area) {
      const { data: map } = await db.schema('maintenance' as any).from('area_qc')
        .select('qc_user_id').eq('area', area).maybeSingle()
      mappedQcId = map?.qc_user_id ?? null
    }

    // IN-APP ONLY, deliberately — no email. The lab works at a bench with the app
    // open, not in an inbox, and Quality is ~17 people: a mail per job card would
    // be noise they learn to ignore. This lands as an alert on the screen they
    // are already looking at (see MaintenanceAlerts / the QC queue).
    const recipientIds = mappedQcId ? [mappedQcId] : (await getQualityStaff()).map(s => s.userId)
    const recipients = await resolveRecipients(recipientIds)
    if (recipients.length) {
      await notify({
        recipients, kind: 'qc_check', cardId,
        url: `/maintenance/job-cards/${cardId}`,
        title: `QC check required — job card ${cardNo}`,
        body: `Maintenance is complete on ${area || 'a job card'} and needs a post-maintenance QC check before the work can be verified.`,
        channels: ['inApp'],
      })
    }

    return NextResponse.json({ ok: true, notified: recipients.length })
  } catch (err: any) {
    console.error('[api/maintenance/job-cards/[id]/to-qc POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
