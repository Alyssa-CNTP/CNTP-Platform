import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { labelDb, readBody, str, strOrNull, isUniqueViolation } from '../../../_db'
import { writeAudit } from '@/lib/audit/write'
import { checkCompliance, type LabelTemplateStatus } from '@/lib/core/labels'
import { toTemplate, type LabelTemplateRow } from '@/features/pasteuriser-labels'

/**
 * The label template approval state machine — the ONLY place it moves.
 *
 * Every transition re-reads the row first and decides from THAT, never from
 * anything the client sent. ARCHITECTURE.md §6 states the rule for adjustment
 * tiers and it is the same rule here: "a session that submits mid-edit must be
 * refused by the route handler, not by a disabled button". Two people on the
 * label screen at once is not hypothetical — sales issues a proof while a
 * designer is still editing, and the designer's save must lose, not the proof.
 *
 *   draft            --issue_proof--> pending_approval   (can_design_labels)
 *   pending_approval --approve------> approved           (can_approve_labels)
 *   pending_approval --reject-------> rejected           (can_approve_labels)
 *   rejected         --reopen-------> draft              (can_design_labels)
 *
 * There is deliberately NO approved -> draft edge. Editing approved wording is
 * done by minting a new version (see ../version/route.ts), because an in-place
 * edit would leave the row saying "approved" about wording nobody approved.
 */

type Action = 'issue_proof' | 'approve' | 'reject' | 'reopen'

const RULES: Record<Action, {
  from: LabelTemplateStatus[]
  to: LabelTemplateStatus
  permission: 'can_design_labels' | 'can_approve_labels'
  event: 'proof_issued' | 'approved' | 'rejected' | 'reopened'
}> = {
  issue_proof: { from: ['draft'],            to: 'pending_approval', permission: 'can_design_labels',  event: 'proof_issued' },
  approve:     { from: ['pending_approval'], to: 'approved',         permission: 'can_approve_labels', event: 'approved' },
  reject:      { from: ['pending_approval'], to: 'rejected',         permission: 'can_approve_labels', event: 'rejected' },
  reopen:      { from: ['rejected'],         to: 'draft',            permission: 'can_design_labels',  event: 'reopened' },
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const action = str(body.action) as Action
  const rule = RULES[action]
  if (!rule) return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 })
  if (!caller.can(rule.permission)) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const note = strOrNull(body.note)
  const externalRef = strOrNull(body.externalRef)

  const admin = labelDb()

  // Fresh read. This is the authority for what state the template is in.
  const { data: row, error: readErr } = await admin
    .from('label_templates').select('*').eq('id', id).maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Label template not found' }, { status: 404 })

  const current = row.status as LabelTemplateStatus
  if (!rule.from.includes(current)) {
    return NextResponse.json({
      error: `Cannot ${action.replace('_', ' ')} a template that is ${current}. ` +
             `That action applies to: ${rule.from.join(', ')}.`,
    }, { status: 409 })
  }

  // Compliance gates the PROOF, not the print. A proof that goes to Control
  // Union already missing its CU number or its JAS mark would come back
  // approved, and their approval would then certify a non-compliant label.
  if (action === 'issue_proof') {
    const errors = checkCompliance(toTemplate(row as LabelTemplateRow)).filter(i => i.severity === 'error')
    if (errors.length > 0) {
      return NextResponse.json({
        error: 'This label is not compliant and cannot go out for approval.',
        issues: errors,
      }, { status: 422 })
    }
  }

  // Rejecting without saying why leaves the designer guessing, and the reason
  // is what the next version has to answer.
  if (action === 'reject' && !note) {
    return NextResponse.json({ error: 'A reason is required to reject a label' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { status: rule.to, updated_at: now }
  if (action === 'issue_proof') patch.proof_issued_at = now
  if (action === 'approve') {
    patch.approved_by = caller.userId
    patch.approved_at = now
    patch.rejected_reason = null
    if (externalRef) patch.cu_approval_ref = externalRef
    const customerRef = strOrNull(body.customerRef)
    if (customerRef) patch.customer_approval_ref = customerRef
  }
  if (action === 'reject') patch.rejected_reason = note
  if (action === 'reopen') { patch.rejected_reason = null; patch.proof_issued_at = null }

  // Guarded by status: if someone else moved the row between the read above and
  // this write, no row matches and we report the conflict rather than
  // overwriting their transition. This is the read-modify-write trap from
  // ARCHITECTURE.md §1B applied to a state machine.
  const { data: updated, error: updErr } = await admin
    .from('label_templates')
    .update(patch)
    .eq('id', id).eq('status', current)
    .select('*').maybeSingle()
  if (updErr) {
    // The partial unique index allowing only one approved version per code.
    if (isUniqueViolation(updErr)) {
      return NextResponse.json({
        error: `Another version of ${row.code} is already approved. Supersede it first — ` +
               `two approved versions of one label would mean two live orders printing different wording.`,
      }, { status: 409 })
    }
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json({ error: 'Someone else changed this label just now. Reload and try again.' }, { status: 409 })
  }

  // Approving a version retires the one it replaces. Superseded rows are kept
  // forever — bags printed from them are in the warehouse, and a traceability
  // query has to be able to reconstruct exactly what was on them.
  if (action === 'approve') {
    const { data: retired } = await admin
      .from('label_templates')
      .update({ status: 'superseded', updated_at: now })
      .eq('code', row.code).eq('status', 'approved').neq('id', id)
      .select('id')
    for (const r of retired ?? []) {
      await admin.from('label_template_events').insert({
        template_id: r.id, event: 'superseded', actor_id: caller.userId,
        note: `Superseded by ${row.code} v${row.version}`,
      })
    }
  }

  await admin.from('label_template_events').insert({
    template_id: id,
    event: rule.event,
    actor_id: caller.userId,
    note,
    external_ref: externalRef,
  })

  await writeAudit({
    actorId: caller.userId,
    action,
    schema: 'public',
    table: 'label_templates',
    recordId: id,
    before: { status: current },
    after: { status: rule.to, note, externalRef },
  })

  return NextResponse.json({ template: updated })
}
