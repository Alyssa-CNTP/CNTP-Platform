// app/api/quality/lab-assistants/manage/reveal/route.ts
// GET ?name=<full_name> — the ONLY way to get a lab assistant's actual PIN
// back to the browser. The list route (../route.ts) deliberately never
// includes it — clicking "reveal" on one row makes exactly this request, for
// exactly that one person, and it's audit-logged.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { writeAudit } from '@/lib/audit/write'

function normName(n: string) { return (n ?? '').trim().toLowerCase() }

export async function GET(req: NextRequest) {
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

    const name = req.nextUrl.searchParams.get('name')
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const admin = getAdminClient() as any
    const { data } = await admin.schema('qms').from('lab_auth').select('pin, full_name')

    const row = (data ?? []).find((r: any) => normName(r.full_name) === normName(name))
    if (!row?.pin) return NextResponse.json({ error: 'No PIN on file' }, { status: 404 })

    await writeAudit({
      actorId: caller.userId, action: 'reveal_pin',
      schema: 'qms', table: 'lab_auth', recordId: name,
    })

    return NextResponse.json({ pin: row.pin })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
