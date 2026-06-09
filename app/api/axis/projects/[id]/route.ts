// app/api/axis/projects/[id]/route.ts
// Full project detail: project + tracks (with events) + linked change logs.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const axis = (getAdminClient() as any).schema('axis')

  const [projectRes, tracksRes, changesRes] = await Promise.all([
    axis.from('projects').select('*').eq('id', id).single(),
    axis.from('project_tracks')
      .select('*, events:track_events(*)')
      .eq('project_id', id)
      .order('created_at'),
    axis.from('change_logs')
      .select('id,sector,change_type,description,risk_level,created_at,is_locked,review_status,source')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(15),
  ])

  const firstError = projectRes.error || tracksRes.error || changesRes.error
  if (firstError) {
    console.error('[api/axis/projects/[id] GET]', firstError)
    return NextResponse.json({ error: firstError.message }, { status: 500 })
  }

  return NextResponse.json({
    project: projectRes.data,
    tracks:  tracksRes.data ?? [],
    changes: changesRes.data ?? [],
  })
}
