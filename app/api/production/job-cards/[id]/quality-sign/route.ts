import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, resolveEmployeeId } from '@/lib/auth/server-helpers'

// The Quality Officer's "Verify & Sign" — only once a card is approved. Same
// pattern as send-for-approval/decide: the signature is resolved server-side
// from the caller's own Staff Directory record, never accepted from the client.

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: cardId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (caller.department !== 'Quality' && caller.role !== 'senior_developer') {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const admin = getAdminClient() as any
  const employeeId = await resolveEmployeeId(caller.userId)
  const { data: sigRow } = employeeId
    ? await admin.schema('production').from('employee_signatures').select('signature').eq('employee_id', employeeId).maybeSingle()
    : { data: null }
  if (!sigRow?.signature) {
    return NextResponse.json({ error: 'No signature on file — set one up on your Staff Directory profile first.' }, { status: 400 })
  }

  const { data: card, error: cErr } = await admin.from('job_cards_pasteuriser')
    .select('id, status').eq('id', cardId).maybeSingle()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!card) return NextResponse.json({ error: 'Job card not found' }, { status: 404 })
  if (card.status !== 'approved') return NextResponse.json({ error: 'Job card is not yet approved' }, { status: 400 })

  const now = new Date().toISOString()
  const { data: updated, error: uErr } = await admin.from('job_cards_pasteuriser')
    .update({ sig_quality_officer: sigRow.signature, quality_signed_by: caller.userId, quality_signed_at: now } as any)
    .eq('id', cardId).select('*').single()
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, record: updated })
}
