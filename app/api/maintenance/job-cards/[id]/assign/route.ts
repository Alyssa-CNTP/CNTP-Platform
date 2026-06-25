// app/api/maintenance/job-cards/[id]/assign/route.ts
// Manager allocates a planned job card to a technician (or external company).
// GET pre-suggests the on-duty technician.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient } from '@/lib/auth/server-helpers'
import { resolveOnDutyTechnician } from '@/lib/maintenance/roster'
import { notify } from '@/lib/notifications'
import { resolveRecipients } from '@/lib/notifications/recipients'

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.can('can_allocate_jobs')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  const db = await getSessionClient()

  // All technicians on duty right now, ranked least-busy first so the breakdown /
  // job goes to whoever is NOT already tied up on a card.
  const nowIso = new Date().toISOString()
  const { data: onDuty } = await db.schema('maintenance' as any).from('duty_roster')
    .select('technician, technician_user_id, start_at, end_at')
    .lte('start_at', nowIso).gte('end_at', nowIso)

  let suggested = await resolveOnDutyTechnician(db)
  if (onDuty && onDuty.length) {
    // Count each on-duty tech's live workload (assigned + in-progress, not paused).
    const names = Array.from(new Set(onDuty.map((r: any) => r.technician)))
    const { data: openCards } = await db.schema('maintenance' as any).from('job_cards')
      .select('assigned_to, status, paused').in('status', ['assigned', 'in_progress'])
    const load = (name: string) => (openCards ?? []).filter((c: any) => c.assigned_to === name && !(c.status === 'in_progress' && c.paused)).length
    const ranked = onDuty
      .map((r: any) => ({ userId: r.technician_user_id ?? null, name: r.technician, load: load(r.technician) }))
      .sort((a: any, b: any) => a.load - b.load)
    if (ranked[0]) suggested = { userId: ranked[0].userId, name: ranked[0].name }
    return NextResponse.json({ suggested, onDuty: ranked.map((r: any) => ({ name: r.name, userId: r.userId, load: r.load })) })
  }
  return NextResponse.json({ suggested, onDuty: [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.can('can_allocate_jobs')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    const { id } = await params
    const cardId = Number(id)
    const b = await req.json()

    const external = !!b.external
    if (external && !b.external_company) return NextResponse.json({ error: 'External company name required' }, { status: 400 })
    if (!external && !b.assigned_to)     return NextResponse.json({ error: 'Select a technician' }, { status: 400 })

    const VALID_URGENCY = ['low', 'medium', 'high', 'critical']
    const urgency = VALID_URGENCY.includes(b.urgency) ? b.urgency : null

    const db = await getSessionClient()
    const update: any = {
      status: 'assigned', assigned_to: external ? b.external_company : b.assigned_to,
      assigned_user_id: external ? null : (b.assigned_user_id ?? null),
      assigned_at: new Date().toISOString(),
      external, external_company: external ? b.external_company : '',
      qc_required: b.qc_required !== false, urgency, updated_at: new Date().toISOString(),
    }
    const { data: card, error } = await db.schema('maintenance' as any).from('job_cards')
      .update(update).eq('id', cardId).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await db.schema('maintenance' as any).from('job_card_logs').insert({
      card_id: cardId, kind: 'event', stage: 'assigned', author: b.actor ?? 'Maintenance Manager',
      body: (external ? `Allocated to EXTERNAL company ${b.external_company}` : `Allocated to technician ${b.assigned_to}`) +
            ` • QC check ${update.qc_required ? 'REQUIRED' : 'NOT required'}` +
            (urgency ? ` • Urgency: ${urgency.toUpperCase()}` : ''),
    })

    // Notify the assigned internal technician to open the app.
    if (!external && update.assigned_user_id) {
      const [tech] = await resolveRecipients([update.assigned_user_id])
      if (tech) await notify({ recipients: [tech], kind: 'assignment', cardId, url: `/maintenance/job-cards/${cardId}`,
        title: `New job card ${card.card_no} assigned to you`,
        body: `${card.area}: ${card.description}. Please open the app to view and accept.`,
        channels: ['inApp', 'email'] })
    }

    return NextResponse.json({ card })
  } catch (err: any) {
    console.error('[api/maintenance/job-cards/[id]/assign POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
