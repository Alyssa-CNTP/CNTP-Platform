import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, resolveEmployeeId } from '@/lib/auth/server-helpers'
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
 *   pending_approval --approve------> approved           REMOVED, see below
 *   pending_approval --reject-------> rejected           (can_approve_labels)
 *   rejected         --reopen-------> draft              (can_design_labels)
 *
 * There is deliberately NO approved -> draft edge. Editing approved wording is
 * done by minting a new version (see ../version/route.ts), because an in-place
 * edit would leave the row saying "approved" about wording nobody approved.
 */

type Action = 'issue_proof' | 'approve' | 'reject' | 'reopen'

const RULES: Record<Exclude<Action, 'approve'>, {
  from: LabelTemplateStatus[]
  to: LabelTemplateStatus
  permission: 'can_design_labels' | 'can_approve_labels'
  event: 'proof_issued' | 'approved' | 'rejected' | 'reopened'
}> = {
  issue_proof: { from: ['draft'],            to: 'pending_approval', permission: 'can_design_labels',  event: 'proof_issued' },
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

  /**
   * `approve` is gone, and refusing loudly is the point.
   *
   * A template is approved when Sales, Quality, the customer and the certifier
   * have each signed — recorded through /sign-off, which flips the status when
   * the fourth lands. Leaving this action in place would be a second writer to
   * the same field and, worse, a way for one holder of can_approve_labels to
   * approve a label Quality never saw. That is exactly the hole the sign-off
   * chain closes, so it cannot stay open behind it.
   *
   * A 410 rather than a 400: the endpoint existed and deliberately does not any
   * more, and the caller needs to know which door to use instead.
   */
  if (action === 'approve') {
    return NextResponse.json({
      error: 'Approval is no longer a single action. Record each sign-off — Sales, Quality, Customer, Control Union — and the label approves itself when the last one lands.',
      use: `/api/pasteuriser/labels/${id}/sign-off`,
    }, { status: 410 })
  }

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

  /**
   * Who did this, by name, with their signature — SNAPSHOT, not a join.
   *
   * An approved template is frozen because it records what was agreed at a
   * moment in time. Join the Staff Directory live and the record changes
   * underneath itself: a rename, a re-signed signature or an offboarding would
   * silently alter an approval from six months ago. The certifier's question is
   * "who signed this, at the time", and only a copy can answer it.
   *
   * Both are best-effort. A missing signature must NOT block an approval — the
   * granule job card refuses in that case, and that is right there because the
   * signature IS the sign-off. Here the approval is the Control Union or
   * customer decision being recorded; refusing to record it because the person
   * has not drawn a signature yet would lose the actual fact.
   */
  const employeeId = await resolveEmployeeId(caller.userId)
  let actorSignature: string | null = null
  if (employeeId) {
    const { data: sig } = await admin
      .schema('production' as never)
      .from('employee_signatures')
      .select('signature')
      .eq('employee_id', employeeId)
      .maybeSingle()
    actorSignature = (sig as { signature?: string } | null)?.signature ?? null
  }
  const actorName = caller.name ?? null

  // Retiring the version an approval replaces MOVED to the sign-off route,
  // because that is where a template now becomes approved. It is not dropped —
  // see supersedeOtherApprovedVersions() in lib/production/label-approval.ts.

  await admin.from('label_template_events').insert({
    template_id: id,
    event: rule.event,
    actor_id: caller.userId,
    actor_name: actorName,
    actor_signature: actorSignature,
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
