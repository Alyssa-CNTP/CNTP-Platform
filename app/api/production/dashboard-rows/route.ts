// app/api/production/dashboard-rows/route.ts
//
// Row-level data (one row per date × shift × section) for the filterable
// pivot dashboard — deliberately UNaggregated so the client can slice by
// date/variant/shift/line in any combination without another round trip.
// Every other production KPI endpoint (manager-kpis, orders-kpis) pre-
// aggregates server-side for a fixed view; this one exists specifically
// because the pivot UI needs raw rows to re-aggregate on the fly.
//
// Quality (moisture/bulk density/PA/pass) is matched by section + date, the
// same approximation manager-kpis already uses for PSD — qms.* isn't linked
// to prod_sessions by any FK, so date-matching is the honest join available
// (see production.v_batch_quality for the batch-key version, which needs a
// lot number to work and isn't guaranteed to exist per session).

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { sectionMeta, massBalanceToleranceFor } from '@/lib/production/capture-config'

export const runtime = 'nodejs'

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'from and to dates (yyyy-MM-dd) are required.' }, { status: 400 })
    }

    const db = await createServerSupabaseClient()

    // ── Sessions — the spine ────────────────────────────────────────────────
    const { data: sessRaw, error: sessErr } = await db.schema('production').from('prod_sessions')
      .select('id,section_id,date,shift,status,variant,production_orders')
      .gte('date', from).lte('date', to).is('deleted_at', null)
    if (sessErr) throw sessErr
    const sessions = (sessRaw as any[]) ?? []
    const sessionIds = sessions.map(s => s.id)

    // ── Mass balance + bagging (for input/output/hours/bags) ────────────────
    let mb: any[] = [], bagging: any[] = []
    for (let i = 0; i < sessionIds.length; i += 200) {
      const slice = sessionIds.slice(i, i + 200)
      const [mbRes, bagRes] = await Promise.all([
        db.schema('production').from('prod_mass_balance')
          .select('session_id,total_input_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg')
          .in('session_id', slice),
        db.schema('production').from('prod_bagging')
          .select('session_id,kg,created_at').in('session_id', slice),
      ])
      mb = mb.concat(mbRes.data ?? [])
      bagging = bagging.concat(bagRes.data ?? [])
    }
    const mbBySession = new Map(mb.map(m => [m.session_id, m]))
    const bagsBySession = new Map<string, any[]>()
    bagging.forEach(b => { const a = bagsBySession.get(b.session_id) ?? []; a.push(b); bagsBySession.set(b.session_id, a) })

    // ── Machine checks ───────────────────────────────────────────────────────
    const { data: recRaw } = await db.schema('production').from('check_records')
      .select('id,section_id,date,shift,operator_name,supervisor_name')
      .gte('date', from).lte('date', to)
    const records = (recRaw as any[]) ?? []
    const recordIds = records.map(r => r.id)
    let events: any[] = []
    for (let i = 0; i < recordIds.length; i += 200) {
      const { data } = await db.schema('production').from('check_events')
        .select('record_id,check_key,value_num,status,recorded_at,actor_name')
        .in('record_id', recordIds.slice(i, i + 200))
      events = events.concat(data ?? [])
    }
    const recordById = new Map(records.map(r => [r.id, r]))
    const recordByKey = new Map(records.map(r => [`${r.section_id}|${r.date}|${r.shift}`, r]))
    // Keyed by section+date+shift — check_records is unique on that triple.
    const checksByKey = new Map<string, { total: number; ok: number; flagged: number; fail: number; vsd: number[]; lastCheckedAt: string | null; lastActorName: string | null }>()
    for (const e of events) {
      const rec = recordById.get(e.record_id)
      if (!rec) continue
      const key = `${rec.section_id}|${rec.date}|${rec.shift}`
      const c = checksByKey.get(key) ?? { total: 0, ok: 0, flagged: 0, fail: 0, vsd: [], lastCheckedAt: null, lastActorName: null }
      c.total++
      if (e.status === 'ok') c.ok++
      else if (e.status === 'flagged') c.flagged++
      else if (e.status === 'fail') c.fail++
      if (e.check_key === 'infeed_vsd' && e.value_num != null) c.vsd.push(Number(e.value_num))
      if (e.recorded_at && (!c.lastCheckedAt || e.recorded_at > c.lastCheckedAt)) { c.lastCheckedAt = e.recorded_at; c.lastActorName = e.actor_name ?? null }
      checksByKey.set(key, c)
    }

    // ── Quality — matched by section + date (see header note) ──────────────
    // qcName / checkedAt answer "who did it, when" for whichever QC-tracked
    // line the row belongs to — sieving/granule/pasteuriser each surface this
    // differently (see the three blocks below), so it's normalized here.
    const qcByKey = new Map<string, { moisture: number | null; bulkDensity: number | null; paLevel: number | null; passed: boolean | null; qcName: string | null; checkedAt: string | null }>()
    const mergeQc = (section: string, date: string, patch: Partial<{ moisture: number | null; bulkDensity: number | null; paLevel: number | null; passed: boolean | null; qcName: string | null; checkedAt: string | null }>) => {
      const key = `${section}|${date}`
      const cur = qcByKey.get(key) ?? { moisture: null, bulkDensity: null, paLevel: null, passed: null, qcName: null, checkedAt: null }
      qcByKey.set(key, { ...cur, ...patch })
    }
    {
      const { data } = await (db as any).schema('qms').from('sd_runs')
        .select('date,bulk_density,pa_level,pass_status,qc_name,time_of_run')
        .gte('date', from).lte('date', to)
      for (const r of (data ?? [])) {
        mergeQc('sieving', r.date, {
          bulkDensity: num(r.bulk_density), paLevel: num(r.pa_level),
          passed: r.pass_status ? r.pass_status === 'pass' : null,
          qcName: r.qc_name || null,
          checkedAt: r.time_of_run ? `${r.date}T${r.time_of_run}` : r.date,
        })
      }
    }
    {
      const { data: runs } = await (db as any).schema('qms').from('granule_runs')
        .select('id,production_date,overall_status,qc_name')
        .gte('production_date', from).lte('production_date', to)
      const runList = runs ?? []
      const runIds = runList.map((r: any) => r.id)
      let samples: any[] = []
      for (let i = 0; i < runIds.length; i += 200) {
        const { data } = await (db as any).schema('qms').from('granule_samples')
          .select('run_id,moisture,bulk_density,sample_time').in('run_id', runIds.slice(i, i + 200))
        samples = samples.concat(data ?? [])
      }
      const samplesByRun = new Map<number, any[]>()
      samples.forEach(s => { const a = samplesByRun.get(s.run_id) ?? []; a.push(s); samplesByRun.set(s.run_id, a) })
      for (const r of runList) {
        const ss = samplesByRun.get(r.id) ?? []
        const moisture = ss.map(s => num(s.moisture)).filter((n): n is number => n != null)
        const bd = ss.map(s => num(s.bulk_density)).filter((n): n is number => n != null)
        const lastSampleTime = ss.map(s => s.sample_time).filter(Boolean).sort().slice(-1)[0]
        mergeQc('granule', r.production_date, {
          moisture: moisture.length ? moisture.reduce((a, b) => a + b, 0) / moisture.length : null,
          bulkDensity: bd.length ? bd.reduce((a, b) => a + b, 0) / bd.length : null,
          passed: r.overall_status ? r.overall_status === 'Pass' : null,
          qcName: r.qc_name || null,
          checkedAt: lastSampleTime ? `${r.production_date}T${lastSampleTime}` : r.production_date,
        })
      }
    }
    {
      const { data } = await (db as any).schema('qms').from('quality_records')
        .select('data_json,created_at,uploaded_by')
        .eq('workcenter', 'pasteuriser').eq('workflow', 'pasteuriser_run')
        .gte('created_at', from).lte('created_at', `${to}T23:59:59`)
      for (const r of (data ?? [])) {
        const d = typeof r.data_json === 'string' ? JSON.parse(r.data_json) : (r.data_json || {})
        const date = d.production_date || String(r.created_at).slice(0, 10)
        const samples = Array.isArray(d.samples) ? d.samples : []
        const moisture = samples.map((s: any) => num(s.moisture)).filter((n: number | null): n is number => n != null)
        const bd = samples.map((s: any) => num(s.untapped_bd)).filter((n: number | null): n is number => n != null)
        if (moisture.length || bd.length) {
          mergeQc('pasteuriser', date, {
            moisture: moisture.length ? moisture.reduce((a: number, b: number) => a + b, 0) / moisture.length : null,
            bulkDensity: bd.length ? bd.reduce((a: number, b: number) => a + b, 0) / bd.length : null,
            qcName: r.uploaded_by || null,
            checkedAt: r.created_at,
          })
        }
      }
    }

    // ── Assemble rows ────────────────────────────────────────────────────────
    const rows = sessions.map(s => {
      const m = mbBySession.get(s.id)
      const inputKg = m ? num(m.total_input_kg) ?? 0 : 0
      const outputKg = m ? (num(m.total_output_b_kg) ?? 0) + (num(m.total_output_c_kg) ?? 0) + (num(m.total_output_d_kg) ?? 0) : 0
      const bags = bagsBySession.get(s.id) ?? []
      const stamps = bags.map(b => b.created_at).filter(Boolean).sort()
      // Run-time from first→last bag this session, the same basis orders-kpis
      // uses for kg/hr — null (not zero) when there isn't enough data to
      // measure a run window, so it's excluded from the aggregate rather than
      // silently dragging it down.
      const hours = stamps.length > 1
        ? Math.max(0, (new Date(stamps[stamps.length - 1]).getTime() - new Date(stamps[0]).getTime()) / 3_600_000)
        : null
      const checkKey = `${s.section_id}|${s.date}|${s.shift}`
      const checks = checksByKey.get(checkKey)
      const qc = qcByKey.get(`${s.section_id}|${s.date}`)
      const meta = sectionMeta(s.section_id)
      return {
        sessionId: s.id, date: s.date, shift: s.shift, sectionId: s.section_id,
        sectionName: meta.name, sectionCode: meta.code, colorHex: meta.colorHex,
        variant: s.variant ?? null,
        productionOrders: (s.production_orders ?? []) as string[],
        inputKg, outputKg, hours, bags: bags.length,
        toleranceKg: massBalanceToleranceFor(s.section_id),
        checkTotal: checks?.total ?? null, checkOk: checks?.ok ?? null,
        checkFlagged: checks?.flagged ?? null, checkFailed: checks?.fail ?? null,
        vsdHz: checks?.vsd.length ? checks.vsd.reduce((a, b) => a + b, 0) / checks.vsd.length : null,
        checkOperator: recordByKey.get(checkKey)?.operator_name ?? null,
        checkSupervisor: recordByKey.get(checkKey)?.supervisor_name ?? null,
        lastCheckedAt: checks?.lastCheckedAt ?? null, lastCheckActor: checks?.lastActorName ?? null,
        moisture: qc?.moisture ?? null, bulkDensity: qc?.bulkDensity ?? null,
        paLevel: qc?.paLevel ?? null, passed: qc?.passed ?? null,
        qcName: qc?.qcName ?? null, qcCheckedAt: qc?.checkedAt ?? null,
      }
    })

    return NextResponse.json({ window: { from, to }, rows })
  } catch (err: any) {
    console.error('[dashboard-rows]', err)
    return NextResponse.json({ error: err?.message ?? 'Could not load dashboard rows' }, { status: 500 })
  }
}
