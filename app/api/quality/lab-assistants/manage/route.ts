// app/api/quality/lab-assistants/manage/route.ts
// Quality manager / lab manager / IT only.
// Returns all lab assistants with their PIN visible so managers can view and share it.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function GET() {
  try {
    const caller = await getCallerPermissions()
    const ok =
      (caller as any).can?.('can_manage_users') ||
      (caller as any).role === 'quality_manager' ||
      (caller as any).role === 'lab_manager' ||
      (caller as any).department === 'IT' ||
      (caller as any).isFullAdmin ||
      (caller as any).isIT
    if (!ok) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const admin = getAdminClient()

    const { data: rows, error } = await admin
      .schema('qms' as any)
      .from('lab_auth')
      .select('user_id, full_name, pin, active, created_at')
      .order('full_name')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(rows ?? [])
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
