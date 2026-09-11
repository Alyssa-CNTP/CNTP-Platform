// app/api/production/shift-clock/route.ts
//
// The operator's shift clock: it starts at LOGIN and stops at LOGOUT.
//
// ── Why the clock is here and not on the capture screen ─────────────────────
//
// The timesheet's shift start used to be the first `production.capture_activity`
// heartbeat, and every one of those is written by `/production/capture/[section]`.
// So the clock did not start when the operator started — it started when they
// first opened the capture page, and if they never reached Sign-off it never
// started at all (the fallback was the earliest SCHEDULED break, which reads
// 10:30 on a morning shift). The floor reported it as "timesheets only start
// working when I go into the capture page and the sign off module".
//
// Signing in is not capture's fact. It happens in the app shell, before any
// section is chosen, and it is equally true on a day spent in Quality or on the
// Supervisor Hub. So it lives here, is driven by `features/shift-clock` from
// the app shell, and the timesheet READS it.
//
// ── Why the browser cannot write this table directly ────────────────────────
//
// Every other timesheet table holds what the operator SAYS happened, and they
// must be able to correct it. This one holds when they actually signed in and
// it decides paid hours — the entire reason for anchoring the clock to the
// login is that nobody types it. So `operator_shift_clock` is SELECT-only to
// `authenticated` (see the migration) and every write goes through this route,
// which takes the identity from the session and the time from the server.
//
// A client-supplied timestamp is never trusted here for the same reason.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { productionDayFor, isCloseReason, type CloseReason } from '@/lib/core/timesheet/shift-clock'

export const runtime = 'nodejs'

const TABLE = 'operator_shift_clock'

type Admin = ReturnType<typeof getAdminClient>
const clock = (admin: Admin) => (admin as any).schema('production').from(TABLE)

/**
 * Who this person is, for the clock.
 *
 * `operator_name` MUST be resolved the same way the capture screen resolves it
 * — `operators.display_name || operators.name` — because that is the key
 * `prod_timesheets` and `timesheet_stoppages` are written under. Taking the
 * auth profile name instead would produce a clock row for "Sipho Mthembu" and
 * a timesheet for "Sipho M", and the timesheet would find no clock at all.
 *
 * Returns null for someone who has no business on a production clock, which is
 * how an accountant logging in avoids minting a shift.
 */
/**
 * Roles that work a production shift without necessarily having an `operators`
 * row — supervisors and managers on the floor. Listed rather than inferred from
 * the department alone because `shared.app_roles.department` is nullable and a
 * floor operator whose department was never filled in still works shifts, and
 * excluding them would give them no timesheet at all: the exact failure this
 * change exists to end, in a new costume.
 */
const CLOCKED_ROLES = new Set([
  'floor_operator', 'operator', 'section_operator',
  'production_supervisor', 'supervisor',
])

async function resolveOperator(
  admin: Admin,
  userId: string,
  callerName: string | null,
  department: string | null,
  role: string | null,
) {
  const { data: op } = await (admin as any).schema('production').from('operators')
    .select('id,name,display_name,section_ids,active')
    .eq('user_id', userId).maybeSingle()

  if (op) {
    return {
      operatorId:   op.id as string,
      operatorName: (op.display_name || op.name) as string,
      sectionId:    (Array.isArray(op.section_ids) && op.section_ids.length === 1)
        ? String(op.section_ids[0]) : null,
    }
  }

  // No operators row. Production supervisors and managers still work shifts and
  // still need a clock; everybody else does not.
  if (department !== 'Production' && !CLOCKED_ROLES.has(role ?? '')) return null
  if (!callerName) return null

  const { data: appRole } = await (admin as any).schema('shared').from('app_roles')
    .select('section_id').eq('user_id', userId).maybeSingle()

  return {
    operatorId:   null,
    operatorName: callerName,
    sectionId:    (appRole?.section_id as string | null) ?? null,
  }
}

