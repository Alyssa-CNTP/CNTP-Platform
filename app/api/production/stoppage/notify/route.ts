// app/api/production/stoppage/notify/route.ts
//
// Tells whichever team can act that a production line has stopped, from the
// operator's timesheet.
//
// ── Why this route exists at all ────────────────────────────────────────────
//
// A stoppage reached the platform two ways, and only one of them reached
// anybody. A job card raised in the maintenance module notifies them; an
// operator logging "machine stopped" on their capture screen notified nobody —
// the note sat in a jsonb array on a timesheet until somebody read a shift
// report the next morning. The line was down for an hour before anyone with a
// spanner was told.
//
// ── The operator is the source, and the direction only runs one way ─────────
//
// The OPERATOR stops the machine, so the operator is who knows it stopped and
// when. This route carries that news outward. It does not, and must not, read a
// job card to decide when the line went down: maintenance is told after the
// fact, so their clock is always later than the stoppage and sometimes hours
// later. An earlier design took the start time from `job_cards.started_at` and
// had it backwards.
//
// Notification-only. This NEVER writes a job card and never touches the
// maintenance schema: raising and allocating work is the maintenance module's
// workflow, and a capture screen quietly creating cards would make it a second
// owner of that lifecycle. What it does is make sure the right people know,
// with a deep link to the section.
//
// Best-effort by design. The stoppage is already saved on the operator's
// timesheet before this is called; a failure here must never look to the
// operator like their stoppage was not recorded.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import {
  resolveRecipients, getMaintenanceManagerIds, getProductionSupervisorIds,
  getITUserIds,
} from '@/lib/notifications/recipients'
import { sectionMeta } from '@/lib/production/capture-config'
import { STOPPAGE_META, isStoppageKind } from '@/lib/core/timesheet/stoppages'

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
    const rawKind    = String(b.kind ?? '').trim()
    if (!stoppageId || !sectionId) {
      return NextResponse.json({ error: 'stoppageId and sectionId required' }, { status: 400 })
    }
    if (!isStoppageKind(rawKind)) {
      return NextResponse.json({ error: `unknown stoppage kind: ${rawKind}` }, { status: 400 })
    }

    const meta = STOPPAGE_META[rawKind]
    // The routing decision is the KIND's, taken from core — not the client's.
    // A browser choosing its own recipients is a browser that can page whoever
    // it likes.
    const team = meta.notify
    if (!team) {
      // Nothing to send: a tea break or a scheduled clean is not news. Answered
      // as a success with a timestamp, so the caller stamps `notified_at` and
      // stops asking rather than retrying a send that will never happen.
      return NextResponse.json({
        ok: true, notified: 0, team: null, notifiedAt: new Date().toISOString(),
      })
    }

    const area       = (b.area ?? '').toString().trim()
    const description = (b.description ?? '').toString().trim()
    const operator   = (b.operatorName ?? caller.name ?? 'An operator').toString().trim()
    const startedAt  = (b.startedAt ?? new Date().toISOString()).toString()

    const section = sectionMeta(sectionId)
    const where = area || section.name

    // The owning team, plus the production supervisors in every case — the
    // shift's own numbers are about to move, and the supervisor is who signs a
    // breakdown off on the timesheet.
    const owner =
      team === 'maintenance' ? await getMaintenanceManagerIds()
      : team === 'it'        ? await getITUserIds()
      : []
    const supervisors = await getProductionSupervisorIds()
    // De-duplicated: one person holding both roles gets one notification.
    const recipients = await resolveRecipients([...new Set([...owner, ...supervisors])])

    if (recipients.length === 0) {
      // Nobody to tell is not something the operator can act on, but it IS
      // worth finding in the logs when a manager says they were never informed.
      console.warn(`[api/production/stoppage/notify] no recipients configured for team "${team}"`)
      return NextResponse.json({
        ok: true, notified: 0, team, notifiedAt: new Date().toISOString(),
      })
    }

    await notify({
      recipients,
      kind:   rawKind === 'breakdown' ? 'breakdown' : 'stoppage',
      source: 'production',
      title:  `${meta.label} — ${section.name}`,
      body:
        `${operator} stopped the line at ${where} at ${fmtSast(startedAt)}.` +
        (description ? ` ${description}` : '') +
        (rawKind === 'breakdown'
          ? ' A production supervisor still needs to confirm it.'
          : ''),
      // Deep link to the capture screen's sign-off, where the timesheet lives
      // and where a supervisor signs a breakdown.
      url:      `/production/capture/${sectionId}?tab=signoff`,
      urgent:   true,
      // Urgent reaches email/WhatsApp as well as the bell: a line that is down
      // is the case the urgent channel exists for.
      channels: ['inApp', 'email', 'urgent'],
      refTable: 'production.timesheet_stoppages',
      refId:    stoppageId,
      fromName: operator,
    })

    return NextResponse.json({
      ok: true,
      notified: recipients.length,
      team,
      notifiedAt: new Date().toISOString(),
    })
  } catch (err: unknown) {
    console.error('[api/production/stoppage/notify POST]', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
