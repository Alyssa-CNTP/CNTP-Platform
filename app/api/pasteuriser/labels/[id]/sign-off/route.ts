import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, resolveEmployeeId } from '@/lib/auth/server-helpers'
import { labelDb, readBody, str, strOrNull } from '../../../_db'
import { writeAudit } from '@/lib/audit/write'
import {
  TEMPLATE_SIGN_OFFS, SIGN_OFF_LABEL, signOffState,
  type TemplateSignOffRole, type SignOff,
} from '@/lib/core/labels'
import type { PermissionKey } from '@/lib/auth/permissions'
import { supersedeOtherApprovedVersions } from '@/lib/production/label-approval'

/**
 * POST /api/pasteuriser/labels/[id]/sign-off
 *
 * Records ONE role's signature against the template's CURRENT version, and —
 * when that completes the chain — approves the template.
 *
 * ── Why approval happens here and not on the transition route ───────────────
 *
 * A template is approved when all four have signed. If `approve` stayed a
 * button someone could press independently, there would be two writers to one
 * status and a label could reach `approved` with Quality never having looked at
 * it — which is the hole this whole change exists to close. So the sign-off is
 * the only path in, and the transition route's `approve` now refuses.
 *
 * ── The name is never taken from the client ─────────────────────────────────
 *
 * For an internal role the signer is the caller, resolved server-side. For the
 * CUSTOMER and the CERTIFIER the signer is genuinely outside the building, so
 * their name does come from the body — and then `recorded_by` captures who
 * here stood behind that claim (20260909_006). "Control Union approved it" with
 * nobody's hand on it is not a record.
 */

/** Who may sign as whom. */
const REQUIRES: Readonly<Record<TemplateSignOffRole, PermissionKey>> = {
  sales:     'can_approve_labels',
  // Deliberately NOT can_approve_labels. One key held by both would let Sales
  // sign for Quality, and two names that one person can produce is one name.
  quality:   'can_quality_sign_labels',
  // Recording an external approval is a sales act; the approval itself is not.
  customer:  'can_approve_labels',
  certifier: 'can_approve_labels',
}

/** The roles whose signer is not in this building. */
const EXTERNAL: ReadonlySet<TemplateSignOffRole> = new Set(['customer', 'certifier'])

/**
 * Which statuses accept a signature.
 *
 * `approved` is in the list on purpose. Every template approved before this
 * change carries only the old single approval, so Quality, the customer and the
 * certifier have to be recordable against a label that already reads approved —
 * otherwise closing the gap would mean re-issuing every proof.
 *
 * `draft` is not: there is no proof to sign. `rejected` and `superseded` are
 * not: signing either would attest to artwork nobody is going to print.
 */
