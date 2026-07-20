// app/api/axis/requests/[id]/reject/route.ts
// Reject a project_request with a reason + notify the requester.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients } from '@/lib/notifications/recipients'

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

  if (reqData.submitted_by) {
    const [recipient] = await resolveRecipients([reqData.submitted_by])
    if (recipient) {
      await notify({
        recipients: [recipient],
        kind:       'project_rejected',
        title:      'Project not approved',
        body:       `Your project "${reqData.title}" was not approved. Reason: ${reason.trim()}`,
        url:        '/axis/consideration',
        channels:   ['inApp', 'email'],
      })
    }
  }

  return NextResponse.json({ ok: true })
}
