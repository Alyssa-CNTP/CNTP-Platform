// app/api/quality/coa-signoff/route.ts
//
// Persisted COA sign-off with a lab → QA hand-off, so the two managers can sign
// the SAME COA from their own logins at different times.
//
// Who may sign each slot is read from the Staff Directory (production.employees
// job title / position — see lib/quality/coa-managers): the Lab Manager signs
// slot 1, the Quality Manager signs slot 2. The signature applied is ALWAYS the
// caller's own (production.employee_signatures), resolved server-side — a client
// can never supply or apply anyone else's.

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient, getSessionClient, resolveEmployeeId } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients } from '@/lib/notifications/recipients'
import { classifyManager, resolveCoaManagers } from '@/lib/quality/coa-managers'

// Notify the Staff-Directory Quality manager that a COA is ready for sign-off.
async function notifyQaManager(admin: any, batchNo: string, labName: string | null) {
  try {
    const { qa } = await resolveCoaManagers(admin)
    if (!qa?.employeeId) return
    const { data: roleRow } = await admin.schema('shared').from('app_roles')
      .select('user_id').eq('employee_id', qa.employeeId).maybeSingle()
    if (!roleRow?.user_id) return
    const recipients = await resolveRecipients([roleRow.user_id])
    if (recipients.length) await notify({
      recipients, kind: 'coa_signoff',
      title: `COA ready for your sign-off — ${batchNo}`,
      body: `${labName || 'The lab manager'} has signed the COA for batch ${batchNo}. Open the COA Generator's "Awaiting QA sign-off" list to review and sign.`,
      url: '/quality/coa', channels: ['inApp'],
    })
  } catch { /* best-effort */ }
}

// Resolve the caller: their employee id, name, COA role (lab/qa/null) and their
// own on-file signature.
async function caller(admin: any) {
  const db = await getSessionClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return null
  const employeeId = await resolveEmployeeId(user.id)
  if (!employeeId) return { userId: user.id, employeeId: null, name: null, role: null, signature: null }
  const { data: emp } = await admin.schema('production').from('employees')
    .select('name, display_name, position, job_title').eq('id', employeeId).maybeSingle()
  const { data: sig } = await admin.schema('production').from('employee_signatures')
    .select('signature').eq('employee_id', employeeId).maybeSingle()
  return {
    userId: user.id,
    employeeId,
    name: emp?.display_name || emp?.name || null,
    role: classifyManager(emp),
    signature: sig?.signature ?? null,
  }
}

export async function GET(req: NextRequest) {
  const batch = req.nextUrl.searchParams.get('batch_no')
  if (!batch) return NextResponse.json({ error: 'batch_no required' }, { status: 400 })
  const admin = getAdminClient() as any
  const { data } = await admin.schema('qms').from('coa_signoffs').select('*').eq('batch_no', batch).maybeSingle()
  return NextResponse.json({ signoff: data ?? null })
}

export async function POST(req: NextRequest) {
  const admin = getAdminClient() as any
  const me = await caller(admin)
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { batch_no, action } = body as { batch_no?: string; action?: string }
  if (!batch_no) return NextResponse.json({ error: 'batch_no required' }, { status: 400 })
  const nowIso = new Date().toISOString()

  // ── Hand off to the Quality manager ──
  if (action === 'send_to_qa') {
    const { data: row } = await admin.schema('qms').from('coa_signoffs').select('*').eq('batch_no', batch_no).maybeSingle()
    if (!row?.lab_signed_at) return NextResponse.json({ error: 'The lab manager must sign off first.' }, { status: 400 })
    if (me.role !== 'lab') return NextResponse.json({ error: 'Only the lab manager can send the COA to the QA manager.' }, { status: 403 })

    await admin.schema('qms').from('coa_signoffs')
      .update({ status: 'sent_to_qa', sent_to_qa_at: nowIso, updated_at: nowIso }).eq('batch_no', batch_no)
    await notifyQaManager(admin, batch_no, me.name)

    const { data: updated } = await admin.schema('qms').from('coa_signoffs').select('*').eq('batch_no', batch_no).maybeSingle()
    return NextResponse.json({ signoff: updated })
  }

  // ── Sign a slot ──
  const slot = Number(body.slot)
  if (slot !== 1 && slot !== 2) return NextResponse.json({ error: 'slot must be 1 (lab) or 2 (QA)' }, { status: 400 })
  const needRole = slot === 1 ? 'lab' : 'qa'
  if (!me.employeeId) return NextResponse.json({ error: 'Your login is not linked to a Staff Directory record.', needSignature: true }, { status: 400 })
  if (me.role !== needRole)
    return NextResponse.json({ error: `Only the ${needRole === 'lab' ? 'Lab Manager' : 'Quality Manager'} (per the Staff Directory) can sign this slot.` }, { status: 403 })
  if (!me.signature) return NextResponse.json({ error: 'You have no signature on file. Create one on your Staff Directory profile first.', needSignature: true }, { status: 400 })

  if (slot === 2) {
    const { data: row } = await admin.schema('qms').from('coa_signoffs').select('lab_signed_at').eq('batch_no', batch_no).maybeSingle()
    if (!row?.lab_signed_at) return NextResponse.json({ error: 'The lab manager must sign off first.' }, { status: 400 })
  }

  const patch: any = { batch_no, customer: body.customer ?? null, grade: body.grade ?? null, updated_at: nowIso }
  if (slot === 1) {
    // Signing IS the hand-off: mark it sent and notify the QA manager right away
    // so the COA pops up for her (and lands in her "Awaiting QA sign-off" list).
    patch.lab_name = me.name; patch.lab_signed_by = me.userId; patch.lab_signature = me.signature; patch.lab_signed_at = nowIso
    patch.status = 'sent_to_qa'; patch.sent_to_qa_at = nowIso
  } else {
    patch.qa_name = me.name; patch.qa_signed_by = me.userId; patch.qa_signature = me.signature; patch.qa_signed_at = nowIso
    patch.status = 'complete'
  }
  await admin.schema('qms').from('coa_signoffs').upsert(patch, { onConflict: 'batch_no' })
  if (slot === 1) await notifyQaManager(admin, batch_no, me.name)

  const { data: updated } = await admin.schema('qms').from('coa_signoffs').select('*').eq('batch_no', batch_no).maybeSingle()
  return NextResponse.json({ signoff: updated })
}
