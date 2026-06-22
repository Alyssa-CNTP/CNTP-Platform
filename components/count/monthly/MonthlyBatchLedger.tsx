'use client'

import { useState, useEffect } from 'react'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import {
  Search, X, ChevronRight, FlaskConical,
  CheckCircle2, AlertTriangle, Link2, Unlink,
} from 'lucide-react'
import BatchReconciliationPanel from '@/components/shared/BatchReconciliationPanel'
import type { McSession } from './MonthlyCountForm'

// ── Types ─────────────────────────────────────────────────────────────────────
interface LedgerRow {
  batch_number:   string
  sections:       string[]
  counted_kg:     number    // from daily sc_entries for the month (avg sup+adm)
  bag_count:      number    // bag_tags with this lot_number
  bag_kg:         number    // total kg in those bags
  has_quality:    boolean   // appears in any quality record
  status:         'reconciled' | 'variance' | 'unlinked'
}

// ── Status chip ───────────────────────────────────────────────────────────────
function StatusChip({ status }: { status: LedgerRow['status'] }) {
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
    case 'unlinked': return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-md bg-err/10 text-err font-bold">
        <Unlink size={9} /> Unlinked
      </span>
    )
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MONTHLY BATCH LEDGER
// ═════════════════════════════════════════════════════════════════════════════
export default function MonthlyBatchLedger({ session }: { session: McSession }) {
  const db = getDb()
  const [loading,  setLoading]  = useState(true)
  const [rows,     setRows]     = useState<LedgerRow[]>([])
  const [search,   setSearch]   = useState('')
  const [filter,   setFilter]   = useState<'all'|'reconciled'|'variance'|'unlinked'>('all')
  const [panel,    setPanel]    = useState<string | null>(null)  // selected batch number

  const monthStr = session.count_month.slice(0, 7)  // yyyy-MM
  const dateFrom = session.count_month.slice(0, 8) + '01'
  const dateTo   = (() => {
    const d = new Date(session.count_month + 'T12:00:00')
    return format(new Date(d.getFullYear(), d.getMonth() + 1, 0), 'yyyy-MM-dd')
  })()

  useEffect(() => { load() }, [session.id])

  async function load() {
    setLoading(true)

    // 1. Batch numbers from monthly count (this session)
    const { data: mcEntries } = await db
      .from('mc_entries')
      .select('batch_number,section_id,section_name,role,kg')
      .eq('session_id', session.id)
      .not('batch_number', 'is', null)
      .eq('is_no_stock', false)

    // 2. Batch numbers from daily counts this month
    const { data: scSessions } = await db
      .from('sc_sessions')
      .select('id')
      .gte('count_date', dateFrom)
      .lte('count_date', dateTo)
      .not('sup_confirmed_at', 'is', null)

    const scSessionIds = (scSessions ?? []).map((s: any) => s.id)
    let scEntries: any[] = []
    if (scSessionIds.length) {
      const { data } = await db
        .from('sc_entries')
        .select('batch_number,section_id,section_name,role,kg')
        .in('session_id', scSessionIds)
        .not('batch_number', 'is', null)
        .eq('is_no_stock', false)
      scEntries = data ?? []
    }

    // 3. Bag tags for this month
    const { data: bagData } = await db
      .schema('production')
      .from('bag_tags')
      .select('lot_number,section_id,weight_kg')
      .gte('created_at', dateFrom + 'T00:00:00Z')
      .lte('created_at', dateTo   + 'T23:59:59Z')
      .not('lot_number', 'is', null)

    // 4. Quality check — just check for existence by lot number patterns
    //    We do a lightweight check: any pasteuriser or lab run this month
    const allBatchNumbers = new Set([
      ...(mcEntries ?? []).map((e: any) => e.batch_number as string),
      ...scEntries.map((e: any) => e.batch_number as string),
    ])

    // Check quality tables for these batches (limit to reasonable size)
    const batchList = Array.from(allBatchNumbers).slice(0, 50)
    let qualityBatches = new Set<string>()
    if (batchList.length > 0) {
      // Pasteuriser
      const { data: pastQ } = await db
        .from('pasteuriser_runs')
        .select('batch_ref')
        .in('batch_ref', batchList)
      ;(pastQ ?? []).forEach((r: any) => qualityBatches.add(r.batch_ref))

      // Lab results
      const { data: labQ } = await db
        .from('lab_results')
        .select('batch_number')
        .in('batch_number', batchList)
      ;(labQ ?? []).forEach((r: any) => qualityBatches.add(r.batch_number))
    }

    // ── Aggregate ─────────────────────────────────────────────────────────────

    // Monthly count by batch (avg sup + adm)
    const mcByBatch = new Map<string, { sup: number; adm: number; sections: Set<string> }>()
    ;(mcEntries ?? []).forEach((e: any) => {
      const bn = e.batch_number as string
      if (!mcByBatch.has(bn)) mcByBatch.set(bn, { sup: 0, adm: 0, sections: new Set() })
      const rec = mcByBatch.get(bn)!
      if (e.role === 'supervisor') rec.sup += e.kg ?? 0
      else                         rec.adm += e.kg ?? 0
      rec.sections.add(e.section_name ?? e.section_id)
    })

    // Daily count by batch (avg sup + adm) — contributes to counted_kg
    const scByBatch = new Map<string, { sup: number; adm: number; sections: Set<string> }>()
    scEntries.forEach((e: any) => {
      const bn = e.batch_number as string
      if (!scByBatch.has(bn)) scByBatch.set(bn, { sup: 0, adm: 0, sections: new Set() })
      const rec = scByBatch.get(bn)!
      if (e.role === 'supervisor') rec.sup += e.kg ?? 0
      else                         rec.adm += e.kg ?? 0
      rec.sections.add(e.section_name ?? e.section_id)
    })

    // Bag tags by lot number
    const bagByLot = new Map<string, { count: number; kg: number }>()
    ;(bagData ?? []).forEach((b: any) => {
      const lot = b.lot_number as string
      const existing = bagByLot.get(lot) ?? { count: 0, kg: 0 }
      bagByLot.set(lot, { count: existing.count + 1, kg: existing.kg + (b.weight_kg ?? 0) })
    })

    // Merge all batch numbers
    const allKeys = new Set([
      ...Array.from(mcByBatch.keys()),
      ...Array.from(scByBatch.keys()),
      ...Array.from(bagByLot.keys()),
    ])

    const ledgerRows: LedgerRow[] = Array.from(allKeys).map(bn => {
      const mc       = mcByBatch.get(bn)
      const sc       = scByBatch.get(bn)
      const bag      = bagByLot.get(bn)

      // Counted kg: prefer monthly count, fall back to daily count average
      const mcKg     = mc ? (mc.sup + mc.adm) / 2 : 0
      const scKg     = sc ? (sc.sup + sc.adm) / 2 : 0
      const countedKg = mcKg > 0 ? mcKg : scKg

      const bagKg    = bag?.kg ?? 0
      const bagCount = bag?.count ?? 0

      const allSections = new Set([
        ...Array.from(mc?.sections ?? []),
        ...Array.from(sc?.sections ?? []),
      ])

      // Status
      let status: LedgerRow['status'] = 'unlinked'
      if (countedKg > 0 && bagKg > 0) {
        const diff = Math.abs(countedKg - bagKg)
        const pct  = diff / Math.max(countedKg, bagKg) * 100
        status = pct <= 5 ? 'reconciled' : 'variance'
      }

      return {
        batch_number: bn,
        sections:     Array.from(allSections),
        counted_kg:   countedKg,
        bag_count:    bagCount,
        bag_kg:       bagKg,
        has_quality:  qualityBatches.has(bn),
        status,
      }
    }).sort((a, b) => b.counted_kg - a.counted_kg)

    setRows(ledgerRows)
    setLoading(false)
  }

  const FILTER_OPTIONS = [
    { key: 'all',         label: `All (${rows.length})` },
    { key: 'reconciled',  label: `Reconciled (${rows.filter(r => r.status === 'reconciled').length})` },
    { key: 'variance',    label: `Variance (${rows.filter(r => r.status === 'variance').length})` },
    { key: 'unlinked',    label: `Unlinked (${rows.filter(r => r.status === 'unlinked').length})` },
  ] as const

  const displayed = rows.filter(r => {
    const matchesSearch  = !search || r.batch_number.toLowerCase().includes(search.toLowerCase())
    const matchesFilter  = filter === 'all' || r.status === filter
    return matchesSearch && matchesFilter
  })

  if (loading) {
    return <div className="py-12 text-center font-mono text-[12px] text-text-muted animate-pulse">Building batch ledger…</div>
  }

  return (
    <div className="flex gap-4 min-h-0">
      {/* ── Ledger table ─────────────────────────────────────────────────── */}
      <div className={`flex-1 min-w-0 space-y-4 ${panel ? 'hidden lg:block' : ''}`}>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48 max-w-72">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search batch number…"
              className="w-full pl-8 pr-8 py-2 border border-surface-rule rounded-xl font-mono text-[12px] text-text bg-surface-card outline-none focus:border-brand"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted">
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 px-3 py-2 bg-surface-card border border-surface-rule rounded-xl">
            <Link2 size={11} className="text-text-muted" />
            <span className="font-mono text-[11px] text-text-muted">{rows.length} batches</span>
          </div>
        </div>

        {/* Filter strip */}
        <div className="flex gap-1 p-1 bg-surface-card border border-surface-rule rounded-xl w-fit flex-wrap">
          {FILTER_OPTIONS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg font-mono text-[11px] transition-colors ${
                filter === f.key ? 'bg-brand text-white' : 'text-text-muted hover:text-text'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Table */}
        {displayed.length === 0 ? (
          <div className="py-10 text-center font-mono text-[12px] text-text-muted">No batches found</div>
        ) : (
          <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface border-b border-surface-rule">
                  {['Batch Number','Section','Counted kg','Bag Tags','Bag kg','Quality','Status',''].map(h => (
                    <th key={h} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wide text-text-muted whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-rule">
                {displayed.map(r => (
                  <tr
                    key={r.batch_number}
                    onClick={() => setPanel(panel === r.batch_number ? null : r.batch_number)}
                    className={`cursor-pointer transition-colors hover:bg-surface ${panel === r.batch_number ? 'bg-brand/5 border-l-2 border-brand' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono font-bold text-[12px] text-text">{r.batch_number}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-text-muted max-w-[140px] truncate">
                      {r.sections.slice(0, 2).join(', ')}{r.sections.length > 2 ? ` +${r.sections.length - 2}` : ''}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-text">
                      {r.counted_kg > 0 ? `${r.counted_kg.toFixed(1)} kg` : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-text-muted">
                      {r.bag_count > 0 ? r.bag_count : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-text-muted">
                      {r.bag_kg > 0 ? `${r.bag_kg.toFixed(1)} kg` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {r.has_quality ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-md bg-purple-50 text-purple-600">
                          <FlaskConical size={9}/> Quality
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-text-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusChip status={r.status} /></td>
                    <td className="px-4 py-3">
                      <ChevronRight size={13} className={`text-text-muted transition-transform ${panel === r.batch_number ? 'rotate-180' : ''}`}/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Batch Intelligence side panel ─────────────────────────────────── */}
      {panel && (
        <div className="w-full lg:w-[420px] flex-shrink-0 border border-surface-rule rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: 700 }}>
          <BatchReconciliationPanel
            batchNumber={panel}
            monthContext={monthStr}
            mode="inline"
            onClose={() => setPanel(null)}
          />
        </div>
      )}
    </div>
  )
}
