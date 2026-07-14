import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

// GET /api/training/progress?employeeId=xxx — which lessons this employee has watched
export async function GET(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const employeeId = new URL(req.url).searchParams.get('employeeId')
  if (!employeeId) return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })

  const admin = getAdminClient()
  const { data, error } = await (admin as any).schema('hr').from('lesson_progress').select('lesson_id,watched,watched_at').eq('employee_id', employeeId).eq('watched', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ progress: data ?? [] })
}

// POST /api/training/progress — mark a lesson as watched
export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.employee_id || !body?.lesson_id)
    return NextResponse.json({ error: 'employee_id and lesson_id are required' }, { status: 400 })

  const admin = getAdminClient()
  const { data, error } = await (admin as any).schema('hr').from('lesson_progress').upsert({
    employee_id: body.employee_id, lesson_id: body.lesson_id, watched: true, watched_at: new Date().toISOString(),
  }, { onConflict: 'employee_id,lesson_id' }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, progress: data })
}
