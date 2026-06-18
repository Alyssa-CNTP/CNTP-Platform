// app/api/maintenance/spare-requests/route.ts
// Server-side reorder/part-request creation. Inserts the request and notifies the
// maintenance manager(s) (purchasing). The client reads requests directly via
// supabase (defensive load in useMaintenanceData), so no GET is exposed here.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients, getMaintenanceManagerIds } from '@/lib/notifications/recipients'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const b = await req.json().catch(() => ({}))
    const description: string = (b.description ?? '').toString().trim()
    if (!description) return NextResponse.json({ error: 'A description is required' }, { status: 400 })
    const qty = Math.max(1, parseInt(String(b.qty ?? 1), 10) || 1)
    const part_no: string | null = b.part_no ?? null

    const db = await getSessionClient()
    const { data: request, error } = await db.schema('maintenance' as any).from('spare_requests').insert({
      part_id: b.part_id ?? null,
      part_no,
      description,
      qty,
      reason: b.reason ?? 'other',
      card_id: b.card_id ?? null,
      note: b.note ?? null,
      requested_by: b.requested_by ?? null,
      requested_by_user_id: caller.userId,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // ── Notify the maintenance manager(s) / purchasing (best-effort) ──
    try {
      const managerIds = await getMaintenanceManagerIds()
      const recipients = await resolveRecipients(managerIds)
      if (recipients.length) {
        await notify({
          recipients,
          kind: 'spare_request',
          title: 'Part request: ' + description,
          body: `${qty} × ${part_no || description}${b.note ? ' — ' + b.note : ''}`,
          url: '/maintenance/stock',
          channels: ['inApp', 'email'],
        })
      }
    } catch (e: any) {
      console.error('[api/maintenance/spare-requests notify]', e?.message)
    }

    return NextResponse.json({ request })
  } catch (err: any) {
    console.error('[api/maintenance/spare-requests POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}
