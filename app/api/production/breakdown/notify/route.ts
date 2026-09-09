// app/api/production/breakdown/notify/route.ts
//
// Tells the maintenance manager that a production line is down, from the
// operator's timesheet rather than from a job card.
//
// ── Why this route exists at all ────────────────────────────────────────────
//
// A breakdown reaches the platform two ways, and until now only one of them
// reached maintenance. A job card raised in the maintenance module notifies
// them; an operator logging "machine stopped" on their capture screen notified
// nobody — the note sat in a jsonb array on a timesheet until somebody read a
// shift report the next morning. The line was down for an hour before anyone
// with a spanner was told.
//
// Notification-only. This route NEVER writes a job card and never touches the
// maintenance schema: raising and allocating work is the maintenance module's
// workflow, and a capture screen quietly creating cards would make it a second
// owner of that lifecycle. What it does is make sure the right people know,
// with a deep link to the section so the manager can decide whether a card is
// needed.
//
// Best-effort by design. The stoppage is already saved on the operator's
// timesheet before this is called; a failure here must never look to the
// operator like their breakdown was not recorded.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import {
  resolveRecipients, getMaintenanceManagerIds, getProductionSupervisorIds,
} from '@/lib/notifications/recipients'
import { sectionMeta } from '@/lib/production/capture-config'

export const runtime = 'nodejs'

function fmtSast(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-ZA', {
      timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const b = await req.json().catch(() => ({}))
    const stoppageId = String(b.stoppageId ?? '').trim()
    const sectionId  = String(b.sectionId ?? '').trim()
    if (!stoppageId || !sectionId) {
      return NextResponse.json({ error: 'stoppageId and sectionId required' }, { status: 400 })
    }

    const machine     = (b.machine ?? '').toString().trim()
    const area        = (b.area ?? '').toString().trim()
    const description = (b.description ?? '').toString().trim()
    const operator    = (b.operatorName ?? caller.name ?? 'An operator').toString().trim()
    const startedAt   = (b.startedAt ?? new Date().toISOString()).toString()
    const jobCardId   = b.jobCardId == null ? null : Number(b.jobCardId)

    const section = sectionMeta(sectionId)
    const where = machine || area || section.name

    // Maintenance managers are the point of the message; production
    // supervisors are copied because the shift's own numbers are about to move
    // and the supervisor is who signs the breakdown off on the timesheet.
    const [managerIds, supervisorIds] = await Promise.all([
      getMaintenanceManagerIds(),
      getProductionSupervisorIds(),
    ])
    // De-duplicated: one person holding both roles gets one notification, not two.
    const recipients = await resolveRecipients([...new Set([...managerIds, ...supervisorIds])])

    if (recipients.length === 0) {
      // Nobody to tell is not an error the operator can act on, but it IS
      // something worth finding in the logs when a manager says they were
      // never informed.
      console.warn('[api/production/breakdown/notify] no maintenance manager or production supervisor is configured')
      return NextResponse.json({ ok: true, notified: 0, notifiedAt: new Date().toISOString() })
    }

    await notify({
      recipients,
      kind:   'breakdown',
      source: 'production',
      title:  `Breakdown — ${section.name}${machine ? ` · ${machine}` : ''}`,
      body:
        `${operator} logged a breakdown on ${where} at ${fmtSast(startedAt)}.` +
        (description ? ` ${description}` : '') +
        (jobCardId ? ` Linked to job card ${jobCardId}.` : ' No job card raised yet.'),
      // Deep link to the capture screen's timesheet, where the stoppage lives
      // and where a supervisor signs it.
      url:      `/production/capture/${sectionId}?tab=timesheet`,
      urgent:   true,
      // Urgent reaches email/WhatsApp as well as the bell: a line that is down
      // is the case the urgent channel exists for.
      channels: ['inApp', 'email', 'urgent'],
      refTable: 'production.timesheet_stoppages',
      refId:    stoppageId,
      cardId:   jobCardId,
      fromName: operator,
    })

    return NextResponse.json({
      ok: true,
      notified: recipients.length,
      notifiedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('[api/production/breakdown/notify POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
