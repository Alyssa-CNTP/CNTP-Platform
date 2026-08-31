// app/api/maintenance/job-cards/[id]/verify/route.ts
// FINAL SIGN-OFF by the maintenance manager. The old originator ("satisfactory")
// step was removed — QC and the manager are now the two checkpoints, so a card
// goes qc_check → mgr_verify → complete (or straight to mgr_verify when QC is
// not required). Satisfactory → close + clean up chat photos. Not satisfactory →
// bounce back to the assigned technician.
//
// Legacy cards may still sit at the retired 'verify' status; those are treated
// exactly like mgr_verify so nothing gets stranded mid-chain.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient, getAdminClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients, getMaintenanceManagerIds } from '@/lib/notifications/recipients'

const BUCKET = 'maintenance-card-photos'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getCallerPermissions()
    // Only the maintenance manager signs a card off now.
    if (!caller.can('can_verify_jobs'))
      return NextResponse.json({ error: 'Only the maintenance manager can sign a job card off.' }, { status: 403 })

    const { id } = await params
    const cardId = Number(id)
    const b = await req.json()
    const ok = b.ok === true
    const db = await getSessionClient()

    const { data: existing } = await db.schema('maintenance' as any).from('job_cards')
      .select('card_no, area, description, status, assigned_to, assigned_user_id, reopen_count, raised_by').eq('id', cardId).single()
    if (!existing) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    if (ok) {
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
      // Technicians don't see the verify/sign-off screens — let them know the
      // job they worked on is done.
      if (existing.assigned_user_id) {
        const [tech] = await resolveRecipients([existing.assigned_user_id])
        if (tech) await notify({ recipients: [tech], kind: 'complete', cardId, url: `/maintenance/job-cards/${cardId}`,
          title: `Job card ${existing.card_no} completed`,
          body: `${existing.area}: ${existing.description}. Signed off by the maintenance manager — nice work.`,
          channels: ['inApp', 'email'] })
      }
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
