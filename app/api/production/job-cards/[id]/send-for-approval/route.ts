import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, resolveEmployeeId } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients, getProductionSupervisorIds } from '@/lib/notifications/recipients'

// A production manager sends a generated (or manually-typed) Pasteuriser job
// card to the supervisor(s) for approval — this IS their "Verify & Sign": the
// manager's on-file signature (production.employee_signatures, set once on
// their Staff Directory profile) is resolved server-side and stamped onto the
// card, never trusted from the client. Mirrors the reopen-request route's
// shape otherwise: gate on a permission, flip a status column, best-effort notify.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: cardId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_generate_job_cards')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const admin = getAdminClient() as any
  const employeeId = await resolveEmployeeId(caller.userId)
  const { data: sigRow } = employeeId
    ? await admin.schema('production').from('employee_signatures').select('signature').eq('employee_id', employeeId).maybeSingle()
    : { data: null }
  if (!sigRow?.signature) {
    return NextResponse.json({ error: 'No signature on file — set one up on your Staff Directory profile first.' }, { status: 400 })
  }

  const { data: card, error: cErr } = await admin.from('job_cards_pasteuriser')
    .select('id, status, item_no, batch_number, product_name, created_by').eq('id', cardId).maybeSingle()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!card) return NextResponse.json({ error: 'Job card not found' }, { status: 404 })
  if (card.status === 'sent_for_approval' || card.status === 'approved') {
    return NextResponse.json({ error: `Job card is already ${card.status}` }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { data: updated, error: uErr } = await admin.from('job_cards_pasteuriser')
    .update({
      status: 'sent_for_approval', sent_for_approval_at: now,
      created_by: card.created_by ?? caller.userId,
      sig_production_manager: sigRow.signature,
    } as any)
    .eq('id', cardId).select('*').single()
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  try {
    const { data: emp } = employeeId
      ? await admin.schema('production').from('employees').select('name, display_name').eq('id', employeeId).maybeSingle()
      : { data: null }
    const managerName = emp?.display_name || emp?.name || 'A production manager'
    const supervisorIds = await getProductionSupervisorIds()
    const recipients = await resolveRecipients(supervisorIds)
    await notify({
      recipients, kind: 'job_card_sent_for_approval', source: 'production',
      refTable: 'job_cards_pasteuriser', refId: String(cardId),
      title: `Job card ready for approval — ${card.item_no || card.product_name || 'Pasteuriser'}`,
      body: `${managerName} generated a Pasteuriser job card${card.batch_number ? ` (batch ${card.batch_number})` : ''} and needs your approval.`,
      url: '/job-cards/pasteuriser',
      channels: ['inApp', 'email'],
    })
  } catch { /* notification is best-effort — the status change already saved */ }

  return NextResponse.json({ ok: true, record: updated })
}
