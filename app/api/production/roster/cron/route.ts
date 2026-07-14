// app/api/production/roster/cron/route.ts
//
// Unattended shift-roster automation, hit by GitHub Actions (see
// .github/workflows/roster-rotate.yml). Two tasks via ?task=:
//
//   rotate — create the next period from the latest one, day↔night swapped and
//            Shift A/B labels rotated (idempotent: skips if already rotated).
//   remind — email whoever holds can_submit_roster_<section> for each section
//            that has NOT yet been submitted for the current period.
//
// Auth: no user session — caller must present  Authorization: Bearer <CRON_SECRET>
// Writes use the service-role client (bypasses RLS). `shared.app_roles` is read
// via the public.roster_submitter_candidates() SECURITY DEFINER function.
//
// Required env: CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient, getCallerPermissions } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { getRosterSubmitterIds } from '@/lib/notifications/recipients'
import { createRotatedPeriod, nextPeriodConfig, type RotatePeriod } from '@/lib/production/roster-rotate'
import { ROSTER_SECTION_KEYS, ROSTER_SECTION_LABEL, rosterPerm, type RosterSectionKey } from '@/lib/auth/permissions'

const PERIOD_COLS = 'id,name,start_date,end_date,day_label,night_label'
const ENTRY_COLS  = 'role_key,shift,employee_id,operator_id,person_name,tags,sort_order'

async function latestPeriod(prod: any): Promise<RotatePeriod | null> {
  const { data } = await prod.from('roster_periods').select(PERIOD_COLS)
    .order('start_date', { ascending: false }).limit(1)
  return (data?.[0] as RotatePeriod) ?? null
}

// ── rotate ────────────────────────────────────────────────────────────────────
async function doRotate(prod: any) {
  const latest = await latestPeriod(prod)
  if (!latest) return { rotated: false, reason: 'no existing period to rotate from' }

  const config = nextPeriodConfig(latest)
  // Idempotent: if a period already starts on/after the computed next start, skip.
  const { data: ahead } = await prod.from('roster_periods').select('id')
    .gte('start_date', config.start).limit(1)
  if (ahead && ahead.length > 0) return { rotated: false, reason: 'next period already exists' }

  const { data: entries } = await prod.from('roster_entries').select(ENTRY_COLS).eq('period_id', latest.id)
  const res = await createRotatedPeriod(prod, latest, (entries as any[]) ?? [], null)
  if (!res) return { rotated: false, reason: 'insert failed' }
  return { rotated: true, periodId: res.periodId, period: res.config.name, entries: (entries ?? []).length }
}

// ── remind ──────────────────────────────────────────────────────────────────
async function doRemind(prod: any) {
  const period = await latestPeriod(prod)
  if (!period) return { reminded: 0, reason: 'no period' }

  const { data: statuses } = await prod.from('roster_section_status')
    .select('section,status').eq('period_id', period.id)
  const submitted = new Set((statuses ?? []).filter((s: any) => s.status === 'submitted').map((s: any) => s.section))
  const pending = ROSTER_SECTION_KEYS.filter(s => !submitted.has(s)) as RosterSectionKey[]
  if (pending.length === 0) return { reminded: 0, reason: 'all sections submitted' }

  // Resolve emails/names from auth.users (service-role admin API).
  const admin = getAdminClient()
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const authMap = new Map((list?.users ?? []).map(u => [u.id, u]))

  // One notification per (user, section) — not aggregated — so each reminder
  // maps to exactly one section and can be auto-dismissed the moment that
  // section is submitted (see production.dismiss_roster_reminders trigger).
  let reminded = 0
  const remindedUsers = new Set<string>()
  for (const section of pending) {
    const ids = await getRosterSubmitterIds(section)
    const label = ROSTER_SECTION_LABEL[section]
    for (const userId of ids) {
      const au = authMap.get(userId)
      const email = au?.email ?? null
      if (!email) continue
      await notify({
        recipients: [{ userId, email, name: (au?.user_metadata as any)?.full_name ?? null }],
        kind:  'roster_reminder',
        title: `Shift roster — submit ${label} for "${period.name}"`,
        body:  `The roster for ${period.name} is awaiting your submission for: ${label}. Please review and submit before Wednesday.`,
        url:   '/production/roster',
        channels: ['inApp', 'email'],
        rosterPeriodId: period.id,
        rosterSection:  section,
      })
      reminded++
      remindedUsers.add(userId)
    }
  }
  if (remindedUsers.size === 0) return { reminded: 0, reason: 'no submitters hold pending sections' }
  return { reminded, period: period.name, pending }
}

async function handle(req: NextRequest) {
  // Two ways in: the unattended cron (Bearer CRON_SECRET), or a signed-in user
  // with roster edit rights (so the "Generate next week" button can trigger the
  // reminder email). One of the two must hold.
  const secret = process.env.CRON_SECRET
  const viaCron = !!secret && req.headers.get('authorization') === `Bearer ${secret}`
  if (!viaCron) {
    const caller = await getCallerPermissions()
    const isEditor = !!caller.userId && (
      caller.role === 'senior_developer' ||
      ROSTER_SECTION_KEYS.some(s => caller.can(rosterPerm('edit', s)))
    )
    if (!isEditor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const task = new URL(req.url).searchParams.get('task')
  if (task !== 'rotate' && task !== 'remind')
    return NextResponse.json({ error: 'Pass ?task=rotate or ?task=remind' }, { status: 400 })

  try {
    const prod = getAdminClient().schema('production' as any)
    const result = task === 'rotate' ? await doRotate(prod) : await doRemind(prod)
    return NextResponse.json({ ok: true, task, ...result })
  } catch (err: any) {
    console.error('[api/production/roster/cron]', err)
    return NextResponse.json({ error: err?.message ?? 'Failed' }, { status: 500 })
  }
}

export const POST = handle
export const GET  = handle
