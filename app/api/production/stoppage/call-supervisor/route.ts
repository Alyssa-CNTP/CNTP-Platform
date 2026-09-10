// app/api/production/stoppage/call-supervisor/route.ts
//
// The operator's "come and look at this" — asking a production supervisor to
// confirm a breakdown they have logged.
//
// ── Why a separate route from ./notify ──────────────────────────────────────
//
// `notify` fires ONCE, automatically, when a stoppage is logged, and it tells
// whichever team can fix the thing (maintenance for a breakdown, IT for the
// system being down). This is different: it is the operator deliberately
// calling for a SIGNATURE, it targets production supervisors specifically, and
// it is repeatable — because a supervisor who did not come the first time is
// the exact case it exists for.
//
// Merging the two would mean either the automatic notification is unrepeatable
// (so an ignored operator has no recourse) or the deliberate one is
// de-duplicated (so asking twice does nothing). Both were true before this
// route existed: the screen said "awaiting supervisor confirmation" and offered
// no way to ask anybody.
//
// It never signs anything. Only a supervisor's own "Verify & Sign" writes a
// verdict, and this route has no path to that column.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients, getProductionSupervisorIds } from '@/lib/notifications/recipients'
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

    const area        = (b.area ?? '').toString().trim()
    const description = (b.description ?? '').toString().trim()
    const operator    = (b.operatorName ?? caller.name ?? 'An operator').toString().trim()
    const startedAt   = (b.startedAt ?? new Date().toISOString()).toString()
    const previous    = Number.isFinite(Number(b.previousCalls)) ? Number(b.previousCalls) : 0

    const section = sectionMeta(sectionId)
    const where = area || section.name
    const requestedAt = new Date().toISOString()

    const supervisors = await resolveRecipients(await getProductionSupervisorIds())
    if (supervisors.length === 0) {
      // Worth finding in the logs when an operator says nobody ever came.
      console.warn('[api/production/stoppage/call-supervisor] no production supervisor is configured')
      return NextResponse.json({ ok: true, notified: 0, requestedAt })
    }

    // A repeat ask says so in the title. A supervisor seeing the same request a
    // third time should be able to tell without opening it — that escalation is
    // the whole reason this is repeatable.
    const again = previous > 0
    await notify({
      recipients: supervisors,
      kind:   'breakdown_confirm',
      source: 'production',
      title:  again
        ? `Still waiting — confirm the breakdown at ${where} (asked ${previous + 1}×)`
        : `Confirm a breakdown at ${where}`,
      body:
        `${operator} logged a breakdown at ${where} at ${fmtSast(startedAt)} and needs a supervisor ` +
        `to sign that it happened.` +
        (description ? ` ${description}` : '') +
        ` It stays unconfirmed on the shift report until someone does.`,
      url:      `/production/capture/${sectionId}?tab=signoff`,
      urgent:   again,
      // A first ask reaches the bell and email; a repeat ask goes urgent too,
      // because being ignored is the thing that needs escalating.
      channels: again ? ['inApp', 'email', 'urgent'] : ['inApp', 'email'],
      refTable: 'production.timesheet_stoppages',
      refId:    stoppageId,
      fromName: operator,
    })

    return NextResponse.json({ ok: true, notified: supervisors.length, requestedAt })
  } catch (err: unknown) {
    console.error('[api/production/stoppage/call-supervisor POST]', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
