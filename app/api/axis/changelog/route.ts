// app/api/axis/changelog/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const admin = getAdminClient()
  const { data, error } = await (admin as any)
    .schema('axis')
    .from('change_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[api/axis/changelog GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const body = await req.json()
  const {
    project_id, sector, sub_folder, change_type, description, reason,
    risk_level, reviewer_id, review_status,
    environment, affected_systems,
  } = body

  if (!change_type?.trim() || !description?.trim())
    return NextResponse.json({ error: 'change_type and description are required' }, { status: 400 })

  const admin = getAdminClient()
  const { error } = await (admin as any).schema('axis').from('change_logs').insert({
    project_id:       project_id || null,
    sector,
    sub_folder:       sub_folder || null,
    change_type:      change_type.trim(),
    description:      description.trim(),
    reason:           reason?.trim() ?? '',
    risk_level,
    author_id:        caller.userId,
    reviewer_id:      reviewer_id || null,
    review_status,
    source:           'manual',
    environment:      environment ?? 'development',
    affected_systems: affected_systems?.trim() || null,
  })

  if (error) {
    console.error('[api/axis/changelog POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
