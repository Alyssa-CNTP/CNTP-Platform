import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'

export async function POST(req: NextRequest) {
  const [caller, sessionClient] = await Promise.all([getCallerPermissions(), getSessionClient()])
  const { data: { user: authUser } } = await sessionClient.auth.getUser()

  if (!caller.userId)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_manage_competencies'))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body?.employee_id || !body?.sop_id)
    return NextResponse.json({ error: 'employee_id and sop_id are required' }, { status: 400 })

  const {
    employee_id, sop_id,
    status, raw_code, score,
    training_completed, date_completed,
    assessed_by, assessed_at, next_review,
    notes,
  } = body

  const admin = getAdminClient()
  const db = (admin as any).schema('production')

  // Read before-state for history + audit
  const { data: existing } = await db
    .from('employee_competencies')
    .select('id,status,score')
    .eq('employee_id', employee_id)
    .eq('sop_id', sop_id)
    .maybeSingle()

  // Upsert the competency record
  const upsertPayload: Record<string, unknown> = {
    employee_id, sop_id,
    status: status ?? 'not_started',
    raw_code: raw_code ?? null,
    score: score ?? null,
    training_completed: training_completed ?? null,
    date_completed: date_completed ?? null,
    assessed_by: assessed_by ?? null,
    assessed_at: assessed_at ?? null,
    next_review: next_review ?? null,
    notes: notes ?? null,
  }

  const { data: upserted, error: upsertErr } = await db
    .from('employee_competencies')
    .upsert(upsertPayload, { onConflict: 'employee_id,sop_id' })
    .select('id,status,score')
    .single()

  if (upsertErr)
    return NextResponse.json({ error: upsertErr.message }, { status: 500 })

  // Determine action label
  const action = existing ? 'status_change' : 'created'

  // Append to competency_history
  const { error: histErr } = await db.from('competency_history').insert({
    competency_id:   upserted.id,
    employee_id,
    sop_id,
    action,
    from_status:     existing?.status ?? null,
    to_status:       status ?? null,
    from_score:      existing?.score ?? null,
    to_score:        score ?? null,
    changed_by:      caller.userId,
    changed_by_name: authUser?.email ?? authUser?.user_metadata?.full_name ?? caller.role ?? 'Unknown',
    note:            notes ?? null,
  })

  if (histErr)
    console.error('[api/staff/competencies] history insert failed:', histErr)

  // Best-effort axis.audit_log
  try {
    await (admin as any).schema('axis').from('audit_log').insert({
      actor_id:    caller.userId,
      action:      'competency_update',
      schema_name: 'production',
      table_name:  'employee_competencies',
      record_id:   upserted.id,
      before_state: existing
        ? { status: existing.status, score: existing.score }
        : null,
      after_state: { status, score, assessed_by, assessed_at, next_review },
    })
  } catch (e) {
    console.error('[api/staff/competencies] audit_log insert failed:', e)
  }

  return NextResponse.json({ ok: true, id: upserted.id })
}
