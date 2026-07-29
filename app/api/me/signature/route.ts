import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, resolveEmployeeId } from '@/lib/auth/server-helpers'

// What the currently logged-in caller needs to know about their own
// Staff-Directory-linked signature: whether they have one on file yet (so a
// "Verify & Sign" button can be enabled/disabled) and their employee id/name
// (so the Staff Directory profile page can tell "this is your own record").

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const employeeId = await resolveEmployeeId(caller.userId)
  if (!employeeId) return NextResponse.json({ employeeId: null, employeeName: null, hasSignature: false })

  const admin = getAdminClient() as any
  const { data: emp } = await admin.schema('production').from('employees')
    .select('name, display_name').eq('id', employeeId).maybeSingle()
  const { data: sig } = await admin.schema('production').from('employee_signatures')
    .select('employee_id').eq('employee_id', employeeId).maybeSingle()

  return NextResponse.json({
    employeeId,
    employeeName: emp?.display_name || emp?.name || null,
    hasSignature: !!sig,
  })
}
