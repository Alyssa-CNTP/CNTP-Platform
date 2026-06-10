// app/api/admin/audit/auth-event/route.ts
// Receives sign_in / sign_out events from the client and writes them to axis.audit_log.
// Called from lib/auth/context.tsx after successful auth state changes.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { action, email } = body

  if (action !== 'sign_in' && action !== 'sign_out')
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const admin = getAdminClient()
  const { error } = await (admin as any).schema('axis').from('audit_log').insert({
    actor_id:    caller.userId,
    action,
    schema_name: 'auth',
    table_name:  'users',
    record_id:   caller.userId,
    after_state: email ? { email, department: caller.department, role: caller.role } : { department: caller.department, role: caller.role },
  })

  if (error) {
    console.error('[api/admin/audit/auth-event POST]', error)
    // Non-fatal — don't fail the auth flow over a logging error
  }

  return NextResponse.json({ ok: true })
}
