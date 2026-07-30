// app/api/production/shift-report/route.ts
//
// GET  — assemble the full shift report for a date + shift, live from the
//        records the floor already captured. Nothing is invented here; every
//        field traces back to a table (see lib/production/shift-report.ts).
// POST — save / submit / approve / reopen the report, writing an audit row for
//        every transition so a signed report is provable months later.
//
// Reads run through the admin client on purpose. The report crosses schemas
// (production + maintenance) and a supervisor holding can_view_shift_report has
// no direct grant on maintenance.job_cards; gating happens here on the
// permission, not on the row-level grants of five different tables.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { sectionMeta, SECTION_ORDER, massBalanceToleranceFor } from '@/lib/production/capture-config'
import { SHIFT_LABEL, shiftValuesFor } from '@/lib/production/shifts'
import { SHIFT_WINDOW, tons } from '@/lib/production/shift-report'
import type {
  ShiftReport, LineReport, OutputLine, ThroughputLine, MachineConfigLine,
  MachineSetting, Changeover, BreakdownLine, ChecksLine, CheckFailure,
  WasteLine, ReportNote, OutstandingItem, RosteredPerson, PresentPerson,
  AbsentPerson, ShiftReportAuditEntry,
} from '@/lib/production/shift-report'
import type { Shift } from '@/lib/supabase/database.types'

export const runtime = 'nodejs'

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const round1 = (n: number) => Math.round(n * 10) / 10
const nz = (n: number) => Math.round(n * 10) / 10

/**
 * The shift's real clock window as UTC instants, for filtering timestamped rows
 * (timesheets, job cards, messages). SAST is UTC+2 all year — no DST — so the
 * offset is a constant, not a lookup.
 *   morning   → 07h00–16h00 SAST → 05:00Z–14:00Z same day
 *   afternoon → 16h00–01h00 SAST → 14:00Z–23:00Z same day (01h00 next day SAST)
 */
function shiftWindowUtc(date: string, shift: string): { from: string; to: string } {
  return shift === 'morning'
    ? { from: `${date}T05:00:00.000Z`, to: `${date}T14:00:00.000Z` }
    : { from: `${date}T14:00:00.000Z`, to: `${date}T23:00:00.000Z` }
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
/** Weekday key for a yyyy-MM-dd date, matching roster_entries.days values. */
function weekdayKey(date: string): string {
  // Midday avoids any timezone rounding pushing the date to the day either side.
  return WEEKDAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()]
}

const minutesBetween = (a: string | null, b: string | null): number | null =>
  a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)) : null

