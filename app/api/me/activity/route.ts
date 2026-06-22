// app/api/me/activity/route.ts
// Returns the CALLER'S OWN recent activity from axis.audit_log.
// Self-scoped: actor_id is forced to the authenticated user — a caller can only
// ever see their own events, so no permission toggle is required.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function GET(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId)
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '25', 10), 100)

  const admin = getAdminClient()
  const { data, error } = await (admin as any)
    .schema('axis')
    .from('audit_log')
    .select('id, action, schema_name, table_name, record_id, ip_address, created_at')
    .eq('actor_id', caller.userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[api/me/activity GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
