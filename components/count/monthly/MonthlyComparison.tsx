'use client'

import { useState, useEffect } from 'react'
import { getDb } from '@/lib/supabase/db'
import { CheckCircle2, AlertTriangle, Download } from 'lucide-react'
import type { McSession } from './MonthlyCountForm'

interface EntryRow {
  section_id:     string
  section_name:   string
  inventory_code: string
  item_name:      string
  batch_number:   string | null
  role:           string
  kg:             number
  bags_qty:       number
  is_no_stock:    boolean
}

interface CompareItem {
  section_id:   string
  section_name: string
  item_name:    string
  inv_code:     string
  batch:        string | null
  sup_kg:       number
  adm_kg:       number
  variance_kg:  number
  variance_pct: number
}

function varianceChip(pct: number, noSupAdm: boolean) {
  if (noSupAdm) return <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-surface text-text-muted">No stock</span>
  if (pct <= 2)  return <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-ok/10 text-ok font-bold">Match</span>
  if (pct <= 10) return <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-warn/10 text-warn font-bold">{pct.toFixed(1)}%</span>
  return <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-err/10 text-err font-bold">{pct.toFixed(1)}%</span>
}

export default function MonthlyComparison({ session }: { session: McSession }) {
  const db = getDb()
  const [loading,  setLoading]  = useState(true)
  const [rows,     setRows]     = useState<CompareItem[]>([])
  const [filter,   setFilter]   = useState<'all'|'variances'>('variances')

  useEffect(() => { load() }, [session.id])

  async function load() {
    setLoading(true)
    const { data } = await db
      .from('mc_entries')
      .select('section_id,section_name,inventory_code,item_name,batch_number,role,kg,bags_qty,is_no_stock')
      .eq('session_id', session.id)
      .order('section_id')
      .order('inventory_code')
      .order('batch_number')

    const entries = (data ?? []) as EntryRow[]

    // Group by inventory_code + batch_number
    const map = new Map<string, CompareItem>()
    entries.forEach(e => {
      const k = `${e.inventory_code}::${e.batch_number ?? '__ns__'}`
      if (!map.has(k)) {
        map.set(k, {
          section_id:   e.section_id,
          section_name: e.section_name ?? e.section_id,
          item_name:    e.item_name ?? e.inventory_code,
          inv_code:     e.inventory_code,
          batch:        e.batch_number,
          sup_kg:       0,
          adm_kg:       0,
          variance_kg:  0,
          variance_pct: 0,
        })
      }
      const item = map.get(k)!
      if (e.role === 'supervisor') item.sup_kg += e.kg
      else                         item.adm_kg += e.kg
    })

    const compared = Array.from(map.values()).map(item => {
      const maxKg = Math.max(item.sup_kg, item.adm_kg)
      const diff  = Math.abs(item.sup_kg - item.adm_kg)
      return {
        ...item,
        variance_kg:  diff,
        variance_pct: maxKg > 0 ? (diff / maxKg) * 100 : 0,
      }
    })

    setRows(compared)
    setLoading(false)
  }

  function exportCSV() {
    const header = 'Section,Item,Batch,Supervisor kg,Admin kg,Variance kg,Variance %'
    const lines  = rows.map(r =>
      [
        r.section_name, `"${r.item_name}"`, r.batch ?? '—',
        r.sup_kg.toFixed(3), r.adm_kg.toFixed(3),
        r.variance_kg.toFixed(3), r.variance_pct.toFixed(2),
      ].join(',')
    )
    const csv  = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `monthly-count-comparison-${session.count_month}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const displayed   = filter === 'variances' ? rows.filter(r => r.variance_pct > 2) : rows
  const matchCount  = rows.filter(r => r.variance_pct <= 2).length
  const flagCount   = rows.filter(r => r.variance_pct > 2).length
  const matchRate   = rows.length > 0 ? Math.round((matchCount / rows.length) * 100) : 0

  if (loading) {
    return <div className="py-12 text-center font-mono text-[12px] text-text-muted animate-pulse">Loading comparison…</div>
  }

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Match Rate',    value: `${matchRate}%`,           color: matchRate >= 90 ? 'text-ok' : matchRate >= 75 ? 'text-warn' : 'text-err' },
          { label: 'Items Matched', value: matchCount,                 color: 'text-ok' },
          { label: 'Variances',     value: flagCount,                  color: flagCount > 0 ? 'text-warn' : 'text-text' },
          { label: 'Total Items',   value: rows.length,                color: 'text-text' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface-card border border-surface-rule rounded-2xl px-4 py-3">
            <div className={`font-display font-bold text-[24px] ${color}`}>{value}</div>
            <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex border border-surface-rule rounded-xl overflow-hidden">
          {([
            { key: 'variances', label: `Variances (${flagCount})` },
            { key: 'all',       label: 'All Items' },
          ] as const).map((f, i) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-4 py-2 font-body text-[13px] font-medium transition-colors ${i > 0 ? 'border-l border-surface-rule' : ''} ${filter === f.key ? 'bg-brand text-white' : 'bg-surface-card text-text-muted hover:text-text'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={exportCSV} className="flex items-center gap-1.5 text-xs text-ok font-semibold hover:underline">
          <Download size={12} /> Export CSV
        </button>
      </div>

      {/* Table */}
      {displayed.length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <CheckCircle2 size={28} className="text-ok mx-auto" />
          <p className="font-mono text-[12px] text-text-muted">
            {filter === 'variances' ? 'No variances — all items match within 2%' : 'No entries found'}
          </p>
        </div>
      ) : (
        <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface border-b border-surface-rule">
                  {['Section','Item','Batch','Supervisor','Admin','Variance',''].map(h => (
                    <th key={h} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wide text-text-muted whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-rule">
                {displayed.map((r, i) => (
                  <tr key={i} className="hover:bg-surface transition-colors">
                    <td className="px-4 py-3 font-mono text-[11px] text-text-muted">{r.section_name}</td>
                    <td className="px-4 py-3 font-body text-[13px] text-text font-medium">{r.item_name}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-text-muted">{r.batch ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-text">{r.sup_kg.toFixed(1)} kg</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-text">{r.adm_kg.toFixed(1)} kg</td>
                    <td className="px-4 py-3 font-mono text-[12px]">
                      {r.variance_kg > 0
                        ? <span className={r.variance_pct > 10 ? 'text-err font-bold' : 'text-warn font-bold'}>
                            {r.variance_kg.toFixed(1)} kg
                          </span>
                        : <span className="text-ok">—</span>
                      }
                    </td>
                    <td className="px-4 py-3">{varianceChip(r.variance_pct, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
