import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { writeAudit } from '@/lib/audit/write'

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

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const templateId = String(body?.templateId ?? '').trim()
  const customer   = String(body?.customer ?? '').trim()
  const poNumber   = String(body?.poNumber ?? '').trim()
  if (!templateId || !customer || !poNumber) {
    return NextResponse.json({ error: 'templateId, customer and poNumber are all required' }, { status: 400 })
  }

  const admin = getAdminClient() as any

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

  const row = {
    template_id: templateId,
    customer,
    po_number: poNumber,
    item_number:  body?.itemNumber ?? null,
    product:      body?.product ?? null,
    net_mass:     body?.netMass ?? null,
    gross_mass:   body?.grossMass ?? null,
    importer:     body?.importer ?? null,
    ordered_bags: Number.isFinite(Number(body?.orderedBags)) && Number(body?.orderedBags) > 0
      ? Math.round(Number(body.orderedBags)) : null,
    planned_batch_no: body?.plannedBatchNo ?? null,
    planned_date:     body?.plannedDate ?? null,
    notes:            body?.notes ?? null,
    created_by: caller.userId,
  }

  const { data, error } = await admin.from('label_po_assignments').insert(row).select('*').single()
  if (error) {
    if ((error as any).code === '23505') {
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

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const id = String(body?.id ?? '').trim()
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

  const admin = getAdminClient() as any
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
