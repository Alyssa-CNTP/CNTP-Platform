import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

// GET /api/training/assignments?employeeId=xxx        — that employee's own assignments
// GET /api/training/assignments (no params)            — all assignments (gate can_assign_training)
export async function GET(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const url        = new URL(req.url)
  const employeeId = url.searchParams.get('employeeId')

  if (!employeeId && !caller.can('can_assign_training'))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = getAdminClient()
  const hrDb  = (admin as any).schema('hr')

  let query = hrDb.from('training_assignments').select('*, training_courses(title,slug)').order('due_date', { ascending: true, nullsFirst: false })
  if (employeeId) query = query.eq('employee_id', employeeId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let withEmployees = data ?? []
  if (!employeeId && withEmployees.length) {
    const employeeIds = [...new Set(withEmployees.map((a: any) => a.employee_id))]
    const { data: employees } = await (admin as any).schema('production').from('employees').select('id,name,display_name,department').in('id', employeeIds)
    const empById = new Map((employees ?? []).map((e: any) => [e.id, e]))
    withEmployees = withEmployees.map((a: any) => ({ ...a, employee: empById.get(a.employee_id) ?? null }))
  }

  return NextResponse.json({ assignments: withEmployees })
}

// POST /api/training/assignments — bulk-assign a course to one or more employees (gate can_assign_training)
export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_assign_training')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const employeeIds: string[] = body?.employee_ids ?? []
  if (!body?.course_id || employeeIds.length === 0)
    return NextResponse.json({ error: 'course_id and employee_ids are required' }, { status: 400 })

  const admin = getAdminClient()
  const hrDb  = (admin as any).schema('hr')

  const { data, error } = await hrDb.from('training_assignments').upsert(
    employeeIds.map(employeeId => ({
      employee_id: employeeId,
      course_id:   body.course_id,
      assigned_by: caller.userId,
      due_date:    body.due_date ?? null,
      reason:      body.reason ?? null,
      status:      'assigned',
    })),
    { onConflict: 'employee_id,course_id', ignoreDuplicates: false }
  ).select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, assignments: data })
}
