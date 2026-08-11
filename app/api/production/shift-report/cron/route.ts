// app/api/production/shift-report/cron/route.ts
//
// Unattended shift-report generation, hit by GitHub Actions (see
// .github/workflows/shift-report-generate.yml) once per shift, right after it
// ends. Builds the report the same way the browser does (buildShiftReport)
// and saves it with action='save' — which only ever produces a 'draft' row
// and never touches an e-signature. Humans still do the submit (signature)
// and approve (signature) steps by hand on /supervisor/report, unchanged.
//
// ?shift=morning|afternoon selects which shift just ended; the date is always
// today's UTC calendar date at fire time — see the note on shiftWindowUtc in
// shift-report-builder.ts for why that's correct for both the 14:00Z
// (morning-end) and 23:00Z (afternoon-end) triggers, with no "yesterday"
// adjustment needed.
//
// Auth: no user session — caller must present  Authorization: Bearer <CRON_SECRET>
// — or a signed-in user holding can_edit_shift_report (so a "Generate now"
// button could call the same endpoint later without needing its own logic).
//
// Required env: CRON_SECRET

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { buildShiftReport, saveShiftReport } from '@/lib/production/shift-report-builder'

export const runtime = 'nodejs'

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const viaCron = !!secret && req.headers.get('authorization') === `Bearer ${secret}`
  if (!viaCron) {
    const caller = await getCallerPermissions()
    if (!caller.userId || !caller.can('can_edit_shift_report')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const shift = new URL(req.url).searchParams.get('shift')
  if (shift !== 'morning' && shift !== 'afternoon') {
    return NextResponse.json({ error: 'Pass ?shift=morning or ?shift=afternoon' }, { status: 400 })
  }
  const date = new Date().toISOString().slice(0, 10)

  try {
    const report = await buildShiftReport(date, shift)
    const result = await saveShiftReport(date, shift, {
      action: 'save',
      payload: report,
      actorId: null,
      actorName: 'System (cron)',
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true, date, shift, reportId: result.id, status: result.status })
  } catch (err: any) {
    console.error('[api/production/shift-report/cron]', err)
    return NextResponse.json({ error: err?.message ?? 'Failed' }, { status: 500 })
  }
}

export const POST = handle
export const GET = handle
