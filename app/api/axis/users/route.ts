// app/api/axis/users/route.ts
// GET (default)                  — @-mention autocomplete in AXIS comments (IT only)
// GET ?scope=ticket_managers      — assignee picker for tickets: anyone eligible to
//                                    manage tickets (IT dept, or holds can_assign_tickets)

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient } from '@/lib/auth/server-helpers'
import { resolvePermission, type Permissions } from '@/lib/auth/permissions'

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get('scope')
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const isIT = caller.department === 'IT'
  if (scope === 'ticket_managers') {
    if (!isIT && !caller.can('can_assign_tickets'))
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  } else if (!isIT) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  // shared.app_roles is queried via session client (authenticated role), since
  // service_role isn't granted access to the shared schema in this project.
  const db = await getSessionClient()
  const { data, error } = await (db as any)
    .schema('shared')
    .from('app_roles')
    .select('user_id, full_name, department, role, permissions')
    .eq('is_active', true)
    .order('full_name', { ascending: true })

  if (error) {
    console.error('[api/axis/users GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let rows = (data ?? []).filter((r: any) => r.user_id && r.full_name)

  // Eligibility is computed row-by-row (department IT, or the can_assign_tickets
  // permission resolved via role default + explicit override) rather than a
  // hardcoded name list, so this stays correct as roles/staff change.
  if (scope === 'ticket_managers') {
    rows = rows.filter((r: any) =>
      r.department === 'IT' ||
      resolvePermission(r.role ?? null, (r.permissions ?? {}) as Permissions, 'can_assign_tickets')
    )
  }

  const users = rows.map((r: any) => ({
    id:         r.user_id,
    name:       r.full_name,
    initials:   initialsFor(r.full_name),
    department: r.department ?? null,
  }))

  return NextResponse.json(users)
}
