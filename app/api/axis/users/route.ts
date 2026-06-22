// app/api/axis/users/route.ts
// Active users list for the @-mention autocomplete in AXIS comments.
// Returns minimal shape: id, display name, initials, department.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient } from '@/lib/auth/server-helpers'

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  // shared.app_roles is queried via session client (authenticated role), since
  // service_role isn't granted access to the shared schema in this project.
  const db = await getSessionClient()
  const { data, error } = await (db as any)
    .schema('shared')
    .from('app_roles')
    .select('user_id, full_name, department')
    .eq('is_active', true)
    .order('full_name', { ascending: true })

  if (error) {
    console.error('[api/axis/users GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const users = (data ?? [])
    .filter((r: any) => r.user_id && r.full_name)
    .map((r: any) => ({
      id:         r.user_id,
      name:       r.full_name,
      initials:   initialsFor(r.full_name),
      department: r.department ?? null,
    }))

  return NextResponse.json(users)
}
