// app/api/maintenance/job-cards/route.ts
// Server-side job-card creation. Enforces the breakdown gate (Production only),
// auto-routes breakdowns to the on-duty technician, and fires notifications.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient } from '@/lib/auth/server-helpers'
import { resolveOnDutyTechnician } from '@/lib/maintenance/roster'
import { notify } from '@/lib/notifications'
import { resolveRecipients, getMaintenanceManagerIds } from '@/lib/notifications/recipients'

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const b = await req.json()
    const workflow: 'breakdown' | 'planned' = b.workflow === 'breakdown' ? 'breakdown' : 'planned'

    // ── Gate: only Production (or an explicit permission) may raise a breakdown ──
    if (workflow === 'breakdown' && caller.department !== 'Production' && !caller.can('can_raise_breakdown')) {
      return NextResponse.json(
        { error: 'Only Production can raise a breakdown. Please contact the maintenance manager, or raise a planned job card.' },
        { status: 403 }
      )
    }
    if (!b.area || !b.description) return NextResponse.json({ error: 'Area and description are required' }, { status: 400 })

    const db = await getSessionClient()
    const isBd = workflow === 'breakdown'
    const duty = isBd ? await resolveOnDutyTechnician(db) : null

    const row: any = {
      workflow, area: b.area, machine: b.machine || null,
      maint_types: isBd ? ['Breakdown'] : (b.maint_types ?? []),
      description: b.description, long_desc: b.long_desc ?? '',
      raised_by: b.raised_by ?? null, raised_by_user_id: caller.userId,
      photo_url: b.photo_url ?? null, ai_suggestion: b.ai_suggestion ?? '',
    }
    if (isBd && duty) {
      row.status = 'assigned'; row.assigned_to = duty.name
      row.assigned_user_id = duty.userId; row.assigned_at = new Date().toISOString()
    }

    const { data: card, error } = await db.schema('maintenance' as any).from('job_cards').insert(row).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Activity log (mirrors the original createJC copy)
    await db.schema('maintenance' as any).from('job_card_logs').insert({
      card_id: card.id, kind: 'event', stage: 'raised', author: b.raised_by ?? 'Unknown',
      body: isBd
        ? (duty ? `BREAKDOWN raised — auto-assigned to on-duty technician ${duty.name}. Manager informed. Timer running from raise.`
                : 'BREAKDOWN raised — NO TECHNICIAN ON DUTY. Awaiting urgent manager allocation.')
        : 'Planned/scheduled job card raised — awaiting maintenance manager allocation.',
    })

    // ── Notifications ──
    const url = `/maintenance/job-cards/${card.id}`
    const managerIds = await getMaintenanceManagerIds()
    if (isBd && duty?.userId) {
      const [tech] = await resolveRecipients([duty.userId])
      const mgrs = (await resolveRecipients(managerIds)).filter(m => m.userId !== duty.userId)
      await notify({ recipients: tech ? [tech] : [], kind: 'breakdown', urgent: true, cardId: card.id, url,
        title: `🔴 Breakdown ${card.card_no}: ${card.area}`,
        body: `${card.description} — you are on duty. Please attend on-site and report back.`,
        channels: ['inApp', 'email', 'urgent'] })
      if (mgrs.length) await notify({ recipients: mgrs, kind: 'breakdown', cardId: card.id, url,
        title: `Breakdown ${card.card_no} raised`, body: `${card.area}: ${card.description}. Assigned to ${duty.name}.`,
        channels: ['inApp', 'email'] })
    } else {
      const mgrs = await resolveRecipients(managerIds)
      if (mgrs.length) await notify({ recipients: mgrs, kind: isBd ? 'breakdown' : 'assignment', urgent: isBd, cardId: card.id, url,
        title: isBd ? `🔴 Breakdown ${card.card_no} — NO TECH ON DUTY` : `New job card ${card.card_no} to allocate`,
        body: `${card.area}: ${card.description}`, channels: isBd ? ['inApp', 'email', 'urgent'] : ['inApp', 'email'] })
    }

    return NextResponse.json({ card })
  } catch (err: any) {
    console.error('[api/maintenance/job-cards POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
