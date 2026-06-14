'use client'

import { useState, useEffect } from 'react'
import { getDb } from '@/lib/supabase/db'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, XCircle, Minus } from 'lucide-react'
import type { McSession } from './MonthlyCountForm'

// Production-module section ids differ from the count module's. Map them so
// produced (prod_sessions) and consumed (bag_tags) line up with the count's
// sections (which key the reconciliation rows). Lenient: unknown ids pass through.
const PROD_TO_COUNT: Record<string, string> = {
  sieving: 'sieve', refining1: 'ref1', refining2: 'ref2',
  granule: 'gran', blender: 'blend', pasteuriser: 'past',
}
const toCountSection = (id: string | null | undefined) => (id ? (PROD_TO_COUNT[id] ?? id) : id)

// ── Types ─────────────────────────────────────────────────────────────────────
interface SectionRow {
  section_id:        string
  section_name:      string
  opening_kg:        number | null   // Previous month-end count
  produced_kg:       number          // Production sessions this month
  consumed_kg:       number          // Bags consumed / dispatched this month
  counted_kg:        number          // This month's monthly count (avg sup+adm)
  expected_kg:       number          // opening + produced - consumed
  variance_kg:       number          // counted - expected
  variance_pct:      number
  status:            'reconciled' | 'variance' | 'review' | 'no-data'
}

interface BatchContributor {
  batch_number:  string
  counted_kg:    number
  bag_kg:        number
  variance_kg:   number
}

// ── Status chip ───────────────────────────────────────────────────────────────
function StatusChip({ status }: { status: SectionRow['status'] }) {
  switch (status) {
    case 'reconciled': return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-md bg-ok/10 text-ok font-bold">
        <CheckCircle2 size={9} /> Reconciled
      </span>
    )
    case 'variance': return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-md bg-warn/10 text-warn font-bold">
        <AlertTriangle size={9} /> Variance
      </span>
    )
    case 'review': return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-md bg-err/10 text-err font-bold">
        <XCircle size={9} /> Review
      </span>
    )
    default: return (
      <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-surface text-text-muted">No Data</span>
    )
  }
}

