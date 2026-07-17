// app/api/production/roster/audit/route.ts
//
// Records a shift-roster activity event into the central audit log
// (axis.audit_log) so pre-planning and changes to the roster are visible in the
// Users & Roles → Audit trail. The roster page mutates production.roster_*
// directly from the client (RLS-guarded), so this small server route is how
// those client actions get an audited, actor-attributed trail: writeAudit() is
// service-role only and must run server-side.
//
// Auth: signed-in caller who can edit or submit some roster section (or a full
// admin). The action string / section come from the client, but the actor id is
// taken from the verified session — never trusted from the body.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { writeAudit } from '@/lib/audit/write'
import { ROSTER_SECTION_KEYS, rosterPerm } from '@/lib/auth/permissions'

// Roster actions we accept — keeps the audit `action` column tidy and prevents
// arbitrary strings being written from the client.
const ALLOWED_ACTIONS = new Set([
  'roster_edit',      // a department section was saved
  'roster_submit',    // a section was signed off
  'roster_publish',   // the period was published (only fires automatically now)
  'roster_unpublish', // an admin reopened a published period
  'roster_generate',  // next week's period was generated
  'roster_delete',    // a period was deleted
])

// Which production table each action best maps to, for the audit record.
const ACTION_TABLE: Record<string, string> = {
  roster_edit:      'roster_entries',
  roster_submit:    'roster_section_status',
  roster_publish:   'roster_periods',
  roster_unpublish: 'roster_periods',
  roster_generate:  'roster_periods',
  roster_delete:    'roster_periods',
}

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  const isEditor = !!caller.userId && (
    caller.role === 'senior_developer' ||
    ROSTER_SECTION_KEYS.some(s => caller.can(rosterPerm('edit', s)) || caller.can(rosterPerm('submit', s)))
  )
  if (!isEditor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any = {}
  try { body = await req.json() } catch { /* empty body is fine */ }

  const action = String(body.action ?? '')
  if (!ALLOWED_ACTIONS.has(action))
    return NextResponse.json({ error: 'Unknown roster action' }, { status: 400 })

  await writeAudit({
    actorId:  caller.userId,
    action,
    schema:   'production',
    table:    ACTION_TABLE[action],
    recordId: body.periodId ?? null,
    // `after` carries a human-readable summary of the pre-planning activity so
    // the audit row is meaningful without joining back to the roster tables.
    after: {
      period:  body.periodName ?? null,
      section: body.section ?? null,
      detail:  body.detail ?? null,
    },
    ip:        req.headers.get('x-forwarded-for'),
    userAgent: req.headers.get('user-agent'),
  })

  return NextResponse.json({ ok: true })
}
