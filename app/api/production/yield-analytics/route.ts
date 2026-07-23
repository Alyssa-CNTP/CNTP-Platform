// app/api/production/yield-analytics/route.ts
// Batch-spine-driven yield analytics. Reads the reporting views created in
// 20260721_003_yield_views.sql (v_session_yield, v_output_stream,
// v_machine_params, v_batch_360) and returns report-ready JSON for the
// interactive report at /production/analytics.
//
// Aggregate maths is done here (not in SQL) because quality values arrive as
// text (types in qms.* aren't guaranteed) — see the view migration.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'

export const runtime = 'nodejs'

// Safe number coercion for text-typed quality values.
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}
const round1 = (n: number) => Math.round(n * 10) / 10

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const days = Math.min(parseInt(searchParams.get('days') || '30'), 180)
    const section = searchParams.get('section') || null // section_id filter
    const variant = searchParams.get('variant') || null
    const batchKey = searchParams.get('batch') || null

    const db = await createServerSupabaseClient()
    const startDate = format(subDays(new Date(), days - 1), 'yyyy-MM-dd')

    // ── Sessions (yield spine) ────────────────────────────────────────────────
    let sq = db.schema('production').from('v_session_yield')
      .select('session_id,section_id,date,shift,status,variant,lot_number,batch_id,batch_key,input_kg,output_kg,balance_kg,tolerance_kg,yield_pct,within_tol')
      .gte('date', startDate)
    if (section) sq = sq.eq('section_id', section)
    if (variant) sq = sq.eq('variant', variant)
    if (batchKey) sq = sq.eq('batch_key', batchKey)
    const { data: sessions, error: sErr } = await sq
    if (sErr) throw sErr
    const sess = (sessions || []) as any[]

    // ── Output streams (product mix + share) ──────────────────────────────────
    let oq = db.schema('production').from('v_output_stream')
      .select('session_id,section_id,date,variant,batch_key,product_type,kg,bag_count,session_output_kg,output_share_pct')
      .gte('date', startDate)
    if (section) oq = oq.eq('section_id', section)
    if (variant) oq = oq.eq('variant', variant)
    if (batchKey) oq = oq.eq('batch_key', batchKey)
    const { data: streamsRaw } = await oq
    const streams = (streamsRaw || []) as any[]

    // ── Machine params (per checks record; joins to a session) ─────────────────
    let mq = db.schema('production').from('v_machine_params')
      .select('check_record_id,session_id,section_id,date,shift,indent_screen_speed_rpm,indent_screen_angle_deg,infeed_vsd_hz_avg,infeed_vsd_hz_min,infeed_vsd_hz_max,sieving_config,scale_verification_kg')
      .gte('date', startDate)
    if (section) mq = mq.eq('section_id', section)
    const { data: machineRaw } = await mq
    const machine = (machineRaw || []) as any[]

    // ── KPIs ────────────────────────────────────────────────────────────────
    let totalIn = 0, totalOut = 0, withinTol = 0, tolCount = 0
    for (const s of sess) {
      totalIn += num(s.input_kg) || 0
      totalOut += num(s.output_kg) || 0
      if (s.within_tol !== null) { tolCount++; if (s.within_tol) withinTol++ }
    }
    const batchKeys = new Set(sess.map(s => s.batch_key).filter(Boolean))

    // ── Daily yield trend ─────────────────────────────────────────────────────
    const dayMap: Record<string, { date: string; inputKg: number; outputKg: number; sessions: number }> = {}
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(new Date(), i), 'yyyy-MM-dd')
      dayMap[d] = { date: d, inputKg: 0, outputKg: 0, sessions: 0 }
    }
    for (const s of sess) {
      const d = dayMap[s.date]
      if (!d) continue
      d.inputKg += num(s.input_kg) || 0
      d.outputKg += num(s.output_kg) || 0
      d.sessions++
    }
    const dailyYield = Object.values(dayMap).map(d => ({
      date: d.date,
      label: format(new Date(d.date + 'T12:00:00'), 'd MMM'),
      inputKg: Math.round(d.inputKg),
      outputKg: Math.round(d.outputKg),
      sessions: d.sessions,
      yieldPct: d.inputKg > 0 ? round1((d.outputKg / d.inputKg) * 100) : null,
    }))

    // ── Yield grouped by a key (section / variant) ─────────────────────────────
    const groupYield = (key: 'section_id' | 'variant') => {
      const m: Record<string, { key: string; inputKg: number; outputKg: number; sessions: number }> = {}
      for (const s of sess) {
        const k = s[key] || '—'
        if (!m[k]) m[k] = { key: k, inputKg: 0, outputKg: 0, sessions: 0 }
        m[k].inputKg += num(s.input_kg) || 0
        m[k].outputKg += num(s.output_kg) || 0
        m[k].sessions++
      }
      return Object.values(m).map(g => ({
        ...g,
        inputKg: Math.round(g.inputKg),
        outputKg: Math.round(g.outputKg),
        yieldPct: g.inputKg > 0 ? round1((g.outputKg / g.inputKg) * 100) : null,
      })).sort((a, b) => b.outputKg - a.outputKg)
    }

    // ── Output mix — aggregate product streams over the window ─────────────────
    const mixMap: Record<string, { productType: string; kg: number; bags: number }> = {}
    let mixTotal = 0
    for (const r of streams) {
      const p = r.product_type || '—'
      if (!mixMap[p]) mixMap[p] = { productType: p, kg: 0, bags: 0 }
      mixMap[p].kg += num(r.kg) || 0
      mixMap[p].bags += Number(r.bag_count) || 0
      mixTotal += num(r.kg) || 0
    }
    const outputMix = Object.values(mixMap).map(m => ({
      ...m,
      kg: Math.round(m.kg),
      sharePct: mixTotal > 0 ? round1((m.kg / mixTotal) * 100) : null,
    })).sort((a, b) => b.kg - a.kg)

    // ── Machine params vs yield (scatter/correlation) ──────────────────────────
    // Join a checks record to its session by session_id, else by (section,date,shift).
    const byId = new Map(sess.map(s => [s.session_id, s]))
    const byTuple = new Map(sess.map(s => [`${s.section_id}|${s.date}|${s.shift}`, s]))
    const machineVsYield = machine.map(m => {
      const s = (m.session_id && byId.get(m.session_id)) || byTuple.get(`${m.section_id}|${m.date}|${m.shift}`)
      if (!s) return null
      return {
        date: m.date,
        sectionId: m.section_id,
        batchKey: s.batch_key,
        yieldPct: num(s.yield_pct),
        outputKg: num(s.output_kg),
        indentSpeedRpm: num(m.indent_screen_speed_rpm),
        indentAngleDeg: num(m.indent_screen_angle_deg),
        vsdHzAvg: num(m.infeed_vsd_hz_avg),
        vsdHzMin: num(m.infeed_vsd_hz_min),
        vsdHzMax: num(m.infeed_vsd_hz_max),
        sievingConfig: m.sieving_config || null,
      }
    }).filter(Boolean)

    // ── Batch 360 (window batches) with quality ────────────────────────────────
    let batches: any[] = []
    let completeness = { batches: 0, withQuality: 0, withoutQuality: 0 }
    if (batchKeys.size) {
      const keys = [...batchKeys]
      let all: any[] = []
      for (let i = 0; i < keys.length; i += 200) {
        const { data } = await db.schema('production').from('v_batch_360')
          .select('batch_id,batch_key,display_lot,variant,first_section,sections,session_count,total_input_kg,total_output_kg,yield_pct,first_date,last_date,bulk_density_latest,leaf_shade_latest,pa_level_latest,all_passed,sd_run_count,pa_ta_level,residue_grade,has_quality')
          .in('batch_key', keys.slice(i, i + 200))
        all = all.concat((data || []) as any[])
      }
      batches = all.map(b => ({
        batchKey: b.batch_key,
        displayLot: b.display_lot,
        variant: b.variant,
        sections: b.sections || [],
        sessionCount: b.session_count,
        totalInputKg: Math.round(num(b.total_input_kg) || 0),
        totalOutputKg: Math.round(num(b.total_output_kg) || 0),
        yieldPct: num(b.yield_pct),
        firstDate: b.first_date,
        lastDate: b.last_date,
        bulkDensity: num(b.bulk_density_latest),
        leafShade: b.leaf_shade_latest || null,
        paLevel: num(b.pa_level_latest) ?? num(b.pa_ta_level),
        residueGrade: b.residue_grade || null,
        allPassed: b.all_passed,
        sdRunCount: b.sd_run_count || 0,
        hasQuality: !!b.has_quality,
      })).sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''))
      completeness = {
        batches: batches.length,
        withQuality: batches.filter(b => b.hasQuality).length,
        withoutQuality: batches.filter(b => !b.hasQuality).length,
      }
    }

    return NextResponse.json({
      window: { days, startDate },
      filters: { section, variant, batch: batchKey },
      kpis: {
        totalInputKg: Math.round(totalIn),
        totalOutputKg: Math.round(totalOut),
        avgYieldPct: totalIn > 0 ? round1((totalOut / totalIn) * 100) : null,
        batchCount: batchKeys.size,
        sessionCount: sess.length,
        withinTolPct: tolCount > 0 ? Math.round((withinTol / tolCount) * 100) : null,
      },
      dailyYield,
      yieldBySection: groupYield('section_id'),
      yieldByVariant: groupYield('variant'),
      outputMix,
      machineVsYield,
      batches,
      completeness,
    })
  } catch (err: any) {
    console.error('[yield-analytics]', err)
    return NextResponse.json({ error: err.message ?? 'Unknown' }, { status: 500 })
  }
}