// ── Variance drill-down ───────────────────────────────────────────────────────
function VarianceDrillDown({ sectionId, sessionId, month }: { sectionId: string; sessionId: string; month: string }) {
  const db = getDb()
  const [loading,      setLoading]      = useState(true)
  const [contributors, setContributors] = useState<BatchContributor[]>([])

  const monthDate = new Date(month + '-01T12:00:00')
  const dateFrom  = format(startOfMonth(monthDate), 'yyyy-MM-dd')
  const dateTo    = format(endOfMonth(monthDate),   'yyyy-MM-dd')

  useEffect(() => { load() }, [sectionId])

  async function load() {
    setLoading(true)

    // Monthly count entries for this section
    const { data: mcData } = await db
      .from('mc_entries')
      .select('batch_number,role,kg')
      .eq('session_id', sessionId)
      .eq('section_id', sectionId)
      .eq('is_no_stock', false)

    // Bag tags for this section in this month
    const { data: bagData } = await db
      .schema('production')
      .from('bag_tags')
      .select('lot_number,weight_kg')
      .eq('section_id', sectionId)
      .gte('created_at', dateFrom + 'T00:00:00Z')
      .lte('created_at', dateTo   + 'T23:59:59Z')
      .not('weight_kg', 'is', null)

    // Aggregate monthly count by batch (avg sup+adm)
    const mcByBatch = new Map<string, { sup: number; adm: number }>()
    ;(mcData ?? []).forEach((e: any) => {
      const k = e.batch_number ?? '(no batch)'
      if (!mcByBatch.has(k)) mcByBatch.set(k, { sup: 0, adm: 0 })
      const rec = mcByBatch.get(k)!
      if (e.role === 'supervisor') rec.sup += e.kg ?? 0
      else                         rec.adm += e.kg ?? 0
    })

    // Aggregate bag tags by lot
    const bagByLot = new Map<string, number>()
    ;(bagData ?? []).forEach((b: any) => {
      const k = b.lot_number ?? '(no lot)'
      bagByLot.set(k, (bagByLot.get(k) ?? 0) + (b.weight_kg ?? 0))
    })

    const allKeys = new Set([...Array.from(mcByBatch.keys()), ...Array.from(bagByLot.keys())])
    const rows: BatchContributor[] = Array.from(allKeys).map(k => {
      const mc    = mcByBatch.get(k)
      const mcKg  = mc ? (mc.sup + mc.adm) / 2 : 0
      const bagKg = bagByLot.get(k) ?? 0
      return { batch_number: k, counted_kg: mcKg, bag_kg: bagKg, variance_kg: mcKg - bagKg }
    }).sort((a, b) => Math.abs(b.variance_kg) - Math.abs(a.variance_kg))

    setContributors(rows)
    setLoading(false)
  }

  if (loading) {
    return <div className="px-5 py-4 font-mono text-[11px] text-text-muted animate-pulse">Loading batch breakdown…</div>
  }

  if (contributors.length === 0) {
    return <div className="px-5 py-4 font-mono text-[11px] text-text-muted">No batch data found for this section.</div>
  }

  return (
    <div className="px-5 pb-4 pt-2 border-t border-surface-rule">
      <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-3">Batch Breakdown — Monthly Count vs Bag Tracking</p>
      <div className="space-y-1.5">
        {contributors.map(c => (
          <div key={c.batch_number} className="grid grid-cols-[1fr_90px_90px_90px] gap-2 items-center px-3 py-2 bg-surface rounded-xl">
            <span className="font-mono text-[11px] font-bold text-text truncate">{c.batch_number}</span>
            <div className="text-right">
              <div className="font-mono text-[10px] text-text-muted">Counted</div>
              <div className="font-mono text-[11px] text-text">{c.counted_kg.toFixed(1)} kg</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[10px] text-text-muted">Bags</div>
              <div className="font-mono text-[11px] text-text">{c.bag_kg > 0 ? `${c.bag_kg.toFixed(1)} kg` : '—'}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[10px] text-text-muted">Gap</div>
              <div className={`font-mono text-[11px] font-bold ${
                Math.abs(c.variance_kg) < 1 ? 'text-ok' :
                Math.abs(c.variance_kg) < 50 ? 'text-warn' : 'text-err'
              }`}>
                {c.variance_kg > 0 ? '+' : ''}{c.variance_kg.toFixed(1)} kg
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// MONTHLY RECONCILIATION
// ═════════════════════════════════════════════════════════════════════════════
export default function MonthlyReconciliation({ session }: { session: McSession }) {
  const db = getDb()
  const [loading,  setLoading]  = useState(true)
  const [rows,     setRows]     = useState<SectionRow[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  const monthDate  = new Date(session.count_month + 'T12:00:00')
  const dateFrom   = format(startOfMonth(monthDate), 'yyyy-MM-dd')
  const dateTo     = format(endOfMonth(monthDate),   'yyyy-MM-dd')
  const prevMonth  = format(subMonths(monthDate, 1), 'yyyy-MM')

  useEffect(() => { load() }, [session.id])

  async function load() {
    setLoading(true)

    // ── 1. This month's count (from mc_entries) ──────────────────────────────
    const { data: mcData } = await db
      .from('mc_entries')
      .select('section_id,section_name,role,kg')
      .eq('session_id', session.id)
      .eq('is_no_stock', false)

    // ── 2. Opening stock — previous month's mc_entries ───────────────────────
    const { data: prevSession } = await db
      .from('mc_sessions')
      .select('id')
      .eq('count_month', `${prevMonth}-01`)
      .eq('warehouse_id', session.warehouse_id)
      .eq('product_type', session.product_type)
      .maybeSingle()

    let prevData: any[] = []
    if (prevSession?.id) {
      const { data } = await db
        .from('mc_entries')
        .select('section_id,role,kg')
        .eq('session_id', prevSession.id)
        .eq('is_no_stock', false)
      prevData = data ?? []
    }

    // ── 3. Produced — mass-balance output of this month's production sessions ─
    const { data: prodSessions } = await db
      .schema('production')
      .from('prod_sessions')
      .select('id,section_id')
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .in('status', ['submitted','approved'])
    const prodSessIds = (prodSessions ?? []).map((p: any) => p.id)
    let prodMb: any[] = []
    if (prodSessIds.length) {
      const { data } = await db
        .schema('production')
        .from('prod_mass_balance')
        .select('session_id,total_output_b_kg,total_output_c_kg,total_output_d_kg')
        .in('session_id', prodSessIds)
      prodMb = data ?? []
    }
    const prodSessSection = new Map<string, string>((prodSessions ?? []).map((p: any) => [p.id as string, p.section_id as string]))

    // ── 4. Consumed / dispatched — bags consumed this month ──────────────────
    const { data: consumedData } = await db
      .schema('production')
      .from('bag_tags')
      .select('consumed_at_section,consumed_weight_kg')
      .not('consumed_at_section', 'is', null)
      .not('consumed_weight_kg', 'is', null)
      .gte('created_at', dateFrom + 'T00:00:00Z')
      .lte('created_at', dateTo   + 'T23:59:59Z')

    // ── Aggregate ─────────────────────────────────────────────────────────────

    // Current month count by section (avg sup+adm)
    const mcBySection = new Map<string, { sup: number; adm: number; name: string }>()
    ;(mcData ?? []).forEach((e: any) => {
      if (!mcBySection.has(e.section_id)) {
        mcBySection.set(e.section_id, { sup: 0, adm: 0, name: e.section_name ?? e.section_id })
      }
      const rec = mcBySection.get(e.section_id)!
      if (e.role === 'supervisor') rec.sup += e.kg ?? 0
      else                         rec.adm += e.kg ?? 0
    })

    // Previous month count by section (avg sup+adm) = Opening
    const prevBySection = new Map<string, number>()
    prevData.forEach((e: any) => {
      const existing = prevBySection.get(e.section_id) ?? 0
      prevBySection.set(e.section_id, existing + (e.kg ?? 0) / 2)
    })

    // Production by section — sum of mass-balance outputs (B + C + D)
    const prodBySection = new Map<string, number>()
    prodMb.forEach((m: any) => {
      const sid = toCountSection(prodSessSection.get(m.session_id))
      if (!sid) return
      const kg = (Number(m.total_output_b_kg) || 0) + (Number(m.total_output_c_kg) || 0) + (Number(m.total_output_d_kg) || 0)
      prodBySection.set(sid, (prodBySection.get(sid) ?? 0) + kg)
    })

    // Consumed by section
    const consumedBySection = new Map<string, number>()
    ;(consumedData ?? []).forEach((b: any) => {
      const sid = toCountSection(b.consumed_at_section)
      if (!sid) return
      consumedBySection.set(sid, (consumedBySection.get(sid) ?? 0) + (b.consumed_weight_kg ?? 0))
    })

    // Build rows — only sections that appear in the monthly count
    const result: SectionRow[] = Array.from(mcBySection.entries()).map(([sid, mc]) => {
      const countedKg  = (mc.sup + mc.adm) / 2
      const openingKg  = prevBySection.get(sid) ?? null
      const producedKg = prodBySection.get(sid) ?? 0
      const consumedKg = consumedBySection.get(sid) ?? 0
      const expectedKg = openingKg != null ? openingKg + producedKg - consumedKg : 0
      const varianceKg = openingKg != null ? countedKg - expectedKg : 0
      const maxRef     = Math.max(countedKg, expectedKg)
      const varPct     = maxRef > 0 && openingKg != null ? (Math.abs(varianceKg) / maxRef) * 100 : 0

      let status: SectionRow['status'] = 'no-data'
      if (countedKg > 0 && openingKg != null) {
        if (varPct <= 2)  status = 'reconciled'
        else if (varPct <= 10) status = 'variance'
        else status = 'review'
      } else if (countedKg > 0) {
        status = 'no-data'
      }

      return {
        section_id:   sid,
        section_name: mc.name,
        opening_kg:   openingKg,
        produced_kg:  producedKg,
        consumed_kg:  consumedKg,
        counted_kg:   countedKg,
        expected_kg:  expectedKg,
        variance_kg:  varianceKg,
        variance_pct: varPct,
        status,
      }
    }).sort((a, b) => a.section_name.localeCompare(b.section_name))

    setRows(result)
    setLoading(false)
  }

  if (loading) {
    return <div className="py-12 text-center font-mono text-[12px] text-text-muted animate-pulse">Loading reconciliation…</div>
  }

  const reviewCount   = rows.filter(r => r.status === 'review').length
  const varianceCount = rows.filter(r => r.status === 'variance').length

  return (
    <div className="space-y-4">

      {/* Summary flags */}
      {(reviewCount > 0 || varianceCount > 0) && (
        <div className="flex flex-wrap gap-3">
          {reviewCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-err/8 border border-err/25 rounded-xl">
              <XCircle size={13} className="text-err" />
              <span className="font-mono text-[11px] text-err font-bold">
                {reviewCount} section{reviewCount !== 1 ? 's' : ''} need immediate review
              </span>
            </div>
          )}
          {varianceCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-warn/8 border border-warn/25 rounded-xl">
              <AlertTriangle size={13} className="text-warn" />
              <span className="font-mono text-[11px] text-warn font-bold">
                {varianceCount} section{varianceCount !== 1 ? 's' : ''} have variances
              </span>
            </div>
          )}
        </div>
      )}

      <p className="font-mono text-[10px] text-text-muted">
        Click any variance cell to see batch-level breakdown.
        Opening stock sourced from {prevMonth} monthly count{!rows.some(r => r.opening_kg != null) ? ' — no previous count found' : ''}.
      </p>

      <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface border-b border-surface-rule">
                {['Section','Opening','Produced','Consumed / Dispatched','Counted (Month-End)','Variance','Status'].map(h => (
                  <th key={h} className="px-4 py-3 font-mono text-[10px] uppercase tracking-wide text-text-muted whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <>
                  <tr
                    key={r.section_id}
                    className={`border-b border-surface-rule hover:bg-surface transition-colors ${expanded === r.section_id ? 'bg-surface' : ''}`}
                  >
                    <td className="px-4 py-3 font-body font-semibold text-[13px] text-text whitespace-nowrap">{r.section_name}</td>

                    <td className="px-4 py-3 font-mono text-[12px] text-text-muted">
                      {r.opening_kg != null ? `${Math.round(r.opening_kg).toLocaleString()} kg` : <span className="text-text-faint text-[10px]">No prev. count</span>}
                    </td>

                    <td className="px-4 py-3 font-mono text-[12px] text-text-muted">
                      {r.produced_kg > 0 ? `${Math.round(r.produced_kg).toLocaleString()} kg` : '—'}
                    </td>

                    <td className="px-4 py-3 font-mono text-[12px] text-text-muted">
                      {r.consumed_kg > 0 ? `${Math.round(r.consumed_kg).toLocaleString()} kg` : '—'}
                    </td>

                    <td className="px-4 py-3 font-mono text-[12px] font-bold text-text">
                      {r.counted_kg > 0 ? `${Math.round(r.counted_kg).toLocaleString()} kg` : '—'}
                    </td>

                    {/* Variance — clickable if there is one */}
                    <td className="px-4 py-3">
                      {r.opening_kg != null && Math.abs(r.variance_kg) > 0.5 ? (
                        <button
                          onClick={() => setExpanded(expanded === r.section_id ? null : r.section_id)}
                          className={`flex items-center gap-1.5 font-mono text-[12px] font-bold hover:underline ${
                            r.variance_pct > 10 ? 'text-err' : r.variance_pct > 2 ? 'text-warn' : 'text-ok'
                          }`}
                        >
                          {r.variance_kg > 0 ? '+' : ''}{Math.round(r.variance_kg).toLocaleString()} kg
                          <span className="text-[10px] opacity-70">({r.variance_pct.toFixed(1)}%)</span>
                          {expanded === r.section_id ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                        </button>
                      ) : r.opening_kg != null ? (
                        <span className="flex items-center gap-1 font-mono text-[12px] text-ok">
                          <Minus size={11}/> &lt; 1 kg
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-text-faint">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3"><StatusChip status={r.status} /></td>
                  </tr>

                  {/* Drill-down row */}
                  {expanded === r.section_id && (
                    <tr key={`${r.section_id}-drill`} className="border-b border-surface-rule bg-surface/50">
                      <td colSpan={7} className="p-0">
                        <VarianceDrillDown
                          sectionId={r.section_id}
                          sessionId={session.id}
                          month={session.count_month.slice(0, 7)}
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
