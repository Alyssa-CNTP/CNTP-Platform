// app/api/staff/[id]/identities/route.ts
// GET — the PIN operator and login account linked to one Staff Directory
// person, for the "identity hub" panels on their profile page.
//
// Login-account details (email, role, is_active) are only returned to IT /
// can_manage_users — matches the standing decision that logins are IT-owned.
// Everyone else who can see the staff profile gets a has_login flag only, so
// they know a login exists without seeing who manages it or how.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

// See app/api/production/operators/route.ts — same reasoning: the linking
// columns land in a separate migration and may not exist yet on every
// environment. Missing column -> treat as "no link" instead of erroring.
function isMissingColumnError(error: { code?: string } | null | undefined) {
  return error?.code === '42703'
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
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

  const { data: operator, error: opErr } = await (admin as any)
    .schema('production').from('operators')
    .select('id,operator_code,role,section_ids,active,employee_id')
    .eq('employee_id', id).maybeSingle()
  const operatorLinked = !opErr && !!operator

  const { data: appRole, error: roleErr } = await (admin as any)
    .schema('shared').from('app_roles')
    .select('user_id,department,role,is_active,employee_id')
    .eq('employee_id', id).maybeSingle()
  const loginLinked = !roleErr && !!appRole

  let login: any = null
  if (loginLinked) {
    if (isIT) {
      const { data } = await admin.auth.admin.getUserById((appRole as any).user_id)
      login = {
        user_id:   (appRole as any).user_id,
        email:     data?.user?.email ?? null,
        department:(appRole as any).department,
        role:      (appRole as any).role,
        is_active: (appRole as any).is_active,
      }
    } else {
      login = { has_login: true, is_active: (appRole as any).is_active }
    }
  }

  return NextResponse.json({
    operator: operatorLinked ? {
      id: (operator as any).id, operator_code: (operator as any).operator_code,
      role: (operator as any).role, section_ids: (operator as any).section_ids,
      active: (operator as any).active,
    } : null,
    login,
    // True once the people-links migration has run on this environment —
    // lets the UI explain a blank panel instead of implying "nothing linked".
    linksAvailable: !isMissingColumnError(opErr) && !isMissingColumnError(roleErr),
  })
}
