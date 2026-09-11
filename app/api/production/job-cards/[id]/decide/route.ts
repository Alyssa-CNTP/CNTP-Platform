import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, resolveEmployeeId } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients } from '@/lib/notifications/recipients'
import { resolveBatchId } from '@/lib/production/batch-spine'
import { jobCardGate, type TemplateStatus } from '@/lib/core/labels'
import { readSignOffs, splitSignOffs } from '@/lib/production/label-sign-offs'

// A production supervisor approves or rejects a job card a manager sent for
// approval. Approving IS the supervisor's "Verify & Sign" — their signature is
// resolved server-side from production.employee_signatures (their own Staff
// Directory record), never accepted from the client. Mirrors reopen-request's
// PATCH decision handler otherwise.

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: cardId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_approve_job_cards')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const decision: string = body?.decision
  const reason = typeof body?.reason === 'string' ? body.reason.trim() || null : null
  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ error: 'decision must be "approved" or "rejected"' }, { status: 400 })
  }
  if (decision === 'rejected' && !reason) {
    return NextResponse.json({ error: 'A reason is required to reject a job card' }, { status: 400 })
  }

  const admin = getAdminClient() as any
  const employeeId = await resolveEmployeeId(caller.userId)

  let supervisorSignature: string | null = null
  if (decision === 'approved') {
    const { data: sigRow } = employeeId
      ? await admin.schema('production').from('employee_signatures').select('signature').eq('employee_id', employeeId).maybeSingle()
      : { data: null }
    if (!sigRow?.signature) {
      return NextResponse.json({ error: 'No signature on file — set one up on your Staff Directory profile first.' }, { status: 400 })
    }
    supervisorSignature = sigRow.signature
  }

  const { data: card, error: cErr } = await admin.from('job_cards_pasteuriser')
    .select('id, status, item_no, batch_number, product_name, created_by, label_assignment_id')
    .eq('id', cardId).maybeSingle()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!card) return NextResponse.json({ error: 'Job card not found' }, { status: 404 })
  if (card.status !== 'sent_for_approval') {
    return NextResponse.json({ error: 'Job card is not awaiting approval' }, { status: 400 })
  }

  /**
   * GATE A, at the only chokepoint that matters.
   *
   * A card cannot be printed against until it is approved (the print route
   * refuses anything else), so approving it IS the moment the label chain has
   * to be settled — `jobCardGate()` exists to answer exactly that and was,
   * until now, imported by nothing outside its own tests.
   *
   * Checked only where a customer label is attached. A card with no
   * `label_assignment_id` is the ordinary internal job card that has run for
   * months and has no artwork to approve; gating it on a chain it never had
   * would stop the Pasteuriser dead for a rule that does not apply to it.
   *
   * Rejection is deliberately NOT gated. A supervisor must always be able to
   * send a card back, and refusing that because its label is unsigned would
   * trap the card in `sent_for_approval` with no way out — the same dead end
   * the one-way COA chain produced.
   */
  if (decision === 'approved' && card.label_assignment_id) {
    const { data: assignment } = await admin
      .from('label_po_assignments')
      .select('id, template:label_templates(id, version, status)')
      .eq('id', card.label_assignment_id).maybeSingle()
    const template = assignment?.template as
      { id: string; version: number; status: string } | null | undefined
    if (!template) {
      return NextResponse.json({
        error: 'The customer label on this job card no longer exists. Reassign one before approving.',
      }, { status: 409 })
    }
    const rows = await readSignOffs(admin, template.id)
    const gate = jobCardGate({
      status: template.status as TemplateStatus,
      templateVersion: Number(template.version),
      signOffs: splitSignOffs(rows).template,
      poAssigned: true,   // the assignment IS the PO, and we just read it
    })
    if (!gate.open) {
      return NextResponse.json({
        error: 'The customer label on this job card is not settled, so the card cannot be approved yet.',
        blockers: gate.blockedBy.map(b => b.reason),
      }, { status: 409 })
    }
  }

  const now = new Date().toISOString()
  const patch: any = decision === 'approved'
    ? { status: 'approved', approved_by: caller.userId, approved_at: now, rejected_reason: null,
        sig_production_supervisor: supervisorSignature,
        batch_id: await resolveBatchId(card.batch_number, 'pasteuriser') }
    : { status: 'rejected', rejected_reason: reason }

  const { data: updated, error: uErr } = await admin.from('job_cards_pasteuriser')
    .update(patch).eq('id', cardId).select('*').single()
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  try {
    if (card.created_by) {
      const { data: emp } = employeeId
        ? await admin.schema('production').from('employees').select('name, display_name').eq('id', employeeId).maybeSingle()
        : { data: null }
      const supervisorName = emp?.display_name || emp?.name || 'A supervisor'
      const recipients = await resolveRecipients([card.created_by])
      const label = card.item_no || card.product_name || 'Pasteuriser'
      await notify({
        recipients, kind: 'job_card_decision', source: 'production',
        refTable: 'job_cards_pasteuriser', refId: String(cardId),
        title: decision === 'approved' ? `Job card approved — ${label}` : `Job card rejected — ${label}`,
        body: decision === 'approved'
          ? `${supervisorName} approved the job card${card.batch_number ? ` for batch ${card.batch_number}` : ''}.`
          : `${supervisorName} rejected the job card${card.batch_number ? ` for batch ${card.batch_number}` : ''}: "${reason}"`,
        url: '/job-cards/pasteuriser',
        channels: ['inApp'],
      })
    }
  } catch { /* notification is best-effort */ }

  return NextResponse.json({ ok: true, record: updated })
}
