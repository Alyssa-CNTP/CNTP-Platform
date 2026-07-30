// app/api/esign/requests/[id]/void/route.ts
// POST — cancel a pending request (e.g. "Cancel request" / re-send flow on
// the dispatch Checklist tab). Voiding an already-signed request voids its
// signature row too (allowed transition per the immutability trigger), but
// never edits it — history is preserved, just marked terminal.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { getSubject } from '@/lib/esign/subjects'
import { voidRequest } from '@/lib/esign/request'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const admin = getAdminClient() as any
  const { data: reqRow } = await admin.schema('esign').from('signature_requests')
    .select('subject_type, status').eq('id', id).maybeSingle()
  if (!reqRow) return NextResponse.json({ error: 'Signature request not found' }, { status: 404 })

  const subject = getSubject(reqRow.subject_type)
  if (!subject || !caller.can(subject.voidPermission)) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }
  if (reqRow.status === 'voided') return NextResponse.json({ ok: true })

  let reason: string | undefined
  try { reason = (await req.json())?.reason } catch { /* optional body */ }

  await voidRequest(id, caller.userId, reason)
  return NextResponse.json({ ok: true })
}