// ── GET — assemble ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!caller.can('can_view_shift_report') && caller.department !== 'Production' && caller.department !== 'Management') {
      return NextResponse.json({ error: 'You do not have access to shift reports.' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date')
    const shift = (searchParams.get('shift') || 'morning') as Shift
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'A date (yyyy-MM-dd) is required.' }, { status: 400 })
    }

    const db = getAdminClient()
    const prod = () => db.schema('production' as any)
    const gaps: string[] = []
    const window = shiftWindowUtc(date, shift)
    const shiftVals = shiftValuesFor(shift)

    // ── Sessions for this date+shift (the spine of the whole report) ──────────
    const { data: sessRaw, error: sessErr } = await prod().from('prod_sessions')
      .select('id,section_id,date,shift,status,operator_names,supervisor_name,lot_number,variant,production_orders,comments,created_at,updated_at,submitted_at,draft_data')
      .eq('date', date).in('shift', shiftVals).is('deleted_at', null)
    if (sessErr) gaps.push(`Capture sessions could not be read: ${sessErr.message}`)
    const sessions = ((sessRaw as any[]) ?? [])
    const sessionIds = sessions.map(s => s.id)

    // Record numbers live behind a later migration — degrade rather than 400.
    const recordNos = new Map<string, string | null>()
    if (sessionIds.length) {
      const { data: rn } = await prod().from('prod_sessions').select('id,record_no').in('id', sessionIds)
      ;((rn as any[]) ?? []).forEach(r => recordNos.set(r.id, r.record_no ?? null))
    }

    // ── Mass balance, bagging, debagging ─────────────────────────────────────
    let mb: any[] = [], bagging: any[] = [], debagging: any[] = []
    if (sessionIds.length) {
      const [mbRes, bagRes, debagRes] = await Promise.all([
        prod().from('prod_mass_balance')
          .select('session_id,total_input_kg,total_output_a_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg,balance_kg,tolerance_kg,water_kg,dust_extraction_kg,floor_waste_kg')
          .in('session_id', sessionIds),
        prod().from('prod_bagging')
          .select('session_id,product_type,kg,bag_no,bagging_time,created_at').in('session_id', sessionIds),
        prod().from('prod_debagging')
          .select('session_id,kg_nett,is_spillage,created_at').in('session_id', sessionIds),
      ])
      mb = (mbRes.data as any[]) ?? []
      bagging = (bagRes.data as any[]) ?? []
      debagging = (debagRes.data as any[]) ?? []
      if (mbRes.error) gaps.push(`Mass balance could not be read: ${mbRes.error.message}`)
    }
    const mbBySession = new Map(mb.map(r => [r.session_id, r]))

    // ── Timesheets — who was actually on the floor, and for how long ──────────
    const { data: tsRaw, error: tsErr } = await prod().from('prod_timesheets')
      .select('operator_name,section_id,date,shift,shift_start,shift_end,breaks,worked_minutes,confirmed')
      .eq('date', date).in('shift', shiftVals)
    if (tsErr) gaps.push(`Timesheets could not be read: ${tsErr.message}`)
    const timesheets = ((tsRaw as any[]) ?? [])

    // ── Roster — who was SUPPOSED to be here ─────────────────────────────────
    // roster_entries store 'day' | 'night'; the capture flow's morning maps to
    // day and afternoon/night to night.
    const rosterShift = shift === 'morning' ? 'day' : 'night'
    let rostered: RosteredPerson[] = []
    let rosterPeriodName: string | null = null
    let rosterShiftLabel: string | null = null
    {
      const { data: periods, error: pErr } = await prod().from('roster_periods')
        .select('id,name,start_date,end_date,day_label,night_label')
        .lte('start_date', date).gte('end_date', date).order('start_date', { ascending: false }).limit(1)
      if (pErr) gaps.push(`Roster period could not be read: ${pErr.message}`)
      const period = ((periods as any[]) ?? [])[0]
      if (period) {
        rosterPeriodName = period.name
        rosterShiftLabel = rosterShift === 'day' ? period.day_label : period.night_label
        const { data: entries } = await prod().from('roster_entries')
          .select('role_key,shift,employee_id,operator_id,person_name,days')
          .eq('period_id', period.id).eq('shift', rosterShift)
        const wd = weekdayKey(date)
        rostered = ((entries as any[]) ?? [])
          // days defaults to Mon–Fri; a person only rostered some days of the
          // week is genuinely not expected on the others, so they must not show
          // up as "absent" on a day they were never down for.
          .filter(e => !Array.isArray(e.days) || e.days.length === 0 || e.days.includes(wd))
          .map(e => ({
            personName: e.person_name,
            employeeId: e.employee_id ?? null,
            operatorId: e.operator_id ?? null,
            roleKey: e.role_key,
            roleName: String(e.role_key ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          }))
      }
    }

    // ── Leave — the reason an absence is fine ────────────────────────────────
    const leaveByEmployee = new Map<string, { kind: string; reason: string | null }>()
    {
      const { data: leave } = await prod().from('employee_leave_active')
        .select('employee_id,kind,reason,start_date,end_date').lte('start_date', date).gte('end_date', date)
      ;((leave as any[]) ?? []).forEach(l => leaveByEmployee.set(l.employee_id, { kind: l.kind, reason: l.reason ?? null }))
    }

    // ── Attendance ───────────────────────────────────────────────────────────
    // "Present" is anyone with a timesheet OR named on a capture session — an
    // operator whose timesheet was never confirmed still physically ran a line,
    // and reporting them absent because of missing paperwork would be wrong.
    const presentMap = new Map<string, PresentPerson>()
    const touch = (name: string): PresentPerson => {
      const key = name.trim().toLowerCase()
      let p = presentMap.get(key)
      if (!p) {
        p = { personName: name.trim(), sectionIds: [], workedMinutes: 0, firstIn: null, lastOut: null, breakMinutes: 0, confirmed: false }
        presentMap.set(key, p)
      }
      return p
    }
    for (const t of timesheets) {
      if (!t.operator_name) continue
      const p = touch(t.operator_name)
      if (t.section_id && !p.sectionIds.includes(t.section_id)) p.sectionIds.push(t.section_id)
      p.workedMinutes += Number(t.worked_minutes) || 0
      p.confirmed = p.confirmed || !!t.confirmed
      if (t.shift_start && (!p.firstIn || t.shift_start < p.firstIn)) p.firstIn = t.shift_start
      if (t.shift_end && (!p.lastOut || t.shift_end > p.lastOut)) p.lastOut = t.shift_end
      for (const b of (Array.isArray(t.breaks) ? t.breaks : [])) {
        const m = minutesBetween(b?.start ?? null, b?.end ?? null)
        if (m) p.breakMinutes += m
      }
    }
    for (const s of sessions) {
      for (const name of (s.operator_names ?? [])) {
        if (!name) continue
        const p = touch(name)
        if (s.section_id && !p.sectionIds.includes(s.section_id)) p.sectionIds.push(s.section_id)
      }
    }

    const presentKeys = new Set(presentMap.keys())
    const rosteredKeys = new Set(rostered.map(r => r.personName.trim().toLowerCase()))
    const absent: AbsentPerson[] = rostered
      .filter(r => !presentKeys.has(r.personName.trim().toLowerCase()))
      .map(r => {
        const lv = r.employeeId ? leaveByEmployee.get(r.employeeId) : undefined
        return {
          personName: r.personName,
          roleName: r.roleName,
          reason: lv ? 'leave' as const : 'no_record' as const,
          leaveKind: lv?.kind ?? null,
          leaveNote: lv?.reason ?? null,
        }
      })
    const present = [...presentMap.values()].sort((a, b) => a.personName.localeCompare(b.personName))
    const unrostered = present.filter(p => rostered.length > 0 && !rosteredKeys.has(p.personName.trim().toLowerCase()))

    // ── Per-line detail ──────────────────────────────────────────────────────
    const bagsBySession = new Map<string, any[]>()
    bagging.forEach(b => { const a = bagsBySession.get(b.session_id) ?? []; a.push(b); bagsBySession.set(b.session_id, a) })
    const debagsBySession = new Map<string, any[]>()
    debagging.forEach(d => { const a = debagsBySession.get(d.session_id) ?? []; a.push(d); debagsBySession.set(d.session_id, a) })

    const lines: LineReport[] = sessions
      .sort((a, b) => SECTION_ORDER.indexOf(a.section_id) - SECTION_ORDER.indexOf(b.section_id))
      .map(s => {
        const meta = sectionMeta(s.section_id)
        const m = mbBySession.get(s.id)
        const inputKg = m ? num(m.total_input_kg) : 0
        // Output excludes stream A deliberately — A is the input side of the
        // refining mass balance, which is why v_session_yield sums B+C+D only.
        const outputKg = m ? num(m.total_output_b_kg) + num(m.total_output_c_kg) + num(m.total_output_d_kg) : 0
        const bags = bagsBySession.get(s.id) ?? []
        const debags = debagsBySession.get(s.id) ?? []
        const tolerance = m ? num(m.tolerance_kg) || massBalanceToleranceFor(s.section_id) : massBalanceToleranceFor(s.section_id)
        const balance = m && m.balance_kg !== null ? num(m.balance_kg) : null
        const stamps = bags.map(b => b.created_at).filter(Boolean).sort()
        return {
          sessionId: s.id,
          sectionId: s.section_id,
          sectionName: meta.name,
          sectionCode: meta.code,
          colorHex: meta.colorHex,
          recordNo: recordNos.get(s.id) ?? null,
          status: s.status,
          variant: s.variant ?? null,
          lotNumber: s.lot_number ?? null,
          productionOrders: s.production_orders ?? [],
          operatorNames: s.operator_names ?? [],
          inputKg: nz(inputKg),
          outputKg: nz(outputKg),
          balanceKg: balance === null ? null : nz(balance),
          toleranceKg: tolerance,
          withinTolerance: balance === null ? null : Math.abs(balance) <= tolerance,
          yieldPct: inputKg > 0 ? round1((outputKg / inputKg) * 100) : null,
          bagsOut: bags.length,
          bagsIn: debags.filter(d => !d.is_spillage).length,
          spillageKg: nz(debags.filter(d => d.is_spillage).reduce((t, d) => t + num(d.kg_nett), 0)),
          handoverNote: (s.comments && String(s.comments).trim()) || null,
          firstCaptureAt: stamps[0] ?? null,
          lastCaptureAt: stamps[stamps.length - 1] ?? null,
          submittedAt: s.submitted_at ?? null,
          runMinutes: stamps.length > 1 ? minutesBetween(stamps[0], stamps[stamps.length - 1]) : null,
        } as LineReport
      })

    // ── Output mix — how much of each product, and from which lines ───────────
    const mixMap = new Map<string, OutputLine>()
    let mixTotal = 0
    const sectionOfSession = new Map(sessions.map(s => [s.id, s.section_id]))
    for (const b of bagging) {
      const key = b.product_type || 'Unspecified'
      let row = mixMap.get(key)
      if (!row) { row = { productType: key, kg: 0, bags: 0, sharePct: null, sections: [] }; mixMap.set(key, row) }
      row.kg += num(b.kg)
      row.bags += 1
      const sec = sectionOfSession.get(b.session_id)
      if (sec && !row.sections.includes(sec)) row.sections.push(sec)
      mixTotal += num(b.kg)
    }
    const outputs: OutputLine[] = [...mixMap.values()]
      .map(r => ({ ...r, kg: nz(r.kg), sharePct: mixTotal > 0 ? round1((r.kg / mixTotal) * 100) : null }))
      .sort((a, b) => b.kg - a.kg)

    // ── Throughput per line ──────────────────────────────────────────────────
    const workedBySection = new Map<string, number>()
    timesheets.forEach(t => {
      if (!t.section_id) return
      workedBySection.set(t.section_id, (workedBySection.get(t.section_id) ?? 0) + (Number(t.worked_minutes) || 0))
    })
    const throughput: ThroughputLine[] = lines.map(l => {
      const worked = workedBySection.get(l.sectionId) ?? 0
      const basis: 'run' | 'worked' | null = l.runMinutes && l.runMinutes >= 15 ? 'run' : worked > 0 ? 'worked' : null
      const mins = basis === 'run' ? (l.runMinutes as number) : basis === 'worked' ? worked : 0
      return {
        sectionId: l.sectionId,
        sectionName: l.sectionName,
        outputKg: l.outputKg,
        inputKg: l.inputKg,
        runMinutes: l.runMinutes,
        workedMinutes: worked,
        kgPerHour: mins > 0 ? round1(l.outputKg / (mins / 60)) : null,
        basis,
      }
    })

    // ── Checks engine — machine settings, sieving config, failures ────────────
    const machineConfig: MachineConfigLine[] = []
    const checks: ChecksLine[] = []
    const changeovers: Changeover[] = []
    {
      const { data: recRaw, error: recErr } = await prod().from('check_records')
        .select('id,section_id,date,shift,status,operator_name,supervisor_name,ai_summary')
        .eq('date', date).in('shift', shiftVals)
      if (recErr) gaps.push(`Checks could not be read: ${recErr.message}`)
      const records = ((recRaw as any[]) ?? [])
      let events: any[] = []
      if (records.length) {
        const { data: evRaw } = await prod().from('check_events')
          .select('record_id,check_key,check_label,kind,value_num,value_text,unit,status,reason,production_idx,recorded_at,actor_name')
          .in('record_id', records.map(r => r.id)).order('recorded_at', { ascending: true })
        events = (evRaw as any[]) ?? []
      }
      const byRecord = new Map<string, any[]>()
      events.forEach(e => { const a = byRecord.get(e.record_id) ?? []; a.push(e); byRecord.set(e.record_id, a) })

      for (const rec of records.sort((a, b) => SECTION_ORDER.indexOf(a.section_id) - SECTION_ORDER.indexOf(b.section_id))) {
        const meta = sectionMeta(rec.section_id)
        const evs = byRecord.get(rec.id) ?? []
        const latest = (key: string) => [...evs].reverse().find(e => e.check_key === key) ?? null
        const valueOf = (e: any): string =>
          e == null ? '—'
            : e.value_text != null && String(e.value_text).trim() !== '' ? String(e.value_text)
            : e.value_num != null ? String(e.value_num)
            : e.kind === 'confirm' ? (e.status === 'ok' ? 'Confirmed' : e.status === 'na' ? 'N/A' : 'Not confirmed')
            : '—'

        // Machine settings — the values a supervisor is asked about the next day.
        const settingKeys: { key: string; label: string }[] = [
          { key: 'indent_screen_speed', label: 'Indent screen speed' },
          { key: 'indent_screen_angle', label: 'Indent screen angle' },
          { key: 'scale_verification', label: 'Scale verification' },
          { key: 'scale_zero_check', label: 'Scale zero check' },
          { key: 'dust_extraction', label: 'Dust extraction' },
          { key: 'post_sieve_plate_size', label: 'Post-sieve plate size' },
          { key: 'steriliser_inverter', label: 'Steriliser inverter' },
          { key: 'debagging_hopper_inverter', label: 'Debagging hopper inverter' },
          { key: 'product_temp', label: 'Product temperature' },
          { key: 'prestart_done', label: 'Pre-start checks' },
        ]
        const settings: MachineSetting[] = settingKeys.map(sk => {
          const e = latest(sk.key)
          if (!e) return null
          return {
            label: e.check_label || sk.label,
            value: valueOf(e),
            unit: e.unit ?? null,
            status: (e.status as MachineSetting['status']) ?? 'ok',
            at: e.recorded_at ?? null,
          }
        }).filter(Boolean) as MachineSetting[]

        const vsd = evs.filter(e => e.check_key === 'infeed_vsd' && e.value_num != null).map(e => num(e.value_num))
        machineConfig.push({
          sectionId: rec.section_id,
          sectionName: meta.name,
          sievingConfig: valueOf(latest('sieving_config')) === '—' ? null : valueOf(latest('sieving_config')),
          settings,
          vsdHz: {
            avg: vsd.length ? round1(vsd.reduce((a, b) => a + b, 0) / vsd.length) : null,
            min: vsd.length ? Math.min(...vsd) : null,
            max: vsd.length ? Math.max(...vsd) : null,
            readings: vsd.length,
          },
        })

        const failures: CheckFailure[] = evs
          .filter(e => e.status === 'flagged' || e.status === 'fail')
          .map(e => ({
            label: e.check_label || e.check_key,
            value: valueOf(e) === '—' ? null : valueOf(e),
            unit: e.unit ?? null,
            status: e.status as 'flagged' | 'fail',
            reason: e.reason ?? null,
            at: e.recorded_at,
            actorName: e.actor_name ?? null,
          }))
        checks.push({
          sectionId: rec.section_id,
          sectionName: meta.name,
          status: rec.status ?? null,
          operatorName: rec.operator_name ?? null,
          supervisorName: rec.supervisor_name ?? null,
          total: evs.length,
          ok: evs.filter(e => e.status === 'ok').length,
          flagged: evs.filter(e => e.status === 'flagged').length,
          failed: evs.filter(e => e.status === 'fail').length,
          na: evs.filter(e => e.status === 'na').length,
          aiSummary: rec.ai_summary ?? null,
          failures,
        })

        // A new production_idx appearing mid-shift is a grade / material /
        // variant change-over — the checks engine snapshots per production.
        const seen = new Set<number>()
        for (const e of evs) {
          const idx = e.production_idx
          if (idx == null || idx === 0 || seen.has(idx)) continue
          seen.add(idx)
          changeovers.push({
            sectionId: rec.section_id,
            sectionName: meta.name,
            at: e.recorded_at,
            personName: e.actor_name ?? null,
            source: 'checks',
            detail: `Change-over to production ${idx + 1}`,
          })
        }
      }
    }

    // Changeovers an operator logged on their own timesheet.
    for (const t of timesheets) {
      for (const b of (Array.isArray(t.breaks) ? t.breaks : [])) {
        if (b?.type !== 'changeover' || !b?.start) continue
        changeovers.push({
          sectionId: t.section_id ?? '',
          sectionName: t.section_id ? sectionMeta(t.section_id).name : 'Unassigned',
          at: b.start,
          personName: t.operator_name ?? null,
          source: 'timesheet',
          detail: b.end ? `Off the line for ${minutesBetween(b.start, b.end)} min` : 'Section change-over logged',
        })
      }
    }
    changeovers.sort((a, b) => a.at.localeCompare(b.at))

    // ── Breakdowns & planned maintenance touching this shift ──────────────────
    const breakdowns: BreakdownLine[] = []
    {
      const { data: cardsRaw, error: cardErr } = await db.schema('maintenance' as any).from('job_cards')
        .select('id,card_no,area,machine,description,workflow,status,raised_by,raised_at,assigned_to,started_at,completed_at,root_cause,work_done')
        .gte('raised_at', window.from).lt('raised_at', window.to)
        .order('raised_at', { ascending: true })
      if (cardErr) gaps.push(`Maintenance job cards could not be read: ${cardErr.message}`)
      for (const c of ((cardsRaw as any[]) ?? [])) {
        const open = !['complete', 'cancelled'].includes(c.status)
        // An open card's downtime is measured only to the end of this shift —
        // otherwise a card left open for a week reports a week of downtime
        // against a single shift.
        const end = c.completed_at ?? (open ? window.to : null)
        breakdowns.push({
          cardId: c.id,
          cardNo: c.card_no,
          area: c.area,
          machine: c.machine ?? null,
          description: c.description,
          workflow: c.workflow,
          status: c.status,
          raisedBy: c.raised_by ?? null,
          raisedAt: c.raised_at,
          assignedTo: c.assigned_to ?? null,
          startedAt: c.started_at ?? null,
          completedAt: c.completed_at ?? null,
          downtimeMinutes: minutesBetween(c.raised_at, end),
          stillOpen: open,
          rootCause: (c.root_cause && String(c.root_cause).trim()) || null,
          workDone: (c.work_done && String(c.work_done).trim()) || null,
        })
      }
    }

    // ── Waste streams ────────────────────────────────────────────────────────
    const waste: WasteLine[] = lines.map(l => {
      const m = mbBySession.get(l.sessionId)
      return {
        sectionId: l.sectionId,
        sectionName: l.sectionName,
        spillageKg: l.spillageKg,
        dustExtractionKg: m ? nz(num(m.dust_extraction_kg)) : 0,
        floorWasteKg: m ? nz(num(m.floor_waste_kg)) : 0,
        waterKg: m ? nz(num(m.water_kg)) : 0,
      }
    }).filter(w => w.spillageKg || w.dustExtractionKg || w.floorWasteKg || w.waterKg)

    // ── Notes: handover comments + line messages posted during the shift ──────
    const notes: ReportNote[] = []
    for (const l of lines) {
      if (!l.handoverNote) continue
      notes.push({
        kind: 'handover', sectionId: l.sectionId, sectionName: l.sectionName,
        author: l.operatorNames.join(', ') || 'Operator', body: l.handoverNote,
        at: l.submittedAt ?? `${date}T12:00:00.000Z`,
      })
    }
    {
      const { data: msgs } = await prod().from('line_messages')
        .select('section_id,author_name,body,created_at')
        .gte('created_at', window.from).lt('created_at', window.to)
        .is('deleted_at', null).order('created_at', { ascending: true })
      for (const m of ((msgs as any[]) ?? [])) {
        notes.push({
          kind: 'message',
          sectionId: m.section_id ?? null,
          sectionName: m.section_id ? sectionMeta(m.section_id).name : 'All lines',
          author: m.author_name, body: m.body, at: m.created_at,
        })
      }
    }

    // ── Outstanding — what still needs someone's signature ───────────────────
    const outstanding: OutstandingItem[] = lines
      .filter(l => l.status !== 'approved')
      .map(l => ({
        sessionId: l.sessionId, sectionId: l.sectionId, sectionName: l.sectionName, status: l.status,
        reason: l.status === 'submitted' ? 'Submitted — waiting for a supervisor signature'
          : 'Still in progress — not submitted for sign-off',
      }))

    // ── Headline ─────────────────────────────────────────────────────────────
    const totalInputKg = lines.reduce((t, l) => t + l.inputKg, 0)
    const totalOutputKg = lines.reduce((t, l) => t + l.outputKg, 0)
    const headline = {
      linesRun: lines.length,
      totalInputKg: nz(totalInputKg),
      totalOutputKg: nz(totalOutputKg),
      tonsOut: tons(totalOutputKg),
      yieldPct: totalInputKg > 0 ? round1((totalOutputKg / totalInputKg) * 100) : null,
      sessionsSignedOff: lines.filter(l => l.status === 'approved').length,
      sessionsOutstanding: outstanding.length,
      balanceFlags: lines.filter(l => l.withinTolerance === false).length,
      breakdowns: breakdowns.filter(b => b.workflow === 'breakdown').length,
      downtimeMinutes: breakdowns.filter(b => b.workflow === 'breakdown')
        .reduce((t, b) => t + (b.downtimeMinutes ?? 0), 0),
      peopleRostered: rostered.length,
      peoplePresent: present.length,
      peopleAbsent: absent.length,
      checksFailed: checks.reduce((t, c) => t + c.failed, 0),
    }

    // ── Stored record + audit trail ──────────────────────────────────────────
    let record: ShiftReport['record'] = {
      id: null, status: 'draft', supervisorNotes: null,
      generatedAt: null, generatedByName: null,
      submittedAt: null, submittedByName: null,
      approvedAt: null, approvedByName: null, trail: [],
    }
    {
      const { data: rep } = await prod().from('shift_reports')
        .select('id,status,supervisor_notes,generated_at,generated_by_name,submitted_at,submitted_by_name,approved_at,approved_by_name')
        .eq('date', date).eq('shift', shift === 'night' ? 'afternoon' : shift).maybeSingle()
      if (rep) {
        const r = rep as any
        let trail: ShiftReportAuditEntry[] = []
        const { data: audit } = await prod().from('shift_report_audit')
          .select('action,from_status,to_status,actor_name,note,created_at')
          .eq('report_id', r.id).order('created_at', { ascending: false }).limit(50)
        trail = ((audit as any[]) ?? []).map(a => ({
          action: a.action, fromStatus: a.from_status ?? null, toStatus: a.to_status ?? null,
          actorName: a.actor_name ?? null, note: a.note ?? null, at: a.created_at,
        }))
        record = {
          id: r.id, status: r.status, supervisorNotes: r.supervisor_notes ?? null,
          generatedAt: r.generated_at ?? null, generatedByName: r.generated_by_name ?? null,
          submittedAt: r.submitted_at ?? null, submittedByName: r.submitted_by_name ?? null,
          approvedAt: r.approved_at ?? null, approvedByName: r.approved_by_name ?? null,
          trail,
        }
      }
    }

    const supervisorNames = [...new Set(sessions.map(s => s.supervisor_name).filter(Boolean))] as string[]

    const report: ShiftReport = {
      meta: {
        date, shift,
        shiftLabel: SHIFT_LABEL[shift] ?? shift,
        shiftWindow: SHIFT_WINDOW[shift] ?? '',
        generatedAt: new Date().toISOString(),
        rosterPeriodName, rosterShiftLabel, supervisorNames,
      },
      headline,
      attendance: {
        rostered, present, absent, unrostered,
        totalWorkedMinutes: present.reduce((t, p) => t + p.workedMinutes, 0),
      },
      lines, outputs, throughput, machineConfig, changeovers, breakdowns,
      checks, waste, notes, outstanding, record, gaps,
    }

    return NextResponse.json(report)
  } catch (err: any) {
    console.error('[shift-report GET]', err)
    return NextResponse.json({ error: err?.message ?? 'Could not build the shift report' }, { status: 500 })
  }
}

