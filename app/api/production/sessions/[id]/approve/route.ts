import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, resolveEmployeeId } from '@/lib/auth/server-helpers'

// A production supervisor approving a capture session IS their "Verify & Sign"
// — their signature is resolved server-side from production.employee_signatures
// (their own Staff Directory record), never accepted from the client. Mirrors
// job cards' PATCH decide route (app/api/production/job-cards/[id]/decide).

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const canApprove = caller.role === 'production_supervisor' || caller.role === 'supervisor'
    || caller.department === 'IT' || caller.role === 'admin' || caller.role === 'senior_developer'
  if (!canApprove) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { body = {} }
  const endOfRun: boolean = !!body?.endOfRun

  const admin = getAdminClient() as any
  const employeeId = await resolveEmployeeId(caller.userId)

  const { data: sigRow } = employeeId
    ? await admin.schema('production').from('employee_signatures').select('signature').eq('employee_id', employeeId).maybeSingle()
    : { data: null }
  if (!sigRow?.signature) {
    return NextResponse.json({ error: 'No signature on file — set one up on your Staff Directory profile first.' }, { status: 400 })
  }

  const { data: session, error: sErr } = await admin.schema('production').from('prod_sessions')
    .select('id, status, run_id').eq('id', sessionId).maybeSingle()
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status !== 'submitted') return NextResponse.json({ error: 'Session is not awaiting approval' }, { status: 400 })

  const { data: emp } = employeeId
    ? await admin.schema('production').from('employees').select('name, display_name').eq('id', employeeId).maybeSingle()
    : { data: null }
  const supervisorName = emp?.display_name || emp?.name || caller.name || 'Supervisor'
  const now = new Date().toISOString()

  await admin.schema('production').from('session_signatures').insert({
    session_id: sessionId, signer_role: 'supervisor', signer_name: supervisorName,
    signer_user_id: caller.userId, signature_b64: sigRow.signature,
  })

  const { data: updated, error: uErr } = await admin.schema('production').from('prod_sessions').update({
    status: 'approved', sup_signed: true, sup_name_signoff: supervisorName, sup_signed_at: now, updated_at: now,
  }).eq('id', sessionId).select('*').single()
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  if (endOfRun && session.run_id) {
    await admin.schema('production').from('production_runs')
      .update({ status: 'closed', closed_at: now }).eq('id', session.run_id)
  }

  return NextResponse.json({ ok: true, record: updated })
}
