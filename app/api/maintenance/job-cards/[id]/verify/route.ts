// app/api/maintenance/job-cards/[id]/verify/route.ts
// Two-stage verification chain, routed by the card's CURRENT status:
//   • verify      (originator): satisfactory → hand off to the maintenance manager
//                 (status → mgr_verify) and notify the managers. Not satisfactory →
//                 bounce back to the assigned technician.
//   • mgr_verify  (manager): the maintenance manager gives the FINAL sign-off →
//                 close + clean up chat photos. Not satisfactory → bounce to tech.
// The same client call (verifyCard(ok)) drives both stages — the stage is decided
// here from the stored status, so nothing else has to change.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient, getAdminClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients, getMaintenanceManagerIds } from '@/lib/notifications/recipients'

const BUCKET = 'maintenance-card-photos'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getCallerPermissions()
    // The manager (can_verify_jobs) or the original raiser may act at the originator
    // stage; the manager sign-off stage requires can_verify_jobs (checked below).
    if (!caller.can('can_verify_jobs') && !caller.userId)
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const { id } = await params
    const cardId = Number(id)
    const b = await req.json()
    const ok = b.ok === true
    const db = await getSessionClient()

    const { data: existing } = await db.schema('maintenance' as any).from('job_cards')
      .select('card_no, area, description, status, assigned_to, assigned_user_id, reopen_count, raised_by').eq('id', cardId).single()
    if (!existing) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    // Manager sign-off stage only when the card is already at mgr_verify.
    const managerStage = existing.status === 'mgr_verify'
    if (managerStage && !caller.can('can_verify_jobs'))
      return NextResponse.json({ error: 'Only the maintenance manager can give the final sign-off.' }, { status: 403 })

    if (ok && !managerStage) {
      // ── Originator satisfied → hand off to the maintenance manager for sign-off ──
      await db.schema('maintenance' as any).from('job_cards')
        .update({ status: 'mgr_verify', updated_at: new Date().toISOString() })
        .eq('id', cardId)
      await db.schema('maintenance' as any).from('job_card_logs').insert({
        card_id: cardId, kind: 'event', stage: 'mgr_verify', author: b.actor ?? existing.raised_by ?? 'Originator',
        body: 'Originator satisfied — sent to the maintenance manager for final sign-off.',
      })
      const mgrIds = await getMaintenanceManagerIds()
      const mgrs = await resolveRecipients(mgrIds)
      if (mgrs.length) await notify({ recipients: mgrs, kind: 'verify', cardId, url: `/maintenance/job-cards/${cardId}`,
        title: `Job card ${existing.card_no} awaiting your sign-off`,
        body: `${existing.area}: ${existing.description}. Originator satisfied — please give the final sign-off.`,
        channels: ['inApp', 'email'] })
    } else if (ok) {
      // ── Manager final sign-off → close + clean up chat photos ──
      await db.schema('maintenance' as any).from('job_cards')
        .update({ status: 'complete', verified_at: new Date().toISOString(), verified_ok: true, updated_at: new Date().toISOString() })
        .eq('id', cardId)
      await db.schema('maintenance' as any).from('job_card_logs').insert({
        card_id: cardId, kind: 'event', stage: 'complete', author: b.actor ?? 'Maintenance Manager',
        body: 'Maintenance manager signed off the work as SATISFACTORY. Job card closed.',
      })
      // Auto-clean chat photos for the closed card (best-effort, service role).
      try {
        const admin = getAdminClient()
        const { data: files } = await admin.storage.from(BUCKET).list(`card/${cardId}`, { limit: 1000 })
        if (files?.length) await admin.storage.from(BUCKET).remove(files.map(f => `card/${cardId}/${f.name}`))
      } catch (e: any) { console.warn('[verify] photo cleanup skipped:', e?.message) }
    } else {
      const reopen = (existing.reopen_count ?? 0) + 1
      await db.schema('maintenance' as any).from('job_cards')
        .update({ status: 'in_progress', verified_ok: false, reopen_count: reopen, completed_at: null, updated_at: new Date().toISOString() })
        .eq('id', cardId)
      await db.schema('maintenance' as any).from('job_card_logs').insert({
        card_id: cardId, kind: 'event', stage: 'in_progress', author: b.actor ?? 'Verifier',
        body: `Work marked NOT SATISFACTORY — returned to ${existing.assigned_to}. Reopen #${reopen}.` + (b.note ? ` Note: ${b.note}` : ''),
      })
      if (existing.assigned_user_id) {
        const [tech] = await resolveRecipients([existing.assigned_user_id])
        if (tech) await notify({ recipients: [tech], kind: 'verify_bounce', cardId, url: `/maintenance/job-cards/${cardId}`,
          title: `Job card ${existing.card_no} returned to you`,
          body: `The work was not accepted${b.note ? `: ${b.note}` : ''}. Please review and redo.`,
          channels: ['inApp', 'email'] })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[api/maintenance/job-cards/[id]/verify POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