// ── POST — save / submit / approve / reopen ───────────────────────────────────
type Action = 'save' | 'submit' | 'approve' | 'reopen'

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const action = (body.action ?? 'save') as Action
    const date = body.date as string
    // 'night' is a legacy alias of 'afternoon' — one report per real shift.
    const shift = (body.shift === 'night' ? 'afternoon' : body.shift) as string
    const payload = body.payload ?? null
    const notes = typeof body.supervisorNotes === 'string' ? body.supervisorNotes : undefined

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !['morning', 'afternoon'].includes(shift)) {
      return NextResponse.json({ error: 'A valid date and shift are required.' }, { status: 400 })
    }

    const perm: Record<Action, string> = {
      save: 'can_edit_shift_report',
      submit: 'can_submit_shift_report',
      approve: 'can_approve_shift_report',
      reopen: 'can_approve_shift_report',
    }
    if (!caller.can(perm[action] as any)) {
      return NextResponse.json({ error: `You do not have permission to ${action} a shift report.` }, { status: 403 })
    }

    const db = getAdminClient()
    const prod = () => db.schema('production' as any)
    const now = new Date().toISOString()
    const actor = caller.name ?? null

    const { data: existing } = await prod().from('shift_reports')
      .select('id,status').eq('date', date).eq('shift', shift).maybeSingle()
    const fromStatus = (existing as any)?.status ?? null

    // Submitting or approving a stale draft would sign off numbers nobody looked
    // at — the client always posts the payload it rendered, and that is what
    // gets frozen.
    if ((action === 'submit' || action === 'approve') && !payload && !existing) {
      return NextResponse.json({ error: 'Generate the report before signing it off.' }, { status: 400 })
    }

    const row: Record<string, any> = { date, shift, updated_at: now }
    if (payload) row.payload = payload
    if (notes !== undefined) row.supervisor_notes = notes
    if (!existing) {
      row.generated_at = now
      row.generated_by = caller.userId
      row.generated_by_name = actor
    }

    if (action === 'save') {
      row.status = fromStatus === 'approved' ? 'approved' : 'draft'
    } else if (action === 'submit') {
      row.status = 'submitted'
      row.submitted_at = now; row.submitted_by = caller.userId; row.submitted_by_name = actor
      row.approved_at = null; row.approved_by = null; row.approved_by_name = null
    } else if (action === 'approve') {
      row.status = 'approved'
      row.approved_at = now; row.approved_by = caller.userId; row.approved_by_name = actor
    } else {
      row.status = 'draft'
      row.submitted_at = null; row.submitted_by = null; row.submitted_by_name = null
      row.approved_at = null; row.approved_by = null; row.approved_by_name = null
    }

    const { data: saved, error } = await prod().from('shift_reports')
      .upsert(row, { onConflict: 'date,shift' })
      .select('id,status,supervisor_notes,generated_at,generated_by_name,submitted_at,submitted_by_name,approved_at,approved_by_name')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const auditAction = action === 'save' ? (existing ? 'saved' : 'generated') : action === 'reopen' ? 'reopened' : action === 'submit' ? 'submitted' : 'approved'
    await prod().from('shift_report_audit').insert({
      report_id: (saved as any).id,
      action: auditAction,
      from_status: fromStatus,
      to_status: (saved as any).status,
      actor_id: caller.userId,
      actor_name: actor,
      note: typeof body.auditNote === 'string' ? body.auditNote : null,
      // Only the provable transitions carry a full snapshot — a save every few
      // seconds would otherwise duplicate the whole report into the audit table.
      payload: (action === 'submit' || action === 'approve') ? payload : null,
    })

    const r = saved as any
    return NextResponse.json({
      id: r.id, status: r.status, supervisorNotes: r.supervisor_notes ?? null,
      generatedAt: r.generated_at ?? null, generatedByName: r.generated_by_name ?? null,
      submittedAt: r.submitted_at ?? null, submittedByName: r.submitted_by_name ?? null,
      approvedAt: r.approved_at ?? null, approvedByName: r.approved_by_name ?? null,
    })
  } catch (err: any) {
    console.error('[shift-report POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Could not save the shift report' }, { status: 500 })
  }
}
