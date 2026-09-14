import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { labelDb, readBody, str, strOrNull, posInt, isUniqueViolation } from '../_db'
import { writeAudit } from '@/lib/audit/write'
import { SIGN_OFF_LABEL } from '@/lib/core/labels'
import {
  SIGN_OFF_COLUMNS, outstandingTemplateRoles, type SignOffRow,
} from '@/lib/production/label-sign-offs'

/**
 * Sales binds an APPROVED label version to a customer purchase order.
 *
 * This is the handover point in the workflow: once a row exists here at 'open',
 * the production manager can pick it on the job cards page and assign it to a
 * day's production.
 *
 * `planned_batch_no` / `planned_date` are the supply chain analyst's input and
 * are OPTIONAL, on purpose. The manager is not blocked waiting for them. Making
 * them required would encode exactly the dependency this workflow exists to
 * remove — that the line cannot start until the analyst has filled a field in.
 */

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_assign_label_po')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const templateId = str(body.templateId)
  const customer   = str(body.customer)
  const poNumber   = str(body.poNumber)
  if (!templateId || !customer || !poNumber) {
    return NextResponse.json({ error: 'templateId, customer and poNumber are all required' }, { status: 400 })
  }

  const admin = labelDb()

  // Fresh read of the template's status — a PO must never be attached to
  // wording that is not approved. Checked here rather than trusted from the
  // client, because the template could have been superseded in the seconds
  // since the page loaded its list.
  const { data: tpl, error: tplErr } = await admin
    .from('label_templates').select('id, code, version, status').eq('id', templateId).maybeSingle()
  if (tplErr) return NextResponse.json({ error: tplErr.message }, { status: 500 })
  if (!tpl) return NextResponse.json({ error: 'Label template not found' }, { status: 404 })
  if (tpl.status !== 'approved') {
    return NextResponse.json({
      error: `${tpl.code} v${tpl.version} is ${tpl.status}. A PO can only be assigned to an approved label.`,
    }, { status: 409 })
  }

  // ── And every signature has to be on the version being assigned ───────────
  //
  // `status = 'approved'` is NOT sufficient, which is not obvious. For a label
  // approved since the chain existed the two are the same thing: the fourth
  // signature is what sets the status. But the sign-off route deliberately
  // accepts signatures against an already-approved template, because every
  // label approved BEFORE the chain carries only the old single approval and
  // Quality, the customer and Control Union had to be recordable against it
  // without re-issuing the proof. Those templates read `approved` with an empty
  // chain, and status alone would hand them a PO.
  //
  // The version matters for the same reason it matters in the chain itself: a
  // new version reopens the artwork, so v1's four signatures say nothing about
  // what v2 says on the bag.
  //
  // This is the server half. The panel disables its button and names the
  // outstanding roles, but a disabled button is not an enforcement mechanism
  // (ARCHITECTURE.md §6) — the decision is made here, from a fresh read.
  const { data: sigRows, error: sigErr } = await admin
    .from('label_sign_offs').select(SIGN_OFF_COLUMNS).eq('template_id', templateId)
  if (sigErr) return NextResponse.json({ error: sigErr.message }, { status: 500 })

  const outstanding = outstandingTemplateRoles(
    (sigRows ?? []) as SignOffRow[], Number(tpl.version),
  )
  if (outstanding.length > 0) {
    return NextResponse.json({
      error: `${tpl.code} v${tpl.version} is not fully signed off yet. Still outstanding: ` +
        `${outstanding.map(r => SIGN_OFF_LABEL[r]).join(', ')}.`,
      outstanding,
    }, { status: 409 })
  }

  const row = {
    template_id: templateId,
    customer,
    po_number: poNumber,
    item_number:  strOrNull(body.itemNumber),
    product:      strOrNull(body.product),
    net_mass:     strOrNull(body.netMass),
    gross_mass:   strOrNull(body.grossMass),
    importer:     strOrNull(body.importer),
    ordered_bags: posInt(body.orderedBags),
    planned_batch_no: strOrNull(body.plannedBatchNo),
    planned_date:     strOrNull(body.plannedDate),
    notes:            strOrNull(body.notes),
    created_by: caller.userId,
  }

  const { data, error } = await admin.from('label_po_assignments').insert(row).select('*').single()
  if (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({
        error: `PO ${poNumber} is already assigned to ${tpl.code} v${tpl.version}.`,
      }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await writeAudit({
    actorId: caller.userId, action: 'create', schema: 'public',
    table: 'label_po_assignments', recordId: data.id, after: row,
  })

  return NextResponse.json({ assignment: data })
}

/** Update the supply-chain hints or the status of an existing assignment. */
export async function PATCH(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_assign_label_po')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const id = str(body.id)
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const [key, col] of [
    ['plannedBatchNo', 'planned_batch_no'],
    ['plannedDate', 'planned_date'],
    ['orderedBags', 'ordered_bags'],
    ['importer', 'importer'],
    ['netMass', 'net_mass'],
    ['grossMass', 'gross_mass'],
    ['notes', 'notes'],
    ['status', 'status'],
  ] as const) {
    if (body[key] !== undefined) patch[col] = body[key]
  }

  if (patch.status && !['open', 'in_production', 'closed', 'cancelled'].includes(String(patch.status))) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const admin = labelDb()
  const { data: before } = await admin.from('label_po_assignments').select('*').eq('id', id).maybeSingle()
  const { data, error } = await admin
    .from('label_po_assignments').update(patch).eq('id', id).select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })

  await writeAudit({
    actorId: caller.userId, action: 'update', schema: 'public',
    table: 'label_po_assignments', recordId: id, before, after: patch,
  })

  return NextResponse.json({ assignment: data })
}
