// app/api/maintenance/technicians/manage/reveal/route.ts
// GET ?name=<person_name> — the ONLY way to get a technician's actual PIN back
// to the browser. The list route (../route.ts) deliberately never includes it,
// so a manager opening the Technicians page doesn't silently download every
// PIN in plaintext — clicking "reveal" on one row makes exactly this request,
// for exactly that one person, and it's audit-logged.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { writeAudit } from '@/lib/audit/write'

function normName(n: string) { return (n ?? '').trim().toLowerCase() }

export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    const ok =
      (caller as any).can?.('can_manage_users') ||
      (caller as any).role === 'maintenance_manager' ||
      (caller as any).department === 'IT' ||
      (caller as any).isFullAdmin ||
      (caller as any).isIT
    if (!ok) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const name = req.nextUrl.searchParams.get('name')
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const admin = getAdminClient() as any
    const { data } = await admin.schema('maintenance').from('tech_auth').select('pin, person_name')

    const row = (data ?? []).find((r: any) => normName(r.person_name) === normName(name))
    if (!row?.pin) return NextResponse.json({ error: 'No PIN on file' }, { status: 404 })

    await writeAudit({
      actorId: caller.userId, action: 'reveal_pin',
      schema: 'maintenance', table: 'tech_auth', recordId: name,
    })

    return NextResponse.json({ pin: row.pin })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
