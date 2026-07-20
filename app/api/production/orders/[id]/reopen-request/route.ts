import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { writeAudit } from '@/lib/audit/write'
import { notify } from '@/lib/notifications'
import { resolveRecipients, getProductionManagerIds, getITUserIds } from '@/lib/notifications/recipients'
import { sectionMeta } from '@/lib/production/capture-config'

// Supervisor Hub's "Productions" tab: a supervisor cannot reopen a submitted/
// approved session directly there — they submit a REQUEST with a reason, and
// a Production Manager or IT (can_approve_reopen_request) approves or rejects
// it. Approval flips prod_sessions.status back to 'draft' — the same effect
// as the direct "Reopen for edits" action on /production/orders, just gated
// behind a second person. Separate from that direct action; not a replacement.

// POST — a supervisor requests a reopen.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const reason = String(body?.reason ?? '').trim()
  if (!reason) return NextResponse.json({ error: 'A reason is required' }, { status: 400 })
  const requestedByName = typeof body?.requestedByName === 'string' ? body.requestedByName.trim() || null : null

  const admin = getAdminClient() as any
  const { data: session, error: sErr } = await admin.schema('production')
    .from('prod_sessions').select('id,section_id,date,shift,status').eq('id', sessionId).maybeSingle()
  if (sErr)     return NextResponse.json({ error: sErr.message }, { status: 500 })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status !== 'submitted' && session.status !== 'approved') {
    return NextResponse.json({ error: 'Only a submitted or signed-off record can be reopened' }, { status: 400 })
  }

  // Idempotent: reuse an already-pending request rather than spawning a second one.
  const { data: existing } = await admin.schema('production').from('po_reopen_requests')
    .select('*').eq('session_id', sessionId).eq('status', 'pending').maybeSingle()
  if (existing) return NextResponse.json({ ok: true, record: existing, alreadyPending: true })

  const { data: created, error: iErr } = await admin.schema('production').from('po_reopen_requests').insert({
    session_id: sessionId, section_id: session.section_id, date: session.date, shift: session.shift,
    requested_by: caller.userId, requested_by_name: requestedByName, reason,
  } as any).select('*').single()
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })

  try {
    const managerIds = await getProductionManagerIds()
    const itIds = await getITUserIds()
    const recipients = await resolveRecipients([...managerIds, ...itIds])
    const name = sectionMeta(session.section_id).name
    await notify({
      recipients, kind: 'po_reopen_request',
      title: `Reopen request — ${name}`,
      body: `${requestedByName || 'A supervisor'} asked to reopen ${name} (${session.date}, ${session.shift} shift): "${reason}"`,
      url: '/supervisor/productions',
      channels: ['inApp', 'email'],
    })
  } catch { /* notification is best-effort — the request itself already saved */ }

  return NextResponse.json({ ok: true, record: created })
}

// PATCH — a manager/IT decides a pending request.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_approve_reopen_request')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const requestId: string | undefined = body?.requestId
  const decision: string = body?.decision
  const note = typeof body?.note === 'string' ? body.note.trim() || null : null
  const decidedByName = typeof body?.decidedByName === 'string' ? body.decidedByName.trim() || null : null
  if (!requestId || (decision !== 'approved' && decision !== 'rejected')) {
    return NextResponse.json({ error: 'requestId and a valid decision are required' }, { status: 400 })
  }

  const admin = getAdminClient() as any
  const { data: reopenReq, error: rErr } = await admin.schema('production')
    .from('po_reopen_requests').select('*').eq('id', requestId).eq('session_id', sessionId).maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!reopenReq) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (reopenReq.status !== 'pending') return NextResponse.json({ error: 'Request was already decided' }, { status: 400 })

  const now = new Date().toISOString()

  if (decision === 'approved') {
    const { data: before } = await admin.schema('production').from('prod_sessions').select('*').eq('id', sessionId).maybeSingle()
    const { data: after, error: uErr } = await admin.schema('production').from('prod_sessions')
      .update({ status: 'draft', edited_at: now, edited_by: caller.userId } as any).eq('id', sessionId).select('*').maybeSingle()
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })
    await writeAudit({
      actorId: caller.userId, action: 'reopen_request_approved', schema: 'production', table: 'prod_sessions',
      recordId: sessionId, before, after: after ?? { ...before, status: 'draft' },
    })
  }

  const { data: updatedReq, error: dErr } = await admin.schema('production').from('po_reopen_requests').update({
    status: decision, decided_by: caller.userId, decided_by_name: decidedByName, decision_note: note, decided_at: now,
  } as any).eq('id', requestId).select('*').single()
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })

  try {
    if (reopenReq.requested_by) {
      const recipients = await resolveRecipients([reopenReq.requested_by])
      const name = sectionMeta(reopenReq.section_id).name
      await notify({
        recipients, kind: 'po_reopen_decision',
        title: decision === 'approved' ? `Reopen approved — ${name}` : `Reopen declined — ${name}`,
        body: decision === 'approved'
          ? `${decidedByName || 'A manager'} approved reopening ${name} (${reopenReq.date}, ${reopenReq.shift} shift) for edits.`
          : `${decidedByName || 'A manager'} declined the reopen request for ${name} (${reopenReq.date}, ${reopenReq.shift} shift)${note ? `: "${note}"` : '.'}`,
        url: `/production/capture/${reopenReq.section_id}?date=${reopenReq.date}&shift=${reopenReq.shift}`,
        channels: ['inApp'],
      })
    }
  } catch { /* notification is best-effort */ }

  return NextResponse.json({ ok: true, record: updatedReq })
}
