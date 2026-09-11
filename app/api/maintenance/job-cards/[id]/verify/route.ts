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
    // One typed handle for the schema instead of re-casting at all seven call
    // sites — supabase-js has no generated type for `maintenance`, so the cast
    // belongs in one place rather than scattered through the handler.
    const maint = db.schema('maintenance' as any)

    const { data: existing } = await maint.from('job_cards')
      .select('card_no, area, machine, description, long_desc, status, assigned_to, assigned_user_id, reopen_count, raised_by, urgency, temp_repair, temp_repair_note, temp_repair_by, follow_up_card_id')
      .eq('id', cardId).single()
    if (!existing) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    if (ok) {
      // ── Manager final sign-off → close + clean up chat photos ──
      await maint.from('job_cards')
        .update({ status: 'complete', verified_at: new Date().toISOString(), verified_ok: true, updated_at: new Date().toISOString() })
        .eq('id', cardId)
      await maint.from('job_card_logs').insert({
        card_id: cardId, kind: 'event', stage: 'complete', author: b.actor ?? 'Maintenance Manager',
        body: 'Maintenance manager signed off the work as SATISFACTORY. Job card closed.',
      })
      // Auto-clean chat photos for the closed card (best-effort, service role).
      try {
        const admin = getAdminClient()
        const { data: files } = await admin.storage.from(BUCKET).list(`card/${cardId}`, { limit: 1000 })
        if (files?.length) await admin.storage.from(BUCKET).remove(files.map(f => `card/${cardId}/${f.name}`))
      } catch (e: any) { console.warn('[verify] photo cleanup skipped:', e?.message) }
      // ── Temporary repair → raise the permanent-repair card ──
      // A temporary fix closing as "complete" would otherwise be the last word
      // on that machine. Raising the follow-up HERE, at sign-off, means it is
      // created exactly once, by the same action that closes the temporary one,
      // and only for work that actually happened — not the moment a technician
      // ticks a box on a job they might still abandon.
      //
      // follow_up_card_id is the guard: if a sign-off is ever retried, the link
      // is already set and no second card is raised.
      if (existing.temp_repair && !existing.follow_up_card_id) {
        try {
          const detail = (existing.temp_repair_note ?? '').trim()
          const { data: followUp, error: fErr } = await maint.from('job_cards')
            .insert({
              workflow: 'planned',
              area: existing.area,
              machine: existing.machine,
              maint_types: ['Repair'],
              description: `Permanent repair — ${existing.description}`.slice(0, 200),
              long_desc:
                `Raised automatically because ${existing.card_no} was closed as a TEMPORARY repair` +
                `${existing.temp_repair_by ? ` by ${existing.temp_repair_by}` : ''}.\n\n` +
                (detail ? `Still outstanding: ${detail}\n\n` : '') +
                `Original fault: ${existing.description}` +
                (existing.long_desc ? `\n${existing.long_desc}` : ''),
              // The permanent repair inherits the temporary card's urgency — the
              // machine is running on a stopgap, so this is not fresh low-priority work.
              urgency: existing.urgency ?? null,
              raised_by: 'System (temporary repair follow-up)',
              raised_by_user_id: caller.userId,
              follow_up_of_card_id: cardId,
            })
            .select('id, card_no').single()
          if (fErr) throw fErr

          await maint.from('job_cards')
            .update({ follow_up_card_id: followUp.id }).eq('id', cardId)

          await maint.from('job_card_logs').insert([
            { card_id: cardId, kind: 'event', stage: 'complete', author: 'System',
              body: `Closed as a TEMPORARY repair — permanent-repair job card ${followUp.card_no} raised automatically.` },
            { card_id: followUp.id, kind: 'event', stage: 'raised', author: 'System',
              body: `Raised automatically from temporary repair ${existing.card_no}. Awaiting maintenance manager allocation.` },
          ])

          // The manager who just signed off is the one who must allocate it.
          const mgrs = await resolveRecipients(await getMaintenanceManagerIds())
          if (mgrs.length) await notify({
            recipients: mgrs, kind: 'assignment', cardId: followUp.id,
            url: `/maintenance/job-cards/${followUp.id}`,
            title: `Permanent repair ${followUp.card_no} to allocate`,
            body: `${existing.card_no} on ${existing.machine || existing.area} was closed as a temporary repair. ` +
                  (detail ? `Outstanding: ${detail}. ` : '') + 'This follow-up card needs allocating.',
            channels: ['inApp', 'email'],
          })
        } catch (e: unknown) {
          // Best-effort: never block the sign-off the manager just made. The
          // temporary-repair flag stays set with no follow-up link, so the card
          // is still findable as an outstanding temporary repair.
          console.error('[verify] permanent-repair follow-up failed:', e instanceof Error ? e.message : e)
        }
      }

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
      await maint.from('job_cards')
        .update({ status: 'in_progress', verified_ok: false, reopen_count: reopen, completed_at: null, updated_at: new Date().toISOString() })
        .eq('id', cardId)
      await maint.from('job_card_logs').insert({
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
