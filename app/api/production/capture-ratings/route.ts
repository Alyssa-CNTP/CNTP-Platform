// app/api/production/capture-ratings/route.ts
//
// The weekly capture scoreboard: a supervisor scores each rostered person on
// PERFORMANCE (did they run the line well) and ACCURACY (was the data they
// captured right), and the week's board shows who captured best.
//
// Two scores, not one, because they fail independently — a fast operator who
// mis-keys weights and a careful operator on a slow line are different problems
// and averaging them hides both.
//
// Alongside the human score the system computes its OWN accuracy read for the
// same person/shift from what actually landed in the database (mass-balance
// variances, records never submitted, failed checks). It never overrides the
// supervisor; it sits next to their score so "you gave them 5, the data says
// 70%" is a visible conversation rather than an argument about memory.
//
// GET  ?date=&shift=          → who to rate for that shift + their existing score
//      ?weekStart=            → the week's leaderboard
// POST                        → upsert one person's score (audited)

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { shiftValuesFor } from '@/lib/production/shifts'
import { massBalanceToleranceKg } from '@/lib/production/capture-config'

export const runtime = 'nodejs'

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}
const key = (name: string) => name.trim().toLowerCase()

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
const weekdayKey = (date: string) => WEEKDAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()]

/** Monday-start ISO week for a date, matching date_trunc('week') in the view. */
function isoWeekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  const dow = d.getUTCDay()               // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1    // Monday-based
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

