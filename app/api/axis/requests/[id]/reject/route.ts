// app/api/axis/requests/[id]/reject/route.ts
// Reject a project_request with a reason + notify the requester.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { reason } = await req.json()
  if (!reason?.trim())
    return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 })

  const axis = (getAdminClient() as any).schema('axis')

  const { data: reqData, error: reqErr } = await axis
    .from('project_requests').select('title,submitted_by').eq('id', id).single()
  if (reqErr || !reqData) {
    console.error('[reject] request lookup', reqErr)
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  const { error: updErr } = await axis
    .from('project_requests')
    .update({
      status:           'rejected',
      rejection_reason: reason.trim(),
      reviewed_by:      caller.userId,
      reviewed_at:      new Date().toISOString(),
    })
    .eq('id', id)
  if (updErr) {
    console.error('[reject] request update', updErr)
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  const { error: notifErr } = await axis.from('notifications').insert({
    recipient_id:    reqData.submitted_by,
    type:            'project_rejected',
    title:           'Project not approved',
    body:            `Your project "${reqData.title}" was not approved. Reason: ${reason.trim()}`,
    reference_id:    id,
    reference_table: 'project_requests',
  })
  if (notifErr) console.error('[reject] notification insert', notifErr)

  return NextResponse.json({ ok: true })
}
