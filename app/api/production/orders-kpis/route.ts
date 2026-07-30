// app/api/production/orders-kpis/route.ts
//
// KPIs and analytics for the Production Orders page: tons per day and per week,
// machine throughput per line, how much of every output product was produced and
// which line produced it, and yield by line and by variant.
//
// Deliberately computed from the BASE capture tables (prod_sessions,
// prod_mass_balance, prod_bagging, prod_timesheets) rather than the
// production.v_* reporting views. The views (20260721_002/003) are a strictly
// better query layer but have not been applied everywhere yet, and a KPI strip
// that silently renders zeros on a database missing a view is worse than one
// that reads the tables it knows exist. If the views become universal this can
// move onto them without changing the response shape.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { sectionMeta, SECTION_ORDER, massBalanceToleranceFor } from '@/lib/production/capture-config'

export const runtime = 'nodejs'

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}
const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

/** Monday-start ISO week key for a yyyy-MM-dd date. */
function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  const dow = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1))
  return d.toISOString().slice(0, 10)
}

/** Every date from → to inclusive, so a chart has a continuous axis. */
function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  let guard = 0
  while (d <= end && guard < 400) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); guard++ }
  return out
}

export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!caller.can('can_view_live_history') && caller.department !== 'Production' && caller.department !== 'Management') {
      return NextResponse.json({ error: 'You do not have access to production orders.' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const section = searchParams.get('section') || null
    const variant = searchParams.get('variant') || null
    const shift = searchParams.get('shift') || null
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'from and to dates (yyyy-MM-dd) are required.' }, { status: 400 })
    }

    const db = getAdminClient()
    const prod = () => db.schema('production' as any)

    // ── Sessions in the window, matching the page's filters ──────────────────
    let sq = prod().from('prod_sessions')
      .select('id,section_id,date,shift,status,variant,operator_names,submitted_at')
      .gte('date', from).lte('date', to).is('deleted_at', null)
    if (section) sq = sq.eq('section_id', section)
    if (variant) sq = sq.eq('variant', variant)
    if (shift) sq = sq.eq('shift', shift)
    const { data: sessRaw, error: sErr } = await sq
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    const sessions = ((sessRaw as any[]) ?? [])
    const sessionIds = sessions.map(s => s.id)

    let mb: any[] = [], bagging: any[] = []
    if (sessionIds.length) {
      // Chunked because a wide date range can exceed a comfortable `in` list.
      for (let i = 0; i < sessionIds.length; i += 300) {
        const slice = sessionIds.slice(i, i + 300)
        const [mbRes, bagRes] = await Promise.all([
          prod().from('prod_mass_balance')
            .select('session_id,total_input_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg,balance_kg,tolerance_kg')
            .in('session_id', slice),
          prod().from('prod_bagging').select('session_id,product_type,kg,created_at').in('session_id', slice),
        ])
        mb = mb.concat((mbRes.data as any[]) ?? [])
        bagging = bagging.concat((bagRes.data as any[]) ?? [])
      }
    }
    const mbBySession = new Map(mb.map(r => [r.session_id, r]))

    // Confirmed crew hours per section — the fallback throughput denominator
    // when a line has too few bags to measure a run window from.
    const workedBySection = new Map<string, number>()
    {
      let tq = prod().from('prod_timesheets')
        .select('section_id,worked_minutes,date,shift').eq('confirmed', true)
        .gte('date', from).lte('date', to)
      if (section) tq = tq.eq('section_id', section)
      if (shift) tq = tq.eq('shift', shift)
      const { data } = await tq
      for (const t of ((data as any[]) ?? [])) {
        if (!t.section_id) continue
        workedBySection.set(t.section_id, (workedBySection.get(t.section_id) ?? 0) + (Number(t.worked_minutes) || 0))
      }
    }

    // ── Per-session roll-up, reused by every aggregate below ─────────────────
    const perSession = sessions.map(s => {
      const m = mbBySession.get(s.id)
      // Output is B+C+D — stream A is the input side of the refining balance,
      // which is why the yield views sum B+C+D only.
      const inputKg = m ? num(m.total_input_kg) : 0
      const outputKg = m ? num(m.total_output_b_kg) + num(m.total_output_c_kg) + num(m.total_output_d_kg) : 0
      const tol = m ? (num(m.tolerance_kg) || massBalanceToleranceFor(s.section_id)) : massBalanceToleranceFor(s.section_id)
      const balance = m && m.balance_kg !== null ? num(m.balance_kg) : null
      return {
        id: s.id, sectionId: s.section_id, date: s.date, shift: s.shift, status: s.status,
        variant: s.variant ?? null, inputKg, outputKg,
        flagged: balance !== null && Math.abs(balance) > tol,
      }
    })

    // ── Tons per day (continuous axis) ───────────────────────────────────────
    const days = dateRange(from, to)
    const dayMap = new Map(days.map(d => [d, { date: d, inputKg: 0, outputKg: 0, sessions: 0 }]))
    for (const s of perSession) {
      const d = dayMap.get(s.date)
      if (!d) continue
      d.inputKg += s.inputKg; d.outputKg += s.outputKg; d.sessions++
    }
    const perDay = [...dayMap.values()].map(d => ({
      date: d.date,
      inputKg: Math.round(d.inputKg),
      outputKg: Math.round(d.outputKg),
      tons: round2(d.outputKg / 1000),
      sessions: d.sessions,
      yieldPct: d.inputKg > 0 ? round1((d.outputKg / d.inputKg) * 100) : null,
    }))

    // ── Tons per week ────────────────────────────────────────────────────────
    const weekMap = new Map<string, { weekStart: string; inputKg: number; outputKg: number; sessions: number }>()
    for (const s of perSession) {
      const w = weekStart(s.date)
      const row = weekMap.get(w) ?? { weekStart: w, inputKg: 0, outputKg: 0, sessions: 0 }
      row.inputKg += s.inputKg; row.outputKg += s.outputKg; row.sessions++
      weekMap.set(w, row)
    }
    const perWeek = [...weekMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)).map(w => ({
      weekStart: w.weekStart,
      inputKg: Math.round(w.inputKg),
      outputKg: Math.round(w.outputKg),
      tons: round2(w.outputKg / 1000),
      sessions: w.sessions,
      yieldPct: w.inputKg > 0 ? round1((w.outputKg / w.inputKg) * 100) : null,
    }))

    // ── Per line: yield + throughput ─────────────────────────────────────────
    // Run minutes come from first→last bagging timestamp per session, summed
    // across the window. It measures time the line was actually producing, which
    // is the honest denominator for kg/hour; crew hours are the fallback and the
    // basis is always reported so the two are never read as one number.
    const bagsBySession = new Map<string, string[]>()
    for (const b of bagging) {
      if (!b.created_at) continue
      const a = bagsBySession.get(b.session_id) ?? []; a.push(b.created_at); bagsBySession.set(b.session_id, a)
    }
    const runMinutesBySection = new Map<string, number>()
    for (const s of perSession) {
      const stamps = (bagsBySession.get(s.id) ?? []).sort()
      if (stamps.length < 2) continue
      const mins = Math.max(0, Math.round((new Date(stamps[stamps.length - 1]).getTime() - new Date(stamps[0]).getTime()) / 60000))
      if (mins >= 15) runMinutesBySection.set(s.sectionId, (runMinutesBySection.get(s.sectionId) ?? 0) + mins)
    }

    const bySection = SECTION_ORDER.map(id => {
      const mine = perSession.filter(s => s.sectionId === id)
      if (!mine.length) return null
      const inputKg = mine.reduce((t, s) => t + s.inputKg, 0)
      const outputKg = mine.reduce((t, s) => t + s.outputKg, 0)
      const runMinutes = runMinutesBySection.get(id) ?? 0
      const workedMinutes = workedBySection.get(id) ?? 0
      const basis: 'run' | 'worked' | null = runMinutes > 0 ? 'run' : workedMinutes > 0 ? 'worked' : null
      const mins = basis === 'run' ? runMinutes : basis === 'worked' ? workedMinutes : 0
      return {
        sectionId: id,
        sectionName: sectionMeta(id).name,
        sectionCode: sectionMeta(id).code,
        colorHex: sectionMeta(id).colorHex,
        sessions: mine.length,
        inputKg: Math.round(inputKg),
        outputKg: Math.round(outputKg),
        tons: round2(outputKg / 1000),
        yieldPct: inputKg > 0 ? round1((outputKg / inputKg) * 100) : null,
        runMinutes, workedMinutes,
        kgPerHour: mins > 0 ? round1(outputKg / (mins / 60)) : null,
        basis,
        flagged: mine.filter(s => s.flagged).length,
      }
    }).filter(Boolean) as any[]

    // ── Per product: how much of each output, and from which line ────────────
    const sectionOfSession = new Map<string, string>(perSession.map(s => [s.id, s.sectionId]))
    interface ProductAgg { productType: string; kg: number; bags: number; bySection: Record<string, number> }
    const productMap = new Map<string, ProductAgg>()
    let productTotal = 0
    for (const b of bagging) {
      const p = b.product_type || 'Unspecified'
      const row: ProductAgg = productMap.get(p) ?? { productType: p, kg: 0, bags: 0, bySection: {} }
      const kg = num(b.kg)
      row.kg += kg; row.bags += 1
      const sec = sectionOfSession.get(b.session_id)
      if (sec) row.bySection[sec] = (row.bySection[sec] ?? 0) + kg
      productMap.set(p, row)
      productTotal += kg
    }
    const byProduct = [...productMap.values()]
      .map(r => ({
        productType: r.productType,
        kg: Math.round(r.kg),
        tons: round2(r.kg / 1000),
        bags: r.bags,
        sharePct: productTotal > 0 ? round1((r.kg / productTotal) * 100) : null,
        bySection: Object.entries(r.bySection)
          .map(([sectionId, kg]) => ({
            sectionId, sectionCode: sectionMeta(sectionId).code,
            sectionName: sectionMeta(sectionId).name, kg: Math.round(kg),
          }))
          .sort((a, b) => b.kg - a.kg),
      }))
      .sort((a, b) => b.kg - a.kg)

    // ── Per variant ──────────────────────────────────────────────────────────
    const variantMap = new Map<string, { variant: string; inputKg: number; outputKg: number; sessions: number }>()
    for (const s of perSession) {
      const v = s.variant || 'Unspecified'
      const row = variantMap.get(v) ?? { variant: v, inputKg: 0, outputKg: 0, sessions: 0 }
      row.inputKg += s.inputKg; row.outputKg += s.outputKg; row.sessions++
      variantMap.set(v, row)
    }
    const byVariant = [...variantMap.values()].map(v => ({
      variant: v.variant,
      inputKg: Math.round(v.inputKg),
      outputKg: Math.round(v.outputKg),
      tons: round2(v.outputKg / 1000),
      sessions: v.sessions,
      yieldPct: v.inputKg > 0 ? round1((v.outputKg / v.inputKg) * 100) : null,
    })).sort((a, b) => b.outputKg - a.outputKg)

    // ── Totals ───────────────────────────────────────────────────────────────
    const totalInput = perSession.reduce((t, s) => t + s.inputKg, 0)
    const totalOutput = perSession.reduce((t, s) => t + s.outputKg, 0)
    const activeDays = perDay.filter(d => d.sessions > 0).length
    // Averages are per PRODUCING day, not per calendar day — dividing a week's
    // output by 7 when the factory ran 5 days understates the line by 30%.
    const kpis = {
      sessions: perSession.length,
      totalInputKg: Math.round(totalInput),
      totalOutputKg: Math.round(totalOutput),
      totalTons: round2(totalOutput / 1000),
      yieldPct: totalInput > 0 ? round1((totalOutput / totalInput) * 100) : null,
      activeDays,
      tonsPerDay: activeDays > 0 ? round2(totalOutput / 1000 / activeDays) : null,
      tonsPerWeek: perWeek.length > 0 ? round2(perWeek.reduce((t, w) => t + w.tons, 0) / perWeek.length) : null,
      bags: bagging.length,
      balanceFlags: perSession.filter(s => s.flagged).length,
      signedOff: perSession.filter(s => s.status === 'approved').length,
      outstanding: perSession.filter(s => s.status !== 'approved').length,
      // Overall throughput across every line with a measurable basis. Summed
      // numerator over summed denominator, not a mean of per-line rates, so a
      // short-running line can't skew it.
      kgPerHour: (() => {
        const mins = bySection.reduce((t, s) => t + (s.basis === 'run' ? s.runMinutes : s.basis === 'worked' ? s.workedMinutes : 0), 0)
        const kg = bySection.filter(s => s.basis).reduce((t, s) => t + s.outputKg, 0)
        return mins > 0 ? round1(kg / (mins / 60)) : null
      })(),
    }

    return NextResponse.json({
      window: { from, to },
      filters: { section, variant, shift },
      kpis, perDay, perWeek, bySection, byProduct, byVariant,
    })
  } catch (err: any) {
    console.error('[orders-kpis]', err)
    return NextResponse.json({ error: err?.message ?? 'Could not build production KPIs' }, { status: 500 })
  }
}
