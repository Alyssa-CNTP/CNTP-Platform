// app/api/axis/projects/[id]/tracks/[trackId]/route.ts
// Update a track's progress + current milestone.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  const { trackId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { progress_pct, current_milestone } = await req.json()
  if (typeof progress_pct !== 'number' || progress_pct < 0 || progress_pct > 100)
    return NextResponse.json({ error: 'progress_pct must be 0–100' }, { status: 400 })

  const { error } = await (getAdminClient() as any)
    .schema('axis')
    .from('project_tracks')
    .update({
      progress_pct,
      current_milestone: current_milestone ?? '',
      updated_by:        caller.userId,
      updated_at:        new Date().toISOString(),
    })
    .eq('id', trackId)

  if (error) {
    console.error('[api/axis/projects/[id]/tracks/[trackId] PATCH]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