/**
 * POST — clock in, heartbeat, or clock out.
 *
 *   { action: 'in' }                      on every app-shell mount with a session
 *   { action: 'heartbeat' }               every few minutes while the tab lives
 *   { action: 'out', reason: '…' }        from signOut(), before the session dies
 *
 * `in` is FIND-OR-CREATE, not create. A reload, a second tab or a second device
 * must join the interval that is already open rather than starting a new one —
 * the shift start has to be the first login of the day and stay there. The
 * partial unique index in the migration makes that true under a race as well as
 * in the happy path; the insert here catches its violation and re-reads.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    if (action !== 'in' && action !== 'heartbeat' && action !== 'out') {
      return NextResponse.json({ error: 'action must be in, heartbeat or out' }, { status: 400 })
    }

    const admin = getAdminClient()
    const who = await resolveOperator(admin, caller.userId, caller.name, caller.department, caller.role)
    // Not an error. Most of the company is not on a production clock, and the
    // app shell calls this for everyone — answering 200/ineligible keeps that
    // silent instead of filling the console with 403s on every page load.
    if (!who) return NextResponse.json({ ok: true, eligible: false })

    // The run day comes from the SERVER's idea of now, resolved in SAST. The
    // VPS clock is UTC, so this must never read local hours — productionDayFor
    // takes the zone explicitly for exactly that reason.
    const nowIso = new Date().toISOString()
    const { date, shift } = productionDayFor(nowIso)

    const open = async () => {
      const { data } = await clock(admin)
        .select('id,opened_at,last_seen_at')
        .eq('user_id', caller.userId).eq('date', date).eq('shift', shift)
        .is('closed_at', null).maybeSingle()
      return data as { id: string; opened_at: string; last_seen_at: string } | null
    }

    if (action === 'out') {
      const reason: CloseReason = isCloseReason(body.reason) ? body.reason : 'signed_out'
      const row = await open()
      if (!row) return NextResponse.json({ ok: true, eligible: true, closed: false })
      const { error } = await clock(admin)
        .update({ closed_at: nowIso, close_reason: reason, last_seen_at: nowIso })
        .eq('id', row.id)
      if (error) throw new Error(error.message)
      return NextResponse.json({
        ok: true, eligible: true, closed: true,
        date, shift, openedAt: row.opened_at, closedAt: nowIso,
      })
    }

    const existing = await open()
    if (existing) {
      const { error } = await clock(admin)
        .update({ last_seen_at: nowIso }).eq('id', existing.id)
      if (error) throw new Error(error.message)
      return NextResponse.json({
        ok: true, eligible: true, opened: false,
        date, shift, openedAt: existing.opened_at,
      })
    }

    // A heartbeat with no open interval means the row was swept stale (or
    // signed out in another tab). Do NOT silently re-open one: that would
    // restart a shift the operator has finished. Only an explicit 'in' opens.
    if (action === 'heartbeat') {
      return NextResponse.json({ ok: true, eligible: true, opened: false, date, shift, openedAt: null })
    }

    const { data: inserted, error } = await clock(admin).insert({
      user_id:       caller.userId,
      operator_id:   who.operatorId,
      operator_name: who.operatorName,
      date, shift,
      section_id:    who.sectionId,
      opened_at:     nowIso,
      last_seen_at:  nowIso,
      device:        (body.device ?? null) ? String(body.device).slice(0, 200) : null,
    }).select('id,opened_at').maybeSingle()

    if (error) {
      // 23505 — the partial unique index fired: another tab opened the interval
      // between our read and our insert. That is the index doing its job, so
      // re-read and return the winner rather than surfacing an error to a
      // screen the operator is about to start a shift on.
      if ((error as { code?: string }).code === '23505') {
        const won = await open()
        return NextResponse.json({
          ok: true, eligible: true, opened: false,
          date, shift, openedAt: won?.opened_at ?? null,
        })
      }
      throw new Error(error.message)
    }

    return NextResponse.json({
      ok: true, eligible: true, opened: true,
      date, shift, openedAt: (inserted as { opened_at: string } | null)?.opened_at ?? nowIso,
    })
  } catch (err: unknown) {
    console.error('[api/production/shift-clock POST]', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * GET — one person's intervals for a run day, for the timesheet to derive from.
 *
 *   ?date=2026-09-11&shift=morning&operatorName=…
 *   ?date=…&shift=…&userId=…            (preferred where the caller knows it)
 *
 * Matched on `user_id` when given and on `operator_name` otherwise, because the
 * capture screen knows who signed off by NAME and does not always hold their
 * auth id. Both are indexed.
 *
 * The stale sweep runs here rather than on a timer: this is the read that cares,
 * and a tablet whose battery died must not still show as on the clock when a
 * supervisor opens the sheet. It closes such rows at their LAST HEARTBEAT.
 */
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const sp = req.nextUrl.searchParams
    const date  = (sp.get('date')  ?? '').trim()
    const shift = (sp.get('shift') ?? '').trim()
    const userId = (sp.get('userId') ?? '').trim()
    const operatorName = (sp.get('operatorName') ?? '').trim()

    if (!date || !shift) {
      return NextResponse.json({ error: 'date and shift are required' }, { status: 400 })
    }
    if (!userId && !operatorName) {
      return NextResponse.json({ error: 'userId or operatorName is required' }, { status: 400 })
    }

    const admin = getAdminClient()

    // Best-effort. A sweep that fails must not stop a supervisor reading the
    // sheet — the core's `effectiveEnd()` already measures an un-swept stale
    // row to its last heartbeat, so this is tidying, not correctness.
    try { await (admin as any).schema('production').rpc('close_stale_shift_clocks', { p_stale_minutes: 90 }) }
    catch { /* the read below is still correct without it */ }

    // 'night' is a legacy alias for the 16h00–01h00 shift and still appears on
    // older rows — accept both or an afternoon sheet finds no clock.
    const shifts = shift === 'morning' ? ['morning'] : ['afternoon', 'night']

    let q = clock(admin)
      .select('id,opened_at,closed_at,last_seen_at,close_reason,operator_name,section_id')
      .eq('date', date).in('shift', shifts)
      .order('opened_at', { ascending: true })
    q = userId ? q.eq('user_id', userId) : q.eq('operator_name', operatorName)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    return NextResponse.json({
      ok: true,
      intervals: ((data as Record<string, unknown>[] | null) ?? []).map(r => ({
        id:          String(r.id),
        openedAt:    r.opened_at as string,
        closedAt:    (r.closed_at as string | null) ?? null,
        lastSeenAt:  (r.last_seen_at as string) ?? (r.opened_at as string),
        closeReason: (r.close_reason as CloseReason | null) ?? null,
      })),
    })
  } catch (err: unknown) {
    console.error('[api/production/shift-clock GET]', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
