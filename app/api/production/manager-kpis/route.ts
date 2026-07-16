// app/api/production/manager-kpis/route.ts
// Aggregates yield, machine-parameter, and quality-integration KPIs for the
// production manager dashboard. Joins prod_sessions + prod_mass_balance for
// yield, check_records + check_events for machine parameters and compliance,
// and qms.sd_runs for PSD data.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const days = Math.min(parseInt(searchParams.get('days') || '14'), 90)

    const db = await createServerSupabaseClient()
    const today = format(new Date(), 'yyyy-MM-dd')
    const startDate = format(subDays(new Date(), days - 1), 'yyyy-MM-dd')

    // ── 1. Sessions ────────────────────────────────────────────────────────────
    const { data: sessions } = await db
      .schema('production').from('prod_sessions')
      .select('id,section_id,date,status,variant,lot_number')
      .gte('date', startDate)
      .is('deleted_at', null)   // archived orders don't count toward KPIs

    const sessIds = (sessions || []).map((s: any) => s.id)

    // ── 2. Mass balance ────────────────────────────────────────────────────────
    let mbRows: any[] = []
    for (let i = 0; i < sessIds.length; i += 200) {
      const { data } = await db.schema('production').from('prod_mass_balance')
        .select('session_id,total_input_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg')
        .in('session_id', sessIds.slice(i, i + 200))
      mbRows = mbRows.concat(data || [])
    }
    const mbMap = new Map(mbRows.map((m: any) => [m.session_id, m]))

    // ── 3. Check records ───────────────────────────────────────────────────────
    const { data: checkRecords } = await db.schema('production').from('check_records')
      .select('id,section_id,date,shift,status')
      .gte('date', startDate)

    const crIds = (checkRecords || []).map((r: any) => r.id)
    const crMap = new Map((checkRecords || []).map((r: any) => [r.id, r]))

    // ── 4. Check events ────────────────────────────────────────────────────────
    let checkEvents: any[] = []
    for (let i = 0; i < crIds.length; i += 200) {
      const { data } = await db.schema('production').from('check_events')
        .select('record_id,check_key,check_label,value_num,unit,status,recorded_at')
        .in('record_id', crIds.slice(i, i + 200))
      checkEvents = checkEvents.concat(data || [])
    }

    // ── 5. PSD runs (qms.sd_runs) ──────────────────────────────────────────────
    const { data: psdRuns } = await (db as any).schema('qms').from('sd_runs')
      .select('id,date,lot_number,variant,product,sieve_results,bulk_density,pass_status,grade')
      .gte('date', startDate)
      .order('date', { ascending: false })

    // ── Derived: yield per day ──────────────────────────────────────────────────
    const dayMap: Record<string, { date: string; inputKg: number; outputKg: number; sessions: number }> = {}
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(new Date(), i), 'yyyy-MM-dd')
      dayMap[d] = { date: d, inputKg: 0, outputKg: 0, sessions: 0 }
    }

    const outOf = (s: any) => {
      const m = mbMap.get(s.id)
      return m ? (Number(m.total_output_b_kg) || 0) + (Number(m.total_output_c_kg) || 0) + (Number(m.total_output_d_kg) || 0) : 0
    }
    const inOf = (s: any) => {
      const m = mbMap.get(s.id)
      return m ? Number(m.total_input_kg) || 0 : 0
    }

    for (const s of (sessions || [])) {
      if (!dayMap[s.date]) continue
      dayMap[s.date].inputKg += inOf(s)
      dayMap[s.date].outputKg += outOf(s)
      dayMap[s.date].sessions++
    }

    const dailyYield = Object.values(dayMap).map(d => ({
      date: d.date,
      label: format(new Date(d.date + 'T12:00:00'), 'EEE d'),
      outputKg: Math.round(d.outputKg),
      inputKg: Math.round(d.inputKg),
      sessions: d.sessions,
      yieldPct: d.inputKg > 0 ? Math.round((d.outputKg / d.inputKg) * 1000) / 10 : null,
    }))

    // ── Derived: yield per section ──────────────────────────────────────────────
    const secMap: Record<string, { sectionId: string; inputKg: number; outputKg: number; sessions: number }> = {}
    for (const s of (sessions || [])) {
      if (!secMap[s.section_id]) secMap[s.section_id] = { sectionId: s.section_id, inputKg: 0, outputKg: 0, sessions: 0 }
      secMap[s.section_id].inputKg += inOf(s)
      secMap[s.section_id].outputKg += outOf(s)
      secMap[s.section_id].sessions++
    }

    // ── Derived: machine parameters ─────────────────────────────────────────────
    const PARAM_KEYS = ['infeed_vsd', 'indent_screen_angle', 'indent_screen_speed', 'scale_verification']
    const machineParams = checkEvents
      .filter((e: any) => PARAM_KEYS.includes(e.check_key) && e.value_num != null)
      .map((e: any) => {
        const cr = crMap.get(e.record_id)
        return {
          checkKey: e.check_key,
          checkLabel: e.check_label,
          valueNum: Number(e.value_num),
          unit: e.unit || '',
          sectionId: cr?.section_id || '',
          date: cr?.date || '',
          shift: cr?.shift || '',
          recordedAt: e.recorded_at,
          status: e.status,
        }
      })
      .filter((e: any) => e.sectionId && e.date)

    // ── Derived: check compliance per section ───────────────────────────────────
    const compMap: Record<string, { total: number; ok: number; flagged: number; fail: number }> = {}
    for (const e of checkEvents) {
      const cr = crMap.get(e.record_id)
      if (!cr) continue
      if (!compMap[cr.section_id]) compMap[cr.section_id] = { total: 0, ok: 0, flagged: 0, fail: 0 }
      compMap[cr.section_id].total++
      if (e.status === 'ok') compMap[cr.section_id].ok++
      else if (e.status === 'flagged') compMap[cr.section_id].flagged++
      else if (e.status === 'fail') compMap[cr.section_id].fail++
    }

    const checkCompliance = Object.entries(compMap).map(([sectionId, c]) => ({
      sectionId,
      ...c,
      ratePct: c.total > 0 ? Math.round((c.ok / c.total) * 100) : null,
    }))

    // ── Derived: today summary ──────────────────────────────────────────────────
    const todaySess = (sessions || []).filter((s: any) => s.date === today)
    const todayIn = todaySess.reduce((t: number, s: any) => t + inOf(s), 0)
    const todayOut = todaySess.reduce((t: number, s: any) => t + outOf(s), 0)
    const totalChecks = checkEvents.length
    const okChecks = checkEvents.filter((e: any) => e.status === 'ok').length
    const activeSections = new Set(todaySess.filter((s: any) => s.status === 'draft').map((s: any) => s.section_id)).size

    return NextResponse.json({
      today: {
        date: today,
        outputKg: Math.round(todayOut),
        inputKg: Math.round(todayIn),
        yieldPct: todayIn > 0 ? Math.round((todayOut / todayIn) * 1000) / 10 : null,
        sessions: todaySess.length,
        activeSections,
        complianceRate: totalChecks > 0 ? Math.round((okChecks / totalChecks) * 100) : null,
      },
      dailyYield,
      yieldBySection: Object.values(secMap),
      machineParams,
      checkCompliance,
      psdRuns: (psdRuns || []).map((r: any) => ({
        id: r.id,
        date: r.date,
        lotNumber: r.lot_number,
        variant: r.variant,
        product: r.product,
        sieveResults: typeof r.sieve_results === 'object' ? r.sieve_results : {},
        bulkDensity: r.bulk_density,
        passStatus: r.pass_status,
        grade: r.grade,
      })),
    })
  } catch (err: any) {
    console.error('[manager-kpis]', err)
    return NextResponse.json({ error: err.message ?? 'Unknown' }, { status: 500 })
  }
}