const SIGNABLE = new Set(['pending_approval', 'approved'])

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const role = str(body.role) as TemplateSignOffRole
  if (!TEMPLATE_SIGN_OFFS.includes(role)) {
    return NextResponse.json({
      error: `Unknown sign-off role '${role}'. Expected one of: ${TEMPLATE_SIGN_OFFS.join(', ')}.`,
    }, { status: 400 })
  }
  if (!caller.can(REQUIRES[role])) {
    return NextResponse.json({
      error: `You do not have permission to sign as ${SIGN_OFF_LABEL[role]}.`,
    }, { status: 403 })
  }

  const admin = labelDb()

  // Fresh read. The authority for status AND for which version is being signed —
  // a version taken from the client could attach a signature to artwork the
  // signer never saw.
  const { data: row, error: readErr } = await admin
    .from('label_templates').select('*').eq('id', id).maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Label template not found' }, { status: 404 })

  if (!SIGNABLE.has(row.status)) {
    return NextResponse.json({
      error: row.status === 'draft'
        ? 'No proof has been issued yet, so there is nothing to sign.'
        : `A ${row.status} label cannot be signed off.`,
    }, { status: 409 })
  }

  const version = Number(row.version)
  const external = EXTERNAL.has(role)

  // An external signature needs BOTH the outside party's name and ours.
  const actorName = external ? strOrNull(body.actorName) : (caller.name || null)
  if (!actorName) {
    return NextResponse.json({
      error: external
        ? `Who at the ${role === 'customer' ? 'customer' : 'certifier'} approved it? A name is required.`
        : 'Could not resolve your name from your session.',
    }, { status: 400 })
  }

  const employeeId = await resolveEmployeeId(caller.userId)
  if (!external && !employeeId) {
    // The signature would have no person behind it in the Staff Directory, and
    // a signature that cannot be traced to someone is decoration.
    return NextResponse.json({
      error: 'Your login is not linked to a Staff Directory person, so your signature cannot be recorded. Ask IT to link it.',
    }, { status: 409 })
  }

  const nowIso = new Date().toISOString()
  const insert = {
    scope: 'template',
    template_id: id,
    template_version: version,
    role,
    actor_name: actorName,
    actor_employee_id: external ? null : employeeId,
    actor_signature: external ? null : strOrNull(body.signature),
    external_ref: strOrNull(body.externalRef),
    note: strOrNull(body.note),
    signed_at: nowIso,
    // Only on an external sign-off — the CHECK in 20260909_006 refuses both.
    recorded_by_employee_id: external ? employeeId : null,
    recorded_by_name: external ? (caller.name || null) : null,
  }

  const { error: insErr } = await admin.from('label_sign_offs').insert(insert)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // ── Did that complete the chain? ──────────────────────────────────────────
  //
  // Re-read rather than reasoning from what we just wrote: another signature
  // may have landed while this request was in flight, and the question is what
  // the register says now, not what this caller believes.
  const { data: rows } = await admin
    .from('label_sign_offs')
    .select('role, actor_name, actor_employee_id, signed_at, template_version')
    .eq('template_id', id).eq('scope', 'template').eq('template_version', version)

  const signOffs: SignOff[] = ((rows ?? []) as Record<string, unknown>[]).map(r => ({
    role: r.role as SignOff['role'],
    actorName: String(r.actor_name ?? ''),
    actorEmployeeId: (r.actor_employee_id as string | null) ?? null,
    signedAt: String(r.signed_at ?? ''),
    templateVersion: Number(r.template_version),
  }))
  const state = signOffState(TEMPLATE_SIGN_OFFS, signOffs)

  let approvedNow = false
  let superseded: string[] = []
  if (state.complete && row.status === 'pending_approval') {
    // Retire the version this one replaces FIRST. A partial unique index allows
    // one approved version per code, so approving before retiring fails with a
    // constraint error rather than an approval.
    superseded = await supersedeOtherApprovedVersions(admin, {
      templateId: id, code: row.code, version, actorId: caller.userId,
      actorName: caller.name || null, at: nowIso,
    })

    // Guarded on the status we read, so a concurrent transition wins rather
    // than being overwritten — ARCHITECTURE.md §1B applied to a state machine.
    const { data: updated } = await admin
      .from('label_templates')
      .update({ status: 'approved', approved_at: nowIso, approved_by: caller.userId, rejected_reason: null, updated_at: nowIso })
      .eq('id', id).eq('status', 'pending_approval')
      .select('id').maybeSingle()
    if (updated) {
      approvedNow = true
      await admin.from('label_template_events').insert({
        template_id: id,
        event: 'approved',
        actor_id: caller.userId,
        actor_name: caller.name || null,
        note: `All ${TEMPLATE_SIGN_OFFS.length} sign-offs recorded for version ${version}.`,
      })
    }
  }

  await writeAudit({
    actorId: caller.userId,
    action: 'label_sign_off',
    schema: 'public',
    table: 'label_sign_offs',
    recordId: id,
    after: { role, version, actorName, approvedNow, superseded, outstanding: state.outstanding },
  })

  return NextResponse.json({
    ok: true,
    approvedNow,
    superseded,
    outstanding: state.outstanding,
    complete: state.complete,
  })
}
