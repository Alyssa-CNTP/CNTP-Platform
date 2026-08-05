// app/api/production/shift-report/route.ts
//
// GET  — assemble the full shift report for a date + shift, live from the
//        records the floor already captured. Nothing is invented here; every
//        field traces back to a table (see lib/production/shift-report.ts).
// POST — save / submit / approve / reopen the report, writing an audit row for
//        every transition so a signed report is provable months later.
//
// Reads run through the admin client on purpose. The report crosses schemas
// (production + maintenance) and a supervisor holding can_view_shift_report has
// no direct grant on maintenance.job_cards; gating happens here on the
// permission, not on the row-level grants of five different tables.
//
// The actual assembly/save logic lives in lib/production/shift-report-builder.ts
// so the cron route (app/api/production/shift-report/cron/route.ts) can call it
// too, with its own auth check, with no HTTP request involved.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { buildShiftReport, saveShiftReport, type ShiftReportAction } from '@/lib/production/shift-report-builder'
import type { Shift } from '@/lib/supabase/database.types'

export const runtime = 'nodejs'

// ── GET — assemble ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!caller.can('can_view_shift_report') && caller.department !== 'Production' && caller.department !== 'Management') {
      return NextResponse.json({ error: 'You do not have access to shift reports.' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date')
    const shift = (searchParams.get('shift') || 'morning') as Shift
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'A date (yyyy-MM-dd) is required.' }, { status: 400 })
    }

    const report = await buildShiftReport(date, shift)
    return NextResponse.json(report)
  } catch (err: any) {
    console.error('[shift-report GET]', err)
    return NextResponse.json({ error: err?.message ?? 'Could not build the shift report' }, { status: 500 })
  }
}

// ── POST — save / submit / approve / reopen ───────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const action = (body.action ?? 'save') as ShiftReportAction
    const date = body.date as string
    // 'night' is a legacy alias of 'afternoon' — one report per real shift.
    const shift = (body.shift === 'night' ? 'afternoon' : body.shift) as string
    const payload = body.payload ?? null
    const supervisorNotes = typeof body.supervisorNotes === 'string' ? body.supervisorNotes : undefined

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !['morning', 'afternoon'].includes(shift)) {
      return NextResponse.json({ error: 'A valid date and shift are required.' }, { status: 400 })
    }

    const perm: Record<ShiftReportAction, string> = {
      save: 'can_edit_shift_report',
      submit: 'can_submit_shift_report',
      approve: 'can_approve_shift_report',
      reopen: 'can_approve_shift_report',
    }
    if (!caller.can(perm[action] as any)) {
      return NextResponse.json({ error: `You do not have permission to ${action} a shift report.` }, { status: 403 })
    }

    const result = await saveShiftReport(date, shift, {
      action, payload, supervisorNotes,
      auditNote: typeof body.auditNote === 'string' ? body.auditNote : null,
      actorId: caller.userId, actorName: caller.name ?? null,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    const { ok, ...rest } = result
    return NextResponse.json(rest)
  } catch (err: any) {
    console.error('[shift-report POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Could not save the shift report' }, { status: 500 })
  }
}
