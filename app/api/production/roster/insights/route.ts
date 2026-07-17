// app/api/production/roster/insights/route.ts
//
// Admin-only "what's actually happening in the backend" view for a roster
// period: real per-section submission state (who + exact timestamp, from the
// DB — not a derived UI checkmark), the recent audit trail for this period,
// and the most recent rotate/remind cron runs (so an outage like the Jul 8/12/13
// CRON_SECRET 401s is visible in the app, not just in GitHub Actions logs).
//
// Auth: full admin only (role === 'senior_developer') — same gate as the
// roster page's Reopen action and the Users & Roles audit tab.

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient, getCallerPermissions, getSessionClient } from '@/lib/auth/server-helpers'

export async function GET(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (caller.role !== 'senior_developer')
    return NextResponse.json({ error: 'Access restricted to full admins' }, { status: 403 })

  const periodId = new URL(req.url).searchParams.get('periodId')
  if (!periodId) return NextResponse.json({ error: 'periodId is required' }, { status: 400 })

  const admin = getAdminClient()
  const prod = admin.schema('production' as any)

  const [{ data: sectionRows }, { data: auditRows }, { data: cronRows }] = await Promise.all([
    prod.from('roster_section_status')
      .select('section,status,submitted_by,submitted_at').eq('period_id', periodId),
    (admin as any).schema('axis').from('audit_log')
      .select('id,actor_id,action,table_name,after_state,created_at')
      .eq('record_id', periodId).order('created_at', { ascending: false }).limit(30),
    prod.from('roster_cron_log')
      .select('task,ran_at,result').order('ran_at', { ascending: false }).limit(10),
  ])

  // Resolve actor / submitter display names in one pass (shared.app_roles, then
  // auth.users as a fallback) — mirrors the enrichment in /api/admin/audit.
  const ids = new Set<string>()
  ;(sectionRows ?? []).forEach((r: any) => { if (r.submitted_by) ids.add(r.submitted_by) })
  ;(auditRows ?? []).forEach((r: any) => { if (r.actor_id) ids.add(r.actor_id) })

  const nameMap: Record<string, string> = {}
  if (ids.size > 0) {
    const idList = Array.from(ids)
    const session = await getSessionClient()
    const [{ data: roles }, list] = await Promise.all([
      session.schema('shared' as any).from('app_roles')
        .select('user_id, full_name').in('user_id', idList),
      admin.auth.admin.listUsers({ perPage: 1000 }),
    ])
    const authMap = new Map((list.data?.users ?? []).map(u => [u.id, u]))
    ;(roles ?? []).forEach((r: any) => { if (r.full_name) nameMap[r.user_id] = r.full_name })
    idList.forEach(id => {
      if (!nameMap[id]) nameMap[id] = authMap.get(id)?.user_metadata?.full_name || authMap.get(id)?.email || 'Unknown user'
    })
  }

  const sections = (sectionRows ?? []).map((r: any) => ({
    section: r.section, status: r.status,
    submittedById: r.submitted_by,
    submittedByName: r.submitted_by ? (nameMap[r.submitted_by] ?? 'Unknown user') : null,
    submittedAt: r.submitted_at,
  }))

  const activity = (auditRows ?? []).map((r: any) => ({
    id: r.id, action: r.action, table: r.table_name,
    actorId: r.actor_id, actorName: r.actor_id ? (nameMap[r.actor_id] ?? 'Unknown user') : 'System',
    detail: r.after_state, createdAt: r.created_at,
  }))

  const cron = {
    remind: (cronRows ?? []).find((r: any) => r.task === 'remind') ?? null,
    rotate: (cronRows ?? []).find((r: any) => r.task === 'rotate') ?? null,
  }

  return NextResponse.json({ sections, activity, cron })
}
