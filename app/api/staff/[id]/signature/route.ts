// app/api/staff/[id]/signature/route.ts
// PUT — set/replace an employee's on-file signature. Gate: it's your own
// Staff Directory record (resolved server-side via the app_roles link, never
// trusted from the client) OR can_edit_staff_profiles (HR onboarding someone
// who can't self-serve yet). production.employee_signatures has no write
// policy for `authenticated` at all — this route (service-role) is the only
// way a signature can be set.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, resolveEmployeeId } from '@/lib/auth/server-helpers'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: employeeId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const myEmployeeId = await resolveEmployeeId(caller.userId)
  const isSelf = myEmployeeId === employeeId
  if (!isSelf && !caller.can('can_edit_staff_profiles')) {
    return NextResponse.json({ error: 'You can only set your own signature' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const signature = typeof body?.signature === 'string' ? body.signature : null
  if (!signature) return NextResponse.json({ error: 'A signature is required' }, { status: 400 })

  const admin = getAdminClient() as any
  const { error } = await admin.schema('production').from('employee_signatures')
    .upsert({ employee_id: employeeId, signature } as any, { onConflict: 'employee_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
