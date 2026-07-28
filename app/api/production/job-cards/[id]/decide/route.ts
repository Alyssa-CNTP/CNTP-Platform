import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients } from '@/lib/notifications/recipients'

// A production supervisor approves or rejects a job card a manager sent for
// approval. Mirrors reopen-request's PATCH decision handler.

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: cardId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_approve_job_cards')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const decision: string = body?.decision
  const reason = typeof body?.reason === 'string' ? body.reason.trim() || null : null
  const supervisorSignature = typeof body?.supervisorSignature === 'string' ? body.supervisorSignature : null
  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ error: 'decision must be "approved" or "rejected"' }, { status: 400 })
  }
  if (decision === 'rejected' && !reason) {
    return NextResponse.json({ error: 'A reason is required to reject a job card' }, { status: 400 })
  }

  const admin = getAdminClient() as any
  const { data: card, error: cErr } = await admin.from('job_cards_pasteuriser')
    .select('id, status, item_no, batch_number, product_name, created_by').eq('id', cardId).maybeSingle()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!card) return NextResponse.json({ error: 'Job card not found' }, { status: 404 })
  if (card.status !== 'sent_for_approval') {
    return NextResponse.json({ error: 'Job card is not awaiting approval' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const patch: any = decision === 'approved'
    ? { status: 'approved', approved_by: caller.userId, approved_at: now, rejected_reason: null,
        ...(supervisorSignature ? { sig_production_supervisor: supervisorSignature } : {}) }
    : { status: 'rejected', rejected_reason: reason }

  const { data: updated, error: uErr } = await admin.from('job_cards_pasteuriser')
    .update(patch).eq('id', cardId).select('*').single()
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  try {
    if (card.created_by) {
      const recipients = await resolveRecipients([card.created_by])
      const label = card.item_no || card.product_name || 'Pasteuriser'
      await notify({
        recipients, kind: 'job_card_decision', source: 'production',
        refTable: 'job_cards_pasteuriser', refId: String(cardId),
        title: decision === 'approved' ? `Job card approved — ${label}` : `Job card rejected — ${label}`,
        body: decision === 'approved'
          ? `${caller.name || 'A supervisor'} approved the job card${card.batch_number ? ` for batch ${card.batch_number}` : ''}.`
          : `${caller.name || 'A supervisor'} rejected the job card${card.batch_number ? ` for batch ${card.batch_number}` : ''}: "${reason}"`,
        url: '/job-cards/pasteuriser',
        channels: ['inApp'],
      })
    }
  } catch { /* notification is best-effort */ }

  return NextResponse.json({ ok: true, record: updated })
}
