// app/api/axis/dashboard/route.ts
// Combined fetch for the AXIS dashboard. All axis.* tables are RLS-locked
// for the anon client, so we fan-out via the service-role admin client here
// behind an IT-department permission check.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const admin = getAdminClient()
  const axis = (admin as any).schema('axis')

  const [projectsRes, tracksRes, changesRes, requestsRes] = await Promise.all([
    axis.from('projects')
      .select('id,name,priority,status,term,effort_size,target_end,hard_deadline,approved_at')
      .eq('status', 'active')
      .order('approved_at', { ascending: false })
      .limit(100),
    axis.from('project_tracks').select('project_id,progress_pct'),
    axis.from('change_logs')
      .select('id,sector,sub_folder,change_type,description,created_at,is_locked,review_status,environment,risk_level')
      .order('created_at', { ascending: false })
      .limit(200),
    axis.from('project_requests')
      .select('id,title,requesting_dept,urgency,created_at,status')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const firstError = projectsRes.error || tracksRes.error || changesRes.error || requestsRes.error
  if (firstError) {
    console.error('[api/axis/dashboard GET]', firstError)
    return NextResponse.json({ error: firstError.message }, { status: 500 })
  }

  return NextResponse.json({
    projects: projectsRes.data ?? [],
    tracks:   tracksRes.data   ?? [],
    changes:  changesRes.data  ?? [],
    requests: requestsRes.data ?? [],
  })
}
