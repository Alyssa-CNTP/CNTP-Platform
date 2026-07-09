// app/api/staff/[id]/route.ts
// PATCH  — update a staff / employee record.  Gate: can_edit_staff_profiles
// DELETE — remove a staff / employee record.  Gate: can_delete_staff
//
// See ../route.ts for why these go through the server (open RLS on
// production.employees means the browser-only check was not enforcement).

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient } from '@/lib/auth/server-helpers'
import { buildEmployeePayload, EMPLOYEE_COLS } from '@/lib/production/employee-payload'
import { writeAudit } from '@/lib/audit/write'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_edit_staff_profiles'))
    return NextResponse.json({ error: 'You don’t have permission to edit staff' }, { status: 403 })

  const body = await req.json()
  const payload = buildEmployeePayload(body)
  if (!payload.name)
    return NextResponse.json({ error: 'Full name is required' }, { status: 400 })

  const db = await getSessionClient()
  const { data: before } = await db
    .schema('production' as any)
    .from('employees')
    .select(EMPLOYEE_COLS)
    .eq('id', id)
    .maybeSingle()

  const { data, error } = await db
    .schema('production' as any)
    .from('employees')
    .update(payload as any)
    .eq('id', id)
    .select(EMPLOYEE_COLS)
    .single()

  if (error) {
    console.error('[api/staff PATCH]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await writeAudit({
    actorId: caller.userId, action: 'update',
    schema: 'production', table: 'employees', recordId: id,
    before, after: data,
  })

  return NextResponse.json(data)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_delete_staff'))
    return NextResponse.json({ error: 'You don’t have permission to remove staff' }, { status: 403 })

  const db = await getSessionClient()
  const { data: before } = await db
    .schema('production' as any)
    .from('employees')
    .select(EMPLOYEE_COLS)
    .eq('id', id)
    .maybeSingle()

  const { error } = await db
    .schema('production' as any)
    .from('employees')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('[api/staff DELETE]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await writeAudit({
    actorId: caller.userId, action: 'delete',
    schema: 'production', table: 'employees', recordId: id,
    before,
  })

  return NextResponse.json({ success: true })
}
