import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

async function requireWorkspace() {
  const caller = await getCallerPermissions()
  if (!caller.userId)
    return { caller: null, error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  if (!caller.can('can_access_workspace') && caller.department !== 'IT')
    return { caller: null, error: NextResponse.json({ error: 'Permission denied' }, { status: 403 }) }
  return { caller, error: null }
}

export async function GET() {
  const { caller, error } = await requireWorkspace()
  if (error) return error

  const { data, error: dbErr } = await (getAdminClient() as any)
    .schema('workspace')
    .from('pulse_notes')
    .select('*')
    .eq('user_id', caller!.userId)

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const { caller, error } = await requireWorkspace()
  if (error) return error

  const { project_label, content } = await req.json()
  if (!project_label?.trim())
    return NextResponse.json({ error: 'project_label required' }, { status: 400 })

  const { error: dbErr } = await (getAdminClient() as any)
    .schema('workspace')
    .from('pulse_notes')
    .upsert(
      {
        user_id:       caller!.userId,
        project_label: project_label.trim(),
        content:       content ?? '',
        updated_at:    new Date().toISOString(),
      },
      { onConflict: 'user_id,project_label' }
    )

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
