// app/api/production/operators/[id]/route.ts
// Delete an operator and its hidden auth account.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.can('can_reset_operator_pin') && !caller.can('can_manage_users'))
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const { id } = await params
    const admin   = getAdminClient()
    const session = await getSessionClient()

    const { data: op } = await admin.schema('production').from('operators')
      .select('user_id').eq('id', id).maybeSingle()

    await admin.schema('production').from('operators').delete().eq('id', id)

    const userId = (op as any)?.user_id as string | null
    if (userId) {
      await session.schema('shared' as any).from('app_roles').delete().eq('user_id', userId)
      await admin.auth.admin.deleteUser(userId).catch(() => {})
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
