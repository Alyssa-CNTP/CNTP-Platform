'use client'

// CaptureOverview — grouped by product with expandable rows and filters.
// Operators see grouped totals (product + lot + variant + grade = one row).
// Each group expands to show individual bags with serial, weight, and time.
// IT/supervisors see the same grouped view; individual rows always expandable.

import React, { useState, useMemo } from 'react'
import { Printer, Copy, CheckCircle2, AlertTriangle, Package, PackageCheck, ChevronDown, ChevronRight, Filter, X } from 'lucide-react'
import { sievingTotals, type SievingData } from '@/components/production/capture/SievingCapture'
import { MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'

interface Production { id: string; variant: string; grade: string; lot: string; data: SievingData }

const num = (v: any): number => parseFloat(String(v).replace(',', '.')) || 0
const DEBAG_BLUE  = '#1d4ed8'
const BAG_ORANGE  = '#d97706'

// ── Flat bag row (individual) ─────────────────────────────────────────────────
interface FlatBag {
  product: string; lot: string; kg: number; variant: string; grade: string
  serial: string; loggedAt?: string; prodIdx: number; bagIdx: number
}

// ── Grouped row (one per product+lot+variant+grade) ───────────────────────────
interface GroupedBag {
  key: string; product: string; lot: string; kg: number; variant: string; grade: string
  count: number; bags: FlatBag[]
}

function buildBagGroups(prods: Production[]): GroupedBag[] {
  const map = new Map<string, GroupedBag>()
  prods.forEach((p, pi) => {
    ;(p.data.outputs ?? []).forEach((b, bi) => {
      if (num(b.weight) === 0) return
      const lot   = (b.batch || p.lot || '—').trim()
      const grade = (b.destination || p.grade || '—').trim()
      const key   = `${(b.productType ?? '').trim()}||${lot}||${(p.variant ?? '').trim()}||${grade}`
      const flat: FlatBag = { product: b.productType, lot, kg: num(b.weight), variant: p.variant, grade, serial: b.serial, loggedAt: b.logged_at, prodIdx: pi, bagIdx: bi }
      const g = map.get(key)
      if (g) { g.kg += num(b.weight); g.count++; g.bags.push(flat) }
      else    map.set(key, { key, product: b.productType, lot, kg: num(b.weight), variant: p.variant, grade, count: 1, bags: [flat] })
    })
  })
  return Array.from(map.values())
}

function debagRows(prods: Production[]) {
  const rows: { bagNo: string; lot: string; kg: number; variant: string }[] = []
  prods.forEach(p => (p.data.debag ?? []).forEach((r, i) => {
    if (num(r.nett) === 0) return
    rows.push({ bagNo: r.bag_no || `Bulk bag ${i + 1}`, lot: r.lot || p.lot || '—', kg: num(r.nett), variant: p.variant })
  }))
  return rows
}

function Cell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-[12px] ${className}`}>{children}</td>
}

// Display a logged-at timestamp in SAST.
const fmtTime = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : ''

export function CaptureOverview({ productions, sectionName, sectionColor, date, shift, showSerials = false }: {
  productions: Production[]; sectionName: string; sectionColor: string; date: string; shift: string; showSerials?: boolean
}) {
  const [copied,   setCopied]   = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [filterProduct, setFilterProduct] = useState('')
  const [filterVariant, setFilterVariant] = useState('')
  const [filterGrade,   setFilterGrade]   = useState('')
  const [showFilters,   setShowFilters]   = useState(false)

  const ins    = debagRows(productions)
  const groups = useMemo(() => buildBagGroups(productions), [productions])

  const totals = productions.reduce((acc, p) => {
    const t = sievingTotals(p.data)
    return { totalIn: acc.totalIn + t.totalIn, totalOut: acc.totalOut + t.totalOut, spillage: acc.spillage + t.spillage }
  }, { totalIn: 0, totalOut: 0, spillage: 0 })

  const variance   = totals.totalIn - totals.totalOut
  const withinTol  = Math.abs(variance) <= MASS_BALANCE_TOLERANCE_KG
  const hasData    = ins.length > 0 || groups.length > 0

  // Filter groups
  const filteredGroups = groups.filter(g => {
    if (filterProduct && !g.product.toLowerCase().includes(filterProduct.toLowerCase())) return false
    if (filterVariant && g.variant !== filterVariant) return false
    if (filterGrade   && g.grade !== filterGrade)     return false
    return true
  })

  const activeFilters = [filterProduct, filterVariant, filterGrade].filter(Boolean).length
  const uniqueVariants = Array.from(new Set(groups.map(g => g.variant).filter(Boolean)))
  const uniqueGrades   = Array.from(new Set(groups.map(g => g.grade).filter(Boolean)))

  function toggleExpand(key: string) {
    setExpanded(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  function expandAll()   { setExpanded(new Set(filteredGroups.map(g => g.key))) }
  function collapseAll() { setExpanded(new Set()) }
  function clearFilters() { setFilterProduct(''); setFilterVariant(''); setFilterGrade('') }

  function handleCopy() {
    const lines = [`CNTP — ${sectionName}`, `${date} · ${shift} shift`, '',
      'Product\tLot\tVariant\tGrade\tBags\tWeight']
    filteredGroups.forEach(g => lines.push(`${g.product}\t${g.lot}\t${g.variant}\t${g.grade}\t${g.count}\t${g.kg.toFixed(1)}`))
    lines.push('', `Total in\t${totals.totalIn.toFixed(1)} kg`, `Total out\t${totals.totalOut.toFixed(1)} kg`, `Variance\t${variance.toFixed(1)} kg`)
    navigator.clipboard.writeText(lines.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div className="rounded-2xl border border-stone-200 overflow-hidden bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-stone-50 border-b border-stone-200">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sectionColor }} />
          <div className="min-w-0">
            <p className="font-semibold text-[13px] text-stone-800 truncate">{sectionName} — what you captured</p>
            <p className="font-mono text-[10px] text-stone-400">{date} · <span className="capitalize">{shift}</span> shift</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setShowFilters(f => !f)}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-medium transition-colors
              ${showFilters || activeFilters > 0 ? 'border-brand text-brand bg-brand/5' : 'border-stone-200 text-stone-500 hover:border-brand hover:text-brand'}`}>
            <Filter size={12} /> Filter
            {activeFilters > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-brand text-white text-[9px] font-bold flex items-center justify-center">{activeFilters}</span>
            )}
          </button>
          <button onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-500 hover:border-brand hover:text-brand transition-colors">
            {copied ? <CheckCircle2 size={12} className="text-ok" /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-500 hover:border-brand hover:text-brand transition-colors">
            <Printer size={12} /> Print
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="px-5 py-3 bg-stone-50 border-b border-stone-100 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input value={filterProduct} onChange={e => setFilterProduct(e.target.value)} placeholder="Filter product…"
              className="px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-[12px] outline-none focus:border-brand w-40" />
            <select value={filterVariant} onChange={e => setFilterVariant(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-stone-200 bg-white text-[12px] outline-none focus:border-brand cursor-pointer">
              <option value="">All variants</option>
              {uniqueVariants.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-stone-200 bg-white text-[12px] outline-none focus:border-brand cursor-pointer">
              <option value="">All grades</option>
              {uniqueGrades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            {activeFilters > 0 && (
              <button onClick={clearFilters} className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-err px-2 py-1.5 rounded-lg">
                <X size={12} /> Clear
              </button>
            )}
          </div>
          {filteredGroups.length > 0 && (
            <div className="flex gap-3">
              <button onClick={expandAll}   className="text-[11px] text-brand hover:underline">Expand all</button>
              <button onClick={collapseAll} className="text-[11px] text-stone-400 hover:underline">Collapse all</button>
            </div>
          )}
        </div>
      )}

      <div className="p-4 space-y-4">
        {!hasData ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Package size={22} className="text-stone-300" />
            <p className="text-[12px] text-stone-400">Nothing captured yet — add debagging and bagging in the Capture step first.</p>
          </div>
        ) : (
          <>
            {/* Debagging — blue (in) */}
            {ins.length > 0 && (
              <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: DEBAG_BLUE + '40' }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ background: DEBAG_BLUE + '12' }}>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: DEBAG_BLUE }}><Package size={14} /> Debagging — in</span>
                  <span className="font-mono font-bold text-[13px]" style={{ color: DEBAG_BLUE }}>{totals.totalIn.toFixed(1)} kg</span>
                </div>
                <table className="w-full border-collapse">
                  <thead><tr className="border-b border-stone-100 text-left text-[9px] font-bold uppercase tracking-wide text-stone-400">
                    <Cell>Bag no.</Cell><Cell>Lot / serial</Cell><Cell>Variant</Cell><Cell className="text-right">Weight</Cell>
                  </tr></thead>
                  <tbody>
                    {ins.map((r, i) => (
                      <tr key={i} className="border-b border-stone-50 last:border-0">
                        <Cell className="font-medium text-stone-800">{r.bagNo}</Cell>
                        <Cell className="font-mono text-stone-600">{r.lot}</Cell>
                        <Cell className="text-stone-600">{r.variant}</Cell>
                        <Cell className="text-right font-mono font-bold text-stone-800">{r.kg.toFixed(1)} kg</Cell>
                      </tr>
                    ))}
                    {totals.spillage > 0 && (
                      <tr className="border-t border-stone-100">
                        <Cell className="text-stone-500 font-medium">Bucket elevator</Cell><Cell /><Cell className="text-stone-400">incl. in balance</Cell>
                        <Cell className="text-right font-mono text-stone-600">{totals.spillage.toFixed(1)} kg</Cell>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Bagging — orange (out), grouped with expand */}
            {groups.length > 0 && (
              <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: BAG_ORANGE + '40' }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ background: BAG_ORANGE + '12' }}>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: BAG_ORANGE }}><PackageCheck size={14} /> Bagging — out</span>
                  <span className="font-mono font-bold text-[13px]" style={{ color: BAG_ORANGE }}>
                    {totals.totalOut.toFixed(1)} kg · {groups.reduce((s, g) => s + g.count, 0)} bag{groups.reduce((s, g) => s + g.count, 0) !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Filter result count */}
                {activeFilters > 0 && filteredGroups.length !== groups.length && (
                  <div className="px-3 py-1.5 bg-brand/5 border-b border-brand/10 text-[11px] text-brand">
                    Showing {filteredGroups.length} of {groups.length} product groups
                  </div>
                )}

                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-[9px] font-bold uppercase tracking-wide text-stone-400">
                      <Cell className="w-6"></Cell>
                      <Cell>Product</Cell><Cell>Lot / batch</Cell><Cell>Variant</Cell><Cell>Grade</Cell>
                      <Cell className="text-right">Bags</Cell><Cell className="text-right">Weight</Cell>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGroups.map(g => {
                      const isOpen = expanded.has(g.key)
                      return (
                        <React.Fragment key={g.key}>
                          {/* Grouped row */}
                          <tr
                            onClick={() => toggleExpand(g.key)}
                            className="border-b border-stone-100 cursor-pointer hover:bg-stone-50 transition-colors"
                            style={isOpen ? { background: BAG_ORANGE + '08' } : undefined}>
                            <Cell>
                              {isOpen
                                ? <ChevronDown size={13} className="text-stone-400" />
                                : <ChevronRight size={13} className="text-stone-400" />}
                            </Cell>
                            <Cell className="font-semibold text-stone-800">{g.product}</Cell>
                            <Cell className="font-mono text-stone-600">{g.lot}</Cell>
                            <Cell className="text-stone-600">{g.variant}</Cell>
                            <Cell className="text-stone-600">{g.grade}</Cell>
                            <Cell className="text-right font-mono font-bold text-stone-700">{g.count}</Cell>
                            <Cell className="text-right font-mono font-bold text-stone-800">{g.kg.toFixed(1)} kg</Cell>
                          </tr>

                          {/* Expanded individual bag rows */}
                          {isOpen && g.bags.map((b, bi) => (
                            <tr key={`${g.key}-${bi}`} className="border-b border-stone-50 last:border-0" style={{ background: BAG_ORANGE + '05' }}>
                              <Cell></Cell>
                              <Cell className="text-stone-500 pl-5">
                                <span className="text-[10px]">↳ bag {bi + 1}</span>
                                {(showSerials || true) && b.serial && (
                                  <div className="font-mono text-[10px] text-stone-400 mt-0.5">{b.serial}</div>
                                )}
                              </Cell>
                              <Cell className="font-mono text-[11px] text-stone-500">{b.lot}</Cell>
                              <Cell className="text-[11px] text-stone-500">{b.variant}</Cell>
                              <Cell className="text-[11px] text-stone-500">{b.grade}</Cell>
                              <Cell className="text-right text-stone-400">
                                {b.loggedAt && <span className="font-mono text-[10px]">{fmtTime(b.loggedAt)}</span>}
                              </Cell>
                              <Cell className="text-right font-mono text-[12px] font-medium text-stone-700">{b.kg.toFixed(1)} kg</Cell>
                            </tr>
                          ))}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Mass balance */}
            <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-[12px] font-mono ${withinTol ? 'bg-ok/5 border-ok/30' : 'bg-warn/5 border-warn/30'}`}>
              <span className="text-stone-500">In {totals.totalIn.toFixed(1)} − Out {totals.totalOut.toFixed(1)} =</span>
              <span className="inline-flex items-center gap-1.5 font-bold text-[13px]">
                <span className={withinTol ? 'text-ok' : 'text-warn'}>{variance > 0 ? '+' : ''}{variance.toFixed(1)} kg</span>
                {withinTol ? <CheckCircle2 size={14} className="text-ok" /> : <AlertTriangle size={14} className="text-warn" />}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default CaptureOverview
