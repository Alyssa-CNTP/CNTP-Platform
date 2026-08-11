// app/api/production/shift-report/recent/route.ts
//
// A short list of recent shift_reports rows for the /production/shift-reports
// tab's "Recent Reports" feed — separate from the main route.ts GET, which
// builds one full report for a specific date+shift rather than listing many.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!caller.can('can_view_shift_report') && caller.department !== 'Production' && caller.department !== 'Management') {
      return NextResponse.json({ error: 'You do not have access to shift reports.' }, { status: 403 })
    }

    const limit = Math.min(parseInt(new URL(req.url).searchParams.get('limit') || '20', 10) || 20, 50)
    const db = getAdminClient()
    const { data, error } = await db.schema('production' as any).from('shift_reports')
      .select('id,date,shift,status,generated_at,generated_by_name,submitted_at,approved_at')
      .order('date', { ascending: false }).order('shift', { ascending: false })
      .limit(limit)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      reports: ((data as any[]) ?? []).map(r => ({
        id: r.id, date: r.date, shift: r.shift, status: r.status,
        generatedAt: r.generated_at ?? null, generatedByName: r.generated_by_name ?? null,
        submittedAt: r.submitted_at ?? null, approvedAt: r.approved_at ?? null,
      })),
    })
  } catch (err: any) {
    console.error('[shift-report recent]', err)
    return NextResponse.json({ error: err?.message ?? 'Could not list shift reports' }, { status: 500 })
  }
}
