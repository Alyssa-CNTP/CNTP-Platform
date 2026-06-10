// app/api/admin/audit/route.ts
// Returns audit log entries from axis.audit_log.
// Restricted to Alyssa and Jan by UUID — no permission toggle can override this.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'

const ALYSSA_UUID = 'df6cc2b1-c0ec-47ed-bb2e-b07771f3bf0e'
const JAN_UUID    = 'f73cd225-63f7-4056-918e-f5112c9637e8'

export async function GET(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId || (caller.userId !== ALYSSA_UUID && caller.userId !== JAN_UUID))
    return NextResponse.json({ error: 'Access restricted to authorised administrators only' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const limit    = Math.min(parseInt(searchParams.get('limit')  ?? '200', 10), 500)
  const offset   = parseInt(searchParams.get('offset') ?? '0', 10)
  const actorId  = searchParams.get('actor_id') ?? null
  const action   = searchParams.get('action')   ?? null

  const admin = getAdminClient()
  let query = (admin as any)
    .schema('axis')
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (actorId) query = query.eq('actor_id', actorId)
  if (action)  query = query.eq('action', action)

  const { data, error } = await query

  if (error) {
    console.error('[api/admin/audit GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Enrich with display names from shared.app_roles
  const actorIds = [...new Set((data ?? []).map((r: any) => r.actor_id).filter(Boolean))] as string[]
  let nameMap: Record<string, string> = {}

  if (actorIds.length > 0) {
    try {
      const session = await getSessionClient()
      const { data: roles } = await (session as any)
        .schema('shared')
        .from('app_roles')
        .select('user_id, full_name, department, role')
        .in('user_id', actorIds)
      if (roles) {
        nameMap = Object.fromEntries((roles as any[]).map((r: any) => [r.user_id, r.full_name]))
      }
    } catch {
      // name enrichment is best-effort
    }
  }

  const enriched = (data ?? []).map((r: any) => ({
    ...r,
    actor_name: r.actor_id ? (nameMap[r.actor_id] ?? 'Unknown user') : 'System',
  }))

  return NextResponse.json(enriched)
}
