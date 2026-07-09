// app/api/staff/identities/route.ts
// GET — bulk identities lookup for the Staff Directory LIST view (one call for
// every person instead of N+1 against app/api/staff/[id]/identities).
//
// Same visibility rule as the per-employee route: login email/role is only
// returned to IT / can_manage_users. Everyone else who can see the list gets
// a has_login flag only.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

function isMissingColumnError(error: { code?: string } | null | undefined) {
  return error?.code === '42703'
}

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const canSeePeopleOps =
    caller.can('can_view_staff') || caller.can('can_edit_staff_profiles') ||
    caller.can('can_reset_operator_pin') || caller.can('can_manage_users')
  if (!canSeePeopleOps)
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const admin = getAdminClient()
  const isIT  = caller.department === 'IT' || caller.can('can_manage_users')

  const { data: ops, error: opErr } = await (admin as any)
    .schema('production').from('operators')
    .select('employee_id,operator_code,active')
    .not('employee_id', 'is', null)
  const operators: Record<string, { operator_code: string | null; active: boolean }> = {}
  if (!isMissingColumnError(opErr)) {
    for (const o of ops ?? []) operators[o.employee_id] = { operator_code: o.operator_code, active: o.active }
  }

  const { data: roles, error: roleErr } = await (admin as any)
    .schema('shared').from('app_roles')
    .select('employee_id,user_id,is_active,role')
    .not('employee_id', 'is', null)

  const logins: Record<string, { has_login: true; is_active: boolean; email?: string | null; role?: string | null }> = {}
  if (!isMissingColumnError(roleErr) && (roles ?? []).length > 0) {
    let emailByUserId = new Map<string, string | null>()
    if (isIT) {
      const { data: listResult } = await admin.auth.admin.listUsers({ perPage: 1000 })
      emailByUserId = new Map((listResult?.users ?? []).map(u => [u.id, u.email ?? null]))
    }
    for (const r of roles as any[]) {
      logins[r.employee_id] = {
        has_login: true,
        is_active: r.is_active,
        ...(isIT ? { email: emailByUserId.get(r.user_id) ?? null, role: r.role } : {}),
      }
    }
  }

  return NextResponse.json({
    operators, logins,
    linksAvailable: !isMissingColumnError(opErr) && !isMissingColumnError(roleErr),
  })
}
