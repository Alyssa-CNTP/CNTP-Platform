// app/api/axis/projects/route.ts
// GET — list active projects (project selectors / link dropdowns)
//
// Projects can no longer be created directly here — every project must go
// through Submit Request → Consideration board → Approve (see
// app/api/axis/requests/[id]/approve/route.ts), so it always has a traceable
// request record. The old direct-create shortcut bypassed that entirely.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { data, error } = await (getAdminClient() as any)
    .schema('axis')
    .from('projects')
    .select('id,name')
    .eq('status', 'active')
    .order('approved_at', { ascending: false })

  if (error) {
    console.error('[api/axis/projects GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
