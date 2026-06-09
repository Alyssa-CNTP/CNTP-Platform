// app/api/axis/projects/[id]/tracks/[trackId]/events/route.ts
// Append a track event (update / milestone / blocker / resolution / note).

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

const VALID_TYPES = new Set(['update', 'milestone', 'blocker', 'resolution', 'note'])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  const { trackId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { title, description, event_type } = await req.json()
  if (!title?.trim())
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  if (!VALID_TYPES.has(event_type))
    return NextResponse.json({ error: 'Invalid event_type' }, { status: 400 })

  const { error } = await (getAdminClient() as any)
    .schema('axis')
    .from('track_events')
    .insert({
      track_id:    trackId,
      title:       title.trim(),
      description: description?.trim() ?? '',
      event_type,
      created_by:  caller.userId,
    })

  if (error) {
    console.error('[api/axis/projects/[id]/tracks/[trackId]/events POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
