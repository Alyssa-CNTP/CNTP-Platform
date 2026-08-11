// app/api/production/operators/[id]/pin/route.ts
// GET — the ONLY way to get an operator's actual PIN back to the browser.
// The list load in app/(app)/production/operators/page.tsx deliberately
// excludes it — clicking "reveal" on one row makes exactly this request,
// for exactly that one operator, and it's audit-logged.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { writeAudit } from '@/lib/audit/write'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.can('can_reset_operator_pin') && !caller.can('can_manage_users')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const { id } = await params
    const admin = getAdminClient() as any
    const { data } = await admin.schema('production').from('operators').select('pin').eq('id', id).maybeSingle()
    if (!data?.pin) return NextResponse.json({ error: 'No PIN on file' }, { status: 404 })

    await writeAudit({
      actorId: caller.userId, action: 'reveal_pin',
      schema: 'production', table: 'operators', recordId: id,
    })

    return NextResponse.json({ pin: data.pin })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
