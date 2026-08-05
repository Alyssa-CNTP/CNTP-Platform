// app/api/staff/[id]/signature/status/route.ts
// GET — whether an employee has a signature on file, WITHOUT ever returning the
// image. Exists so the temporary senior_developer/co_developer setup override
// (see app/api/staff/[id]/signature/route.ts) can know "they already have one,
// drawing here replaces it" without ever viewing someone else's actual signature —
// the whole point of locking employee_signatures reads to self-only (see
// 20260805_001_employee_signatures_self_read.sql) is defeated if a status route
// leaks the image back out through a side door.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, resolveEmployeeId } from '@/lib/auth/server-helpers'

const SETUP_OVERRIDE_ROLES = new Set(['senior_developer', 'co_developer'])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: employeeId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const myEmployeeId = await resolveEmployeeId(caller.userId)
  const isSelf = myEmployeeId === employeeId
  const isSetupOverride = !isSelf && SETUP_OVERRIDE_ROLES.has(caller.role ?? '')
  if (!isSelf && !isSetupOverride) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const admin = getAdminClient() as any
  const { data } = await admin.schema('production').from('employee_signatures')
    .select('employee_id').eq('employee_id', employeeId).maybeSingle()

  return NextResponse.json({ hasSignature: !!data })
}
