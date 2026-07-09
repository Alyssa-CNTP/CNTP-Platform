// app/api/staff/route.ts
// POST — create a staff / employee record.
//
// Enforces `can_edit_staff_profiles` SERVER-SIDE. production.employees has open
// RLS (authenticated USING (true)), so before this route the Staff Directory
// wrote straight from the browser and the permission check was cosmetic — any
// logged-in user could add staff. All creates now go through here so the grant
// actually means something.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient } from '@/lib/auth/server-helpers'
import { buildEmployeePayload, EMPLOYEE_COLS } from '@/lib/production/employee-payload'
import { writeAudit } from '@/lib/audit/write'

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_edit_staff_profiles'))
    return NextResponse.json({ error: 'You don’t have permission to add staff' }, { status: 403 })

  const body = await req.json()
  const payload = buildEmployeePayload(body)
  if (!payload.name)
    return NextResponse.json({ error: 'Full name is required' }, { status: 400 })

  // Session client (authenticated role) — production schema is exposed to
  // authenticated, and the caller has passed the permission gate above.
  const db = await getSessionClient()
  const { data, error } = await db
    .schema('production' as any)
    .from('employees')
    .insert(payload as any)
    .select(EMPLOYEE_COLS)
    .single()

  if (error) {
    console.error('[api/staff POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await writeAudit({
    actorId: caller.userId, action: 'create',
    schema: 'production', table: 'employees',
    recordId: (data as any)?.id ?? null,
    after: data,
  })

  return NextResponse.json(data)
}
