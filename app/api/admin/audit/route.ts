// app/api/admin/audit/route.ts
// Returns audit log entries from axis.audit_log.
// Accessible to IT department and authorised administrators (Alyssa, Jan).

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'

const ALYSSA_UUID = 'df6cc2b1-c0ec-47ed-bb2e-b07771f3bf0e'
const JAN_UUID    = 'f73cd225-63f7-4056-918e-f5112c9637e8'

export async function GET(req: NextRequest) {
  const caller = await getCallerPermissions()
  const isAuthorised =
    caller.userId === ALYSSA_UUID ||
    caller.userId === JAN_UUID    ||
    caller.department === 'IT'
  if (!caller.userId || !isAuthorised)
    return NextResponse.json({ error: 'Access restricted to IT and authorised administrators' }, { status: 403 })

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

  // Enrich with display names, department and role from shared.app_roles
  const actorIds = [...new Set((data ?? []).map((r: any) => r.actor_id).filter(Boolean))] as string[]
  type ActorMeta = { name: string; department: string | null; role: string | null }
  let actorMap: Record<string, ActorMeta> = {}

  if (actorIds.length > 0) {
    try {
      const session = await getSessionClient()
      const { data: roles } = await (session as any)
        .schema('shared')
        .from('app_roles')
        .select('user_id, full_name, department, role')
        .in('user_id', actorIds)
      if (roles) {
        actorMap = Object.fromEntries(
          (roles as any[]).map((r: any) => [r.user_id, { name: r.full_name, department: r.department, role: r.role }])
        )
      }
    } catch {
      // name enrichment is best-effort
    }
  }

  const enriched = (data ?? []).map((r: any) => {
    const meta = r.actor_id ? actorMap[r.actor_id] : null
    return {
      ...r,
      actor_name:       meta?.name       ?? (r.actor_id ? 'Unknown user' : 'System'),
      actor_department: meta?.department ?? (r.after_state?.department ?? null),
      actor_role:       meta?.role       ?? null,
    }
  })

  return NextResponse.json(enriched)
}