export interface SystemSignals {
  sessions: number
  balanceFlags: number
  notSubmitted: number
  checksFailed: number
  sectionIds: string[]
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!caller.can('can_view_capture_ratings') && caller.department !== 'Production' && caller.department !== 'Management') {
      return NextResponse.json({ error: 'You do not have access to capture ratings.' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date')
    const shiftParam = searchParams.get('shift') === 'night' ? 'afternoon' : (searchParams.get('shift') || 'morning')
    const weekStart = searchParams.get('weekStart') || (date ? isoWeekStart(date) : null)
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'A date (yyyy-MM-dd) is required.' }, { status: 400 })
    }

    const db = getAdminClient()
    const prod = () => db.schema('production' as any)
    const shiftVals = shiftValuesFor(shiftParam as any)
    const rosterShift = shiftParam === 'morning' ? 'day' : 'night'

    // ── Who is on the board for this shift ──────────────────────────────────
    // The roster is the intended list; anyone who actually captured is added on
    // top, so a stand-in nobody wrote down is still rateable.
    type Person = { personName: string; employeeId: string | null; operatorId: string | null; roleKey: string | null; sectionId: string | null }
    const people = new Map<string, Person>()

    const { data: periods } = await prod().from('roster_periods')
      .select('id').lte('start_date', date).gte('end_date', date)
      .order('start_date', { ascending: false }).limit(1)
    const periodId = ((periods as any[]) ?? [])[0]?.id
    if (periodId) {
      const { data: entries } = await prod().from('roster_entries')
        .select('role_key,employee_id,operator_id,person_name,days')
        .eq('period_id', periodId).eq('shift', rosterShift)
      const wd = weekdayKey(date)
      for (const e of ((entries as any[]) ?? [])) {
        if (Array.isArray(e.days) && e.days.length > 0 && !e.days.includes(wd)) continue
        if (!e.person_name) continue
        people.set(key(e.person_name), {
          personName: e.person_name, employeeId: e.employee_id ?? null,
          operatorId: e.operator_id ?? null, roleKey: e.role_key ?? null, sectionId: null,
        })
      }
    }

    // ── Sessions on this shift — the source of the system accuracy read ──────
    const { data: sessRaw } = await prod().from('prod_sessions')
      .select('id,section_id,shift,status,operator_names,submitted_at')
      .eq('date', date).in('shift', shiftVals).is('deleted_at', null)
    const sessions = ((sessRaw as any[]) ?? [])
    const sessionIds = sessions.map(s => s.id)

    let mb: any[] = []
    if (sessionIds.length) {
      const { data } = await prod().from('prod_mass_balance')
        .select('session_id,total_input_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg,balance_kg,tolerance_kg')
        .in('session_id', sessionIds)
      mb = (data as any[]) ?? []
    }
    const mbBySession = new Map(mb.map(r => [r.session_id, r]))

    // Failed checks per section for this shift.
    const failedBySection = new Map<string, number>()
    {
      const { data: recs } = await prod().from('check_records')
        .select('id,section_id').eq('date', date).in('shift', shiftVals)
      const records = ((recs as any[]) ?? [])
      if (records.length) {
        const { data: evs } = await prod().from('check_events')
          .select('record_id,status').in('record_id', records.map(r => r.id)).eq('status', 'fail')
        const sectionOf = new Map(records.map(r => [r.id, r.section_id]))
        for (const e of ((evs as any[]) ?? [])) {
          const sec = sectionOf.get(e.record_id)
          if (sec) failedBySection.set(sec, (failedBySection.get(sec) ?? 0) + 1)
        }
      }
    }

    // Everyone named on a session is rateable, rostered or not.
    for (const s of sessions) {
      for (const n of (s.operator_names ?? [])) {
        if (!n) continue
        const k = key(n)
        const existing = people.get(k)
        if (existing) { if (!existing.sectionId) existing.sectionId = s.section_id }
        else people.set(k, { personName: n, employeeId: null, operatorId: null, roleKey: null, sectionId: s.section_id })
      }
    }

    // ── The system's accuracy read, per person ──────────────────────────────
    // Per session: start at 100 and deduct for things that are objectively wrong
    // in the record. Averaged across the sessions that person was on. Kept
    // deliberately simple and legible — a score nobody can explain is a score
    // nobody trusts, so the raw signals are returned alongside it.
    function systemFor(personName: string): { pct: number | null; signals: SystemSignals } {
      const mine = sessions.filter(s => (s.operator_names ?? []).some((n: string) => key(n) === key(personName)))
      const signals: SystemSignals = { sessions: mine.length, balanceFlags: 0, notSubmitted: 0, checksFailed: 0, sectionIds: [] }
      if (!mine.length) return { pct: null, signals }
      let total = 0
      for (const s of mine) {
        if (!signals.sectionIds.includes(s.section_id)) signals.sectionIds.push(s.section_id)
        let score = 100
        const m = mbBySession.get(s.id)
        // +/-1% of Total Input, computed live rather than read from the
        // persisted tolerance_kg. Rows written before the change carry a flat
        // 15 kg (100 for refining2), so preferring the stored value would leave
        // two tolerance regimes side by side on the same screen -- an operator
        // could not tell why two similar sessions flagged differently.
        const tol = massBalanceToleranceKg(m ? num(m.total_input_kg) : 0)
        if (m && m.balance_kg !== null && Math.abs(num(m.balance_kg)) > tol) { score -= 25; signals.balanceFlags++ }
        if (s.status === 'draft') { score -= 15; signals.notSubmitted++ }
        const failed = failedBySection.get(s.section_id) ?? 0
        if (failed > 0) { score -= Math.min(20, failed * 10); signals.checksFailed += failed }
        total += Math.max(0, score)
      }
      return { pct: Math.round(total / mine.length), signals }
    }

    // ── Existing ratings for this shift ─────────────────────────────────────
    let ratings: any[] = []
    let scoreboard: any[] = []
    let tableMissing = false
    try {
      const { data, error } = await prod().from('capture_ratings')
        .select('id,person_name,employee_id,section_id,role_key,performance,accuracy,note,system_accuracy_pct,rated_by_name,updated_at')
        .eq('date', date).eq('shift', shiftParam)
      if (error) throw error
      ratings = (data as any[]) ?? []
    } catch {
      // The table lands with migration 20260730_001 — report the gap rather than
      // pretending nobody has been rated.
      tableMissing = true
    }
    const ratingByPerson = new Map(ratings.map(r => [key(r.person_name), r]))

    if (weekStart && !tableMissing) {
      try {
        const { data } = await prod().from('v_capture_scoreboard')
          .select('week_start,person_name,employee_id,shifts_rated,avg_performance,avg_accuracy,score_pct,avg_system_accuracy_pct,sections')
          .eq('week_start', weekStart).order('score_pct', { ascending: false })
        scoreboard = ((data as any[]) ?? []).map(r => ({
          personName: r.person_name,
          employeeId: r.employee_id ?? null,
          shiftsRated: Number(r.shifts_rated) || 0,
          avgPerformance: r.avg_performance != null ? Number(r.avg_performance) : null,
          avgAccuracy: r.avg_accuracy != null ? Number(r.avg_accuracy) : null,
          scorePct: r.score_pct != null ? Number(r.score_pct) : null,
          avgSystemAccuracyPct: r.avg_system_accuracy_pct != null ? Number(r.avg_system_accuracy_pct) : null,
          sections: r.sections ?? [],
        }))
      } catch { /* view not created yet */ }
    }

    const roster = [...people.values()]
      .sort((a, b) => a.personName.localeCompare(b.personName))
      .map(p => {
        const sys = systemFor(p.personName)
        const existing = ratingByPerson.get(key(p.personName))
        return {
          personName: p.personName,
          employeeId: p.employeeId,
          operatorId: p.operatorId,
          roleKey: p.roleKey,
          sectionId: p.sectionId ?? sys.signals.sectionIds[0] ?? null,
          captured: sys.signals.sessions > 0,
          systemAccuracyPct: sys.pct,
          systemSignals: sys.signals,
          rating: existing ? {
            id: existing.id,
            performance: existing.performance,
            accuracy: existing.accuracy,
            note: existing.note ?? null,
            ratedByName: existing.rated_by_name ?? null,
            updatedAt: existing.updated_at ?? null,
          } : null,
        }
      })

    return NextResponse.json({
      date, shift: shiftParam, weekStart,
      canRate: caller.can('can_rate_capture'),
      roster, scoreboard,
      gaps: tableMissing ? ['Capture ratings are not available yet — migration 20260730_001 has not been applied to this database.'] : [],
    })
  } catch (err: any) {
    console.error('[capture-ratings GET]', err)
    return NextResponse.json({ error: err?.message ?? 'Could not load capture ratings' }, { status: 500 })
  }
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!caller.can('can_rate_capture')) {
      return NextResponse.json({ error: 'You do not have permission to rate capture.' }, { status: 403 })
    }

    const b = await req.json().catch(() => ({}))
    const date = b.date as string
    const shift = b.shift === 'night' ? 'afternoon' : b.shift as string
    const personName = typeof b.personName === 'string' ? b.personName.trim() : ''
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !['morning', 'afternoon'].includes(shift) || !personName) {
      return NextResponse.json({ error: 'A date, shift and person are required.' }, { status: 400 })
    }

    const clamp = (v: unknown): number | null => {
      if (v === null || v === undefined || v === '') return null
      const n = Math.round(Number(v))
      return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null
    }
    const performance = clamp(b.performance)
    const accuracy = clamp(b.accuracy)
    if (performance === null && accuracy === null) {
      return NextResponse.json({ error: 'Give at least one score (1–5).' }, { status: 400 })
    }

    const db = getAdminClient()
    const prod = () => db.schema('production' as any)

    const row = {
      date, shift, person_name: personName,
      employee_id: b.employeeId ?? null,
      operator_id: b.operatorId ?? null,
      role_key: b.roleKey ?? null,
      section_id: b.sectionId ?? null,
      performance, accuracy,
      note: typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null,
      // Snapshot the machine's read at rating time so the board keeps showing
      // both numbers even after the underlying records are corrected.
      system_accuracy_pct: b.systemAccuracyPct ?? null,
      system_signals: b.systemSignals ?? {},
      rated_by: caller.userId,
      rated_by_name: caller.name ?? null,
      updated_at: new Date().toISOString(),
    }

    const { data: saved, error } = await prod().from('capture_ratings')
      .upsert(row, { onConflict: 'date,shift,person_name' })
      .select('id,person_name,performance,accuracy,note,system_accuracy_pct,rated_by_name,updated_at')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Append-only history, so a revised score is visible rather than replacing
    // the original silently.
    await prod().from('capture_rating_audit').insert({
      rating_id: (saved as any).id, date, shift, person_name: personName,
      performance, accuracy, note: row.note,
      actor_id: caller.userId, actor_name: caller.name ?? null,
    })

    const s = saved as any
    return NextResponse.json({
      id: s.id, personName: s.person_name,
      performance: s.performance, accuracy: s.accuracy, note: s.note ?? null,
      ratedByName: s.rated_by_name ?? null, updatedAt: s.updated_at ?? null,
    })
  } catch (err: any) {
    console.error('[capture-ratings POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Could not save the rating' }, { status: 500 })
  }
}
