// app/api/staff/[id]/offboard/route.ts
// POST — coordinated soft-offboard: employee inactive + linked PIN operator
// deactivated + linked login deactivated + an Axis ticket asking IT to delete
// the auth account. Nothing is hard-deleted, so roster/capture history stays
// intact (roster_entries.employee_id would otherwise SET NULL on a real delete).
//
// PATCH — reactivate: reverses the three deactivate steps. Does NOT recreate
// an auth account or re-enable a PIN that IT has since deleted — it only
// flips the flags back on for identities that are still there.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'
import { writeAudit } from '@/lib/audit/write'
import { raiseItTicket } from '@/lib/production/it-ticket'

// See app/api/production/operators/route.ts — the employee_id link may not
// exist yet on every environment (migration 20260709_001_people_links.sql).
function isMissingColumnError(error: { code?: string } | null | undefined) {
  return error?.code === '42703'
}

// Resolve the operator + login linked to this employee, tolerating a
// pre-migration environment by falling back to employees.operator_id.
async function findLinkedIdentities(admin: ReturnType<typeof getAdminClient>, employeeId: string) {
  let operator: any = null
  const byLink = await (admin as any).schema('production').from('operators')
    .select('id,user_id,active').eq('employee_id', employeeId).maybeSingle()
  if (!isMissingColumnError(byLink.error)) {
    operator = byLink.data
  } else {
    const { data: emp } = await admin.schema('production').from('employees')
      .select('operator_id').eq('id', employeeId).maybeSingle()
    if ((emp as any)?.operator_id) {
      const { data: op } = await admin.schema('production').from('operators')
        .select('id,user_id,active').eq('id', (emp as any).operator_id).maybeSingle()
      operator = op
    }
  }

  let appRole: any = null
  if (operator?.user_id) {
    const { data } = await (admin as any).schema('shared').from('app_roles')
      .select('user_id,is_active').eq('user_id', operator.user_id).maybeSingle()
    appRole = data
  } else {
    const byLink2 = await (admin as any).schema('shared').from('app_roles')
      .select('user_id,is_active').eq('employee_id', employeeId).maybeSingle()
    if (!isMissingColumnError(byLink2.error)) appRole = byLink2.data
  }

  return { operator, appRole }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_delete_staff'))
    return NextResponse.json({ error: 'You don’t have permission to offboard staff' }, { status: 403 })

  const admin = getAdminClient()
  const session = await getSessionClient()

  const { data: employee, error: empErr } = await session
    .schema('production' as any).from('employees')
    .select('id,name,display_name,department,active').eq('id', id).maybeSingle()
  if (empErr) return NextResponse.json({ error: empErr.message }, { status: 500 })
  if (!employee) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })

  const { operator, appRole } = await findLinkedIdentities(admin, id)

  // 1. Employee -> inactive
  const { error: empUpdErr } = await session
    .schema('production' as any).from('employees')
    .update({ active: false } as any).eq('id', id)
  if (empUpdErr) return NextResponse.json({ error: empUpdErr.message }, { status: 500 })
  await writeAudit({
    actorId: caller.userId, action: 'offboard', schema: 'production', table: 'employees',
    recordId: id, before: { active: true }, after: { active: false },
  })

  // 2. Linked PIN operator -> inactive (PIN login dead)
  if (operator?.id) {
    await admin.schema('production').from('operators').update({ active: false } as any).eq('id', operator.id)
    await writeAudit({
      actorId: caller.userId, action: 'offboard', schema: 'production', table: 'operators',
      recordId: operator.id, before: { active: true }, after: { active: false },
    })
  }

  // 3. Linked login -> inactive (blocked from signing in; auth account not deleted yet)
  if (appRole?.user_id) {
    await session.schema('shared' as any).from('app_roles')
      .update({ is_active: false } as any).eq('user_id', appRole.user_id)
    await writeAudit({
      actorId: caller.userId, action: 'offboard', schema: 'shared', table: 'app_roles',
      recordId: appRole.user_id, before: { is_active: true }, after: { is_active: false },
    })
  }

  // 4. Ask IT to permanently delete the auth account — non-destructive by default.
  let ticketNumber: string | null = null
  if (appRole?.user_id) {
    const person = employee.display_name || employee.name
    try {
      const { ticket_number } = await raiseItTicket({
        title: `Delete auth account — ${person} (offboarded)`,
        description: [
          `${person} was offboarded from the Staff Directory and their login has been deactivated.`,
          `Please permanently delete the auth account (user_id: ${appRole.user_id}) once confirmed.`,
        ].join('\n'),
        createdBy: caller.userId,
      })
      ticketNumber = ticket_number
    } catch (e: any) {
      console.error('[api/staff offboard] IT ticket failed', e?.message)
      // Offboard itself already succeeded (login is deactivated) — the ticket
      // is a follow-up cleanup step, so its failure must not undo steps 1–3.
    }
  }

  return NextResponse.json({
    success: true,
    deactivated: { operator: !!operator?.id, login: !!appRole?.user_id },
    ticket_number: ticketNumber,
  })
}

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_delete_staff'))
    return NextResponse.json({ error: 'You don’t have permission to reactivate staff' }, { status: 403 })

  const admin = getAdminClient()
  const session = await getSessionClient()

  const { error: empUpdErr } = await session
    .schema('production' as any).from('employees')
    .update({ active: true } as any).eq('id', id)
  if (empUpdErr) return NextResponse.json({ error: empUpdErr.message }, { status: 500 })
  await writeAudit({
    actorId: caller.userId, action: 'reactivate', schema: 'production', table: 'employees',
    recordId: id, before: { active: false }, after: { active: true },
  })

  const { operator, appRole } = await findLinkedIdentities(admin, id)

  if (operator?.id) {
    await admin.schema('production').from('operators').update({ active: true } as any).eq('id', operator.id)
    await writeAudit({
      actorId: caller.userId, action: 'reactivate', schema: 'production', table: 'operators',
      recordId: operator.id, before: { active: false }, after: { active: true },
    })
  }
  if (appRole?.user_id) {
    await session.schema('shared' as any).from('app_roles')
      .update({ is_active: true } as any).eq('user_id', appRole.user_id)
    await writeAudit({
      actorId: caller.userId, action: 'reactivate', schema: 'shared', table: 'app_roles',
      recordId: appRole.user_id, before: { is_active: false }, after: { is_active: true },
    })
  }

  return NextResponse.json({ success: true, reactivated: { operator: !!operator?.id, login: !!appRole?.user_id } })
}
