import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { writeAudit } from '@/lib/audit/write'

// Record management for a captured production session (prod_sessions).
// Every action is permission-gated (can_edit_session / can_delete_session) and
// written to axis.audit_log with before/after snapshots. Soft-delete only — a
// deleted record is retained (deleted_at/by) and can be restored.
const EDITABLE = ['operator_names', 'variant', 'lot_number', 'production_orders', 'comments'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const action: string = body?.action

  const admin = getAdminClient() as any
  const { data: before, error: fErr } = await admin.schema('production')
    .from('prod_sessions').select('*').eq('id', id).maybeSingle()
  if (fErr)   return NextResponse.json({ error: fErr.message }, { status: 500 })
  if (!before) return NextResponse.json({ error: 'Record not found' }, { status: 404 })

  const ip  = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua  = req.headers.get('user-agent') ?? null
  const now = new Date().toISOString()

  let patch: Record<string, any> = {}
  let auditAction = action

  if (action === 'delete') {
    if (!caller.can('can_delete_session')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    patch = { deleted_at: now, deleted_by: caller.userId }
  } else if (action === 'restore') {
    if (!caller.can('can_delete_session')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    patch = { deleted_at: null, deleted_by: null }
  } else if (action === 'reopen') {
    if (!caller.can('can_edit_session')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    patch = { status: 'draft', edited_at: now, edited_by: caller.userId }
  } else if (action === 'edit') {
    if (!caller.can('can_edit_session')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    const fields = body?.fields ?? {}
    for (const k of EDITABLE) if (k in fields) patch[k] = fields[k]
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No editable fields' }, { status: 400 })
    patch.edited_at = now; patch.edited_by = caller.userId
    auditAction = 'update'
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const { data: after, error: uErr } = await admin.schema('production')
    .from('prod_sessions').update(patch).eq('id', id).select('*').maybeSingle()
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  await writeAudit({
    actorId: caller.userId, action: auditAction, schema: 'production', table: 'prod_sessions',
    recordId: id, before, after: after ?? { ...before, ...patch }, ip, userAgent: ua,
  })

  return NextResponse.json({ ok: true, record: after })
}
