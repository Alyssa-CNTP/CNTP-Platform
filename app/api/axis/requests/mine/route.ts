// app/api/axis/requests/mine/route.ts
// Current user's submitted project_requests.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data, error } = await (getAdminClient() as any)
    .schema('axis')
    .from('project_requests')
    .select('id,title,description,status,urgency,created_at,rejection_reason,submission_type,target_department')
    .eq('submitted_by', caller.userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[api/axis/requests/mine GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
