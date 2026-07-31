// app/api/quality/coa-signoff/route.ts
//
// Persisted COA sign-off with a lab → QA hand-off, so the two managers can sign
// the SAME COA from their own logins at different times.
//
// Security: the signature applied is ALWAYS the caller's own Staff Directory
// signature (production.employee_signatures), resolved server-side from the
// caller's session. A client can never supply or apply anyone else's signature,
// and a slot can only be signed by the person whose login email is designated
// for it in qms.coa_signatories.

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient, getSessionClient, resolveEmployeeId } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients } from '@/lib/notifications/recipients'

async function caller() {
  const db = await getSessionClient()
  const { data: { user } } = await db.auth.getUser()
  return user ? { id: user.id, email: (user.email || '').toLowerCase() } : null
}

// slot 1 = lab manager (signs first), slot 2 = QA manager.
async function signatoryEmails(admin: any) {
  const { data } = await admin.schema('qms').from('coa_signatories').select('slot, name, email').order('slot')
  const lab = (data ?? []).find((r: any) => r.slot === 1) || (data ?? [])[0]
  const qa  = (data ?? []).find((r: any) => r.slot === 2) || (data ?? [])[1]
  return { lab, qa }
}

export async function GET(req: NextRequest) {
  const batch = req.nextUrl.searchParams.get('batch_no')
  if (!batch) return NextResponse.json({ error: 'batch_no required' }, { status: 400 })
  const admin = getAdminClient() as any
  const { data } = await admin.schema('qms').from('coa_signoffs').select('*').eq('batch_no', batch).maybeSingle()
  return NextResponse.json({ signoff: data ?? null })
}

export async function POST(req: NextRequest) {
  const me = await caller()
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { batch_no, action } = body as { batch_no?: string; action?: string }
  if (!batch_no) return NextResponse.json({ error: 'batch_no required' }, { status: 400 })

  const admin = getAdminClient() as any
  const { lab, qa } = await signatoryEmails(admin)
  const nowIso = new Date().toISOString()

  // ── Hand off to the Quality manager ──
  if (action === 'send_to_qa') {
    const { data: row } = await admin.schema('qms').from('coa_signoffs').select('*').eq('batch_no', batch_no).maybeSingle()
    if (!row?.lab_signed_at) return NextResponse.json({ error: 'The lab manager must sign off first.' }, { status: 400 })
    if (me.email !== (lab?.email || '').toLowerCase())
      return NextResponse.json({ error: 'Only the lab manager can send the COA to the QA manager.' }, { status: 403 })

    await admin.schema('qms').from('coa_signoffs')
      .update({ status: 'sent_to_qa', sent_to_qa_at: nowIso, updated_at: nowIso }).eq('batch_no', batch_no)

    // Notify the designated QA manager (best-effort).
    try {
      if (qa?.email) {
        const list = await admin.auth.admin.listUsers({ perPage: 1000 })
        const qaUser = (list.data?.users ?? []).find((u: any) => (u.email || '').toLowerCase() === qa.email.toLowerCase())
        if (qaUser) {
          const recipients = await resolveRecipients([qaUser.id])
          if (recipients.length) await notify({
            recipients, kind: 'coa_signoff',
            title: `COA ready for your sign-off — ${batch_no}`,
            body: `${lab?.name || 'The lab manager'} has signed the COA for batch ${batch_no}. Open the COA Generator, look up ${batch_no}, and sign off.`,
            url: '/quality/coa', channels: ['inApp'],
          })
        }
      }
    } catch { /* notification is best-effort */ }

    const { data: updated } = await admin.schema('qms').from('coa_signoffs').select('*').eq('batch_no', batch_no).maybeSingle()
    return NextResponse.json({ signoff: updated })
  }

  // ── Sign a slot ──
  const slot = Number(body.slot)
  if (slot !== 1 && slot !== 2) return NextResponse.json({ error: 'slot must be 1 (lab) or 2 (QA)' }, { status: 400 })
  const target = slot === 1 ? lab : qa
  if (!target?.email) return NextResponse.json({ error: 'No login email is set for this signatory.' }, { status: 400 })
  if (me.email !== target.email.toLowerCase())
    return NextResponse.json({ error: `Only ${target.name || 'the designated signatory'} can sign this slot, from their own login.` }, { status: 403 })

  // QA can only sign after the lab manager.
  if (slot === 2) {
    const { data: row } = await admin.schema('qms').from('coa_signoffs').select('lab_signed_at').eq('batch_no', batch_no).maybeSingle()
    if (!row?.lab_signed_at) return NextResponse.json({ error: 'The lab manager must sign off first.' }, { status: 400 })
  }

  // The caller's OWN signature, server-resolved — never supplied by the client.
  const employeeId = await resolveEmployeeId(me.id)
  if (!employeeId) return NextResponse.json({ error: 'Your login is not linked to a Staff Directory record.', needSignature: true }, { status: 400 })
  const { data: sig } = await admin.schema('production').from('employee_signatures').select('signature').eq('employee_id', employeeId).maybeSingle()
  if (!sig?.signature) return NextResponse.json({ error: 'You have no signature on file. Create one on your Staff Directory profile first.', needSignature: true }, { status: 400 })

  const patch: any = { batch_no, customer: body.customer ?? null, grade: body.grade ?? null, updated_at: nowIso }
  if (slot === 1) {
    patch.lab_name = target.name ?? null; patch.lab_signed_by = me.email; patch.lab_signature = sig.signature; patch.lab_signed_at = nowIso
    patch.status = 'lab_signed'
  } else {
    patch.qa_name = target.name ?? null; patch.qa_signed_by = me.email; patch.qa_signature = sig.signature; patch.qa_signed_at = nowIso
    patch.status = 'complete'
  }
  await admin.schema('qms').from('coa_signoffs').upsert(patch, { onConflict: 'batch_no' })

  const { data: updated } = await admin.schema('qms').from('coa_signoffs').select('*').eq('batch_no', batch_no).maybeSingle()
  return NextResponse.json({ signoff: updated })
}
