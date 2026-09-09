import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, resolveEmployeeId } from '@/lib/auth/server-helpers'
import { labelDb, readBody, str, strOrNull } from '../../../_db'
import { writeAudit } from '@/lib/audit/write'
import {
  PRINT_SIGN_OFFS, SIGN_OFF_LABEL, printGate,
  type PrintSignOffRole, type SignOff, type TemplateStatus,
} from '@/lib/core/labels'
import type { PermissionKey } from '@/lib/auth/permissions'

/**
 * POST /api/pasteuriser/job-cards/[id]/sign-off
 *
 * The pre-print check on ONE run: the sales lead confirms the customer-facing
 * facts, the quality supervisor confirms the run data. Two names.
 *
 * ── The two-different-people rule is decided by core, here ──────────────────
 *
 * `printGate()` owns that rule. This route does not re-implement it: it builds
 * the list of signatures that WOULD exist if this one were accepted, asks core,
 * and refuses if core says the two are the same person. One rule, one place —
 * and a rule that lives only in a disabled button is not a rule
 * (ARCHITECTURE.md §6).
 *
 * The gate's other findings — the other half unsigned, the template chain
 * incomplete — are NOT reasons to refuse a signature. They are reasons the
 * print is still shut, which is what the gate is for. Refusing to record a
 * signature because the print is not yet ready would make the first signer
 * unable to go first.
 */

const REQUIRES: Readonly<Record<PrintSignOffRole, PermissionKey>> = {
  sales_lead:         'can_approve_labels',
  quality_supervisor: 'can_quality_sign_labels',
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const role = str(body.role) as PrintSignOffRole
  if (!PRINT_SIGN_OFFS.includes(role)) {
    return NextResponse.json({
      error: `Unknown sign-off role '${role}'. Expected one of: ${PRINT_SIGN_OFFS.join(', ')}.`,
    }, { status: 400 })
  }
  if (!caller.can(REQUIRES[role])) {
    return NextResponse.json({
      error: `You do not have permission to sign as ${SIGN_OFF_LABEL[role]}.`,
    }, { status: 403 })
  }

  const admin = labelDb()

  // ── Fresh reads, following the chain the card belongs to ──────────────────
  const { data: card, error: cardErr } = await admin
    .from('job_cards_pasteuriser')
    .select('id, job_card_no, label_assignment_id')
    .eq('id', id).maybeSingle()
  if (cardErr) return NextResponse.json({ error: cardErr.message }, { status: 500 })
  if (!card) return NextResponse.json({ error: 'Job card not found' }, { status: 404 })

  if (!card.label_assignment_id) {
    return NextResponse.json({
      error: 'This job card has no customer label assigned, so there is no test label to sign.',
    }, { status: 409 })
  }

  const { data: assignment } = await admin
    .from('label_po_assignments')
    .select('id, template_id, po_number, customer')
    .eq('id', card.label_assignment_id).maybeSingle()
  if (!assignment) {
    return NextResponse.json({ error: 'The label assignment on this job card no longer exists.' }, { status: 409 })
  }

  const { data: template } = await admin
    .from('label_templates')
    .select('id, code, version, status')
    .eq('id', assignment.template_id).maybeSingle()
  if (!template) {
    return NextResponse.json({ error: 'The label template for this job card no longer exists.' }, { status: 409 })
  }

  const employeeId = await resolveEmployeeId(caller.userId)
  if (!employeeId) {
    return NextResponse.json({
      error: 'Your login is not linked to a Staff Directory person, so your signature cannot be recorded. Ask IT to link it.',
    }, { status: 409 })
  }
  const actorName = caller.name || null
  if (!actorName) {
    return NextResponse.json({ error: 'Could not resolve your name from your session.' }, { status: 400 })
  }

  const version = Number(template.version)
  const nowIso = new Date().toISOString()

  // ── Ask core whether this signature is allowed to stand beside the other ──
  const { data: existingPrint } = await admin
    .from('label_sign_offs')
    .select('role, actor_name, actor_employee_id, signed_at, template_version')
    .eq('job_card_id', id).eq('scope', 'print')

  const toSignOff = (r: Record<string, unknown>): SignOff => ({
    role: r.role as SignOff['role'],
    actorName: String(r.actor_name ?? ''),
    actorEmployeeId: (r.actor_employee_id as string | null) ?? null,
    signedAt: String(r.signed_at ?? ''),
    templateVersion: Number(r.template_version),
  })

  const proposed: SignOff = {
    role, actorName, actorEmployeeId: employeeId,
    signedAt: nowIso, templateVersion: version,
  }
  // The other role's latest, plus what is about to be written. Drop any earlier
  // signature for THIS role — a re-sign replaces, it does not accumulate.
  const prospective = [
    ...((existingPrint ?? []) as Record<string, unknown>[]).map(toSignOff).filter(s => s.role !== role),
    proposed,
  ]

  const gate = printGate({
    status: template.status as TemplateStatus,
    templateVersion: version,
    // The template chain is read separately by the gate's caller; here we only
    // need it to not mask the one blocker this route cares about.
    signOffs: [],
    poAssigned: true,
    printSignOffs: prospective,
  })
  const clash = gate.blockedBy.find(b => b.key === 'same_signer')
  if (clash) return NextResponse.json({ error: clash.reason }, { status: 409 })

  // ── Record it ─────────────────────────────────────────────────────────────
  const { error: insErr } = await admin.from('label_sign_offs').insert({
    scope: 'print',
    template_id: template.id,
    template_version: version,
    job_card_id: id,
    assignment_id: assignment.id,
    role,
    actor_name: actorName,
    actor_employee_id: employeeId,
    actor_signature: strOrNull(body.signature),
    note: strOrNull(body.note),
    signed_at: nowIso,
  })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // ── Report where the print gate now stands, for real this time ────────────
  //
  // Both scopes, freshly read, so the answer the caller gets is the answer the
  // print screen will get. The check above deliberately looked at one blocker;
  // this looks at all of them.
  const { data: allRows } = await admin
    .from('label_sign_offs')
    .select('scope, role, actor_name, actor_employee_id, signed_at, template_version, job_card_id')
    .eq('template_id', template.id)

  const rows = ((allRows ?? []) as Record<string, unknown>[])
  const finalGate = printGate({
    status: template.status as TemplateStatus,
    templateVersion: version,
    signOffs: rows.filter(r => r.scope === 'template').map(toSignOff),
    poAssigned: true,
    printSignOffs: rows.filter(r => r.scope === 'print' && r.job_card_id === id).map(toSignOff),
  })

  await writeAudit({
    actorId: caller.userId,
    action: 'label_print_sign_off',
    schema: 'public',
    table: 'label_sign_offs',
    recordId: id,
    after: {
      role, actorName, jobCardNo: card.job_card_no,
      template: template.code, version,
      printReady: finalGate.open,
    },
  })

  return NextResponse.json({
    ok: true,
    printReady: finalGate.open,
    blockedBy: finalGate.blockedBy,
  })
}
