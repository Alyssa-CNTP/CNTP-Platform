'use client'

// CaptureOverview — hierarchical production summary.
// Debagging: grouped by lot with subtotals, bucket elevator + machine spillage rows,
//            total excl. and incl. spillage.
// Bagging: 3-level hierarchy (product → lot → individual bag), expandable at each level.
// Machine spillage is entered here (not in capture) and is session-level.
// Combined totals merge both shifts when same variant+grade+lot are passed in.

import React, { useState, useMemo } from 'react'
import { Printer, Copy, CheckCircle2, AlertTriangle, Package, PackageCheck,
  ChevronDown, ChevronRight, Filter, X, Scale, Hash } from 'lucide-react'
import { sievingTotals, type SievingData } from '@/components/production/capture/SievingCapture'
import { type RefiningData } from '@/components/production/capture/RefiningCapture'
import { MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'

interface Production { id: string; variant: string; grade: string; lot: string; data: SievingData | RefiningData }

const num = (v: any): number => parseFloat(String(v).replace(',', '.')) || 0
const DEBAG_BLUE  = '#1d4ed8'
const BAG_ORANGE  = '#d97706'

// ── Data types ────────────────────────────────────────────────────────────────

interface DebagRow { bagNo: string; kg: number; variant: string; loggedAt?: string }
interface DebagLotGroup { lot: string; rows: DebagRow[]; totalKg: number }

interface FlatBag {
  product: string; lot: string; kg: number; variant: string; grade: string
  serial: string; loggedAt?: string; description?: string
}
interface BagLotGroup { lot: string; variant: string; grade: string; bags: FlatBag[]; count: number; kg: number }
interface ProductGroup { product: string; acumaticaCode?: string | null; acumaticaDesc?: string; lots: BagLotGroup[]; totalCount: number; totalKg: number }

// ── Grouping functions ────────────────────────────────────────────────────────

function buildDebagLotGroups(prods: Production[]): { groups: DebagLotGroup[]; bucketKg: number; machineKg: number } {
  const map = new Map<string, DebagLotGroup>()
  let bucketKg = 0
  let machineKg = 0
  prods.forEach(p => {
    const d = p.data as any
    if ('inputs' in d) {
      // RefiningData: inputs array, no spillage
      ;(d.inputs ?? []).forEach((r: any, i: number) => {
        if (num(r.weight) === 0) return
        const lot = (r.lot || p.lot || '—').trim()
        const row: DebagRow = { bagNo: r.serial || `Input bag ${i + 1}`, kg: num(r.weight), variant: p.variant, loggedAt: r.logged_at }
        const g = map.get(lot)
        if (g) { g.rows.push(row); g.totalKg += num(r.weight) }
        else map.set(lot, { lot, rows: [row], totalKg: num(r.weight) })
      })
    } else {
      // SievingData: debag + spillage
      ;(d.spillage ?? []).forEach((r: any, i: number) => {
        if (num(r.kg) > 0) {
          if (i === 0) bucketKg += num(r.kg)
          else         machineKg += num(r.kg)
        }
      })
      ;(d.debag ?? []).forEach((r: any, i: number) => {
        if (num(r.nett) === 0) return
        const lot = (r.lot || p.lot || '—').trim()
        const row: DebagRow = { bagNo: r.bag_no || `Bulk bag ${i + 1}`, kg: num(r.nett), variant: p.variant, loggedAt: r.logged_at }
        const g = map.get(lot)
        if (g) { g.rows.push(row); g.totalKg += num(r.nett) }
        else map.set(lot, { lot, rows: [row], totalKg: num(r.nett) })
      })
    }
  })
  return { groups: Array.from(map.values()), bucketKg, machineKg }
}

function buildProductGroups(prods: Production[]): ProductGroup[] {
  const prodMap = new Map<string, ProductGroup>()

  function addBag(p: Production, b: { productType: string; weight: string; batch?: string; destination?: string; serial: string; logged_at?: string; description?: string; code?: string | null }) {
    if (num(b.weight) === 0) return
    const lot   = (b.batch || p.lot || '—').trim()
    const grade = (b.destination || p.grade || '—').trim()
    const flat: FlatBag = { product: b.productType, lot, kg: num(b.weight), variant: p.variant, grade, serial: b.serial, loggedAt: b.logged_at, description: b.description }
    let pg = prodMap.get(b.productType)
    if (!pg) { pg = { product: b.productType, acumaticaCode: b.code ?? null, acumaticaDesc: b.description, lots: [], totalCount: 0, totalKg: 0 }; prodMap.set(b.productType, pg) }
    if (!pg.acumaticaDesc && b.description) pg.acumaticaDesc = b.description
    if (!pg.acumaticaCode && b.code)        pg.acumaticaCode = b.code ?? null
    pg.totalCount++; pg.totalKg += num(b.weight)
    const lotKey = `${lot}||${p.variant}||${grade}`
    let lg = pg.lots.find(l => `${l.lot}||${l.variant}||${l.grade}` === lotKey)
    if (!lg) { lg = { lot, variant: p.variant, grade, bags: [], count: 0, kg: 0 }; pg.lots.push(lg) }
    lg.bags.push(flat); lg.count++; lg.kg += num(b.weight)
  }

  prods.forEach((p) => {
    const d = p.data as any
    if ('inputs' in d) {
      // RefiningData: outputB/C/D groups each have a bags array
      ;[d.outputB, d.outputC, d.outputD].forEach((grp: any) => {
        if (!grp) return
        ;(grp.bags ?? []).forEach((b: any) => addBag(p, { ...b, productType: grp.productType ?? grp.label, code: grp.code, description: grp.description }))
      })
    } else {
      // SievingData: flat outputs array
      ;(d.outputs ?? []).forEach((b: any) => addBag(p, b))
    }
  })
  return Array.from(prodMap.values())
}

function formatPO(po: any): string {
  if (!po) return ''
  if (typeof po === 'string') return po.trim()
  if (Array.isArray(po)) return po.join(', ')
  return JSON.stringify(po)
}

const fmtTime = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : ''

// ── Main component ────────────────────────────────────────────────────────────

export function CaptureOverview({
  productions, sectionName, sectionColor, date, shift, showSerials = false,
  productionOrders, locked = false,
}: {
  productions: Production[]; sectionName: string; sectionColor: string; date: string; shift: string; showSerials?: boolean
  productionOrders?: any; locked?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [expandedProducts,  setExpandedProducts]  = useState<Set<string>>(new Set())
  const [expandedLots,      setExpandedLots]      = useState<Set<string>>(new Set())
  const [expandedDebagLots, setExpandedDebagLots] = useState<Set<string>>(new Set())
  const [filterProduct, setFilterProduct] = useState('')
  const [filterVariant, setFilterVariant] = useState('')
  const [filterGrade,   setFilterGrade]   = useState('')
  const [showFilters,   setShowFilters]   = useState(false)

  const { groups: debagGroups, bucketKg, machineKg } = useMemo(() => buildDebagLotGroups(productions), [productions])
  const productGroups = useMemo(() => buildProductGroups(productions), [productions])

  const debagOnlyKg   = debagGroups.reduce((s, g) => s + g.totalKg, 0)
  const totalIncl     = debagOnlyKg + bucketKg + machineKg
  const totalOut      = productGroups.reduce((s, g) => s + g.totalKg, 0)
  const totalBags     = productGroups.reduce((s, g) => s + g.totalCount, 0)
  const variance      = totalOut - totalIncl
  const withinTol     = Math.abs(variance) <= MASS_BALANCE_TOLERANCE_KG
  const hasData       = debagGroups.length > 0 || productGroups.length > 0
  const poStr         = formatPO(productionOrders)

  const filteredProducts = productGroups.filter(g => {
    if (filterProduct && !g.product.toLowerCase().includes(filterProduct.toLowerCase())) return false
    if (filterVariant && !g.lots.some(l => l.variant === filterVariant)) return false
    if (filterGrade   && !g.lots.some(l => l.grade   === filterGrade))   return false
    return true
  })
  const activeFilters  = [filterProduct, filterVariant, filterGrade].filter(Boolean).length
  const uniqueVariants = Array.from(new Set(productGroups.flatMap(g => g.lots.map(l => l.variant)).filter(Boolean)))
  const uniqueGrades   = Array.from(new Set(productGroups.flatMap(g => g.lots.map(l => l.grade)).filter(Boolean)))

  const toggleProduct  = (k: string) => setExpandedProducts(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleLot      = (k: string) => setExpandedLots(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleDebagLot = (k: string) => setExpandedDebagLots(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const clearFilters   = () => { setFilterProduct(''); setFilterVariant(''); setFilterGrade('') }

  function handleCopy() {
    const lines = [`CNTP — ${sectionName}`, `${date} · ${shift} shift`]
    if (poStr) lines.push(`Production Order: ${poStr}`)
    lines.push('', 'DEBAGGING', 'Lot\tBag No\tVariant\tWeight (kg)')
    debagGroups.forEach(g => {
      g.rows.forEach(r => lines.push(`${g.lot}\t${r.bagNo}\t${r.variant}\t${r.kg.toFixed(1)}`))
      if (g.rows.length > 1) lines.push(`Subtotal ${g.lot}\t\t\t${g.totalKg.toFixed(1)}`)
    })
    if (bucketKg > 0 || machineKg > 0) {
      lines.push(`Total debagging (excl. spillage)\t\t\t${debagOnlyKg.toFixed(1)}`)
      if (bucketKg > 0) lines.push(`Bucket elevator spillage\t\t\t${bucketKg.toFixed(1)}`)
      if (machineKg > 0) lines.push(`Machine spillage\t\t\t${machineKg.toFixed(1)}`)
    }
    lines.push(`Total incl. spillage\t\t\t${totalIncl.toFixed(1)}`)
    lines.push('', 'BAGGING', 'Product\tLot\tVariant\tGrade\tBags\tWeight (kg)')
    productGroups.forEach(g => {
      g.lots.forEach(l => lines.push(`${g.product}\t${l.lot}\t${l.variant}\t${l.grade}\t${l.count}\t${l.kg.toFixed(1)}`))
      if (g.lots.length > 1) lines.push(`Total ${g.product}\t\t\t\t${g.totalCount}\t${g.totalKg.toFixed(1)}`)
    })
    lines.push('', `Total out\t\t\t\t${totalBags}\t${totalOut.toFixed(1)}`)
    lines.push(`Balance (out − in)\t\t\t\t\t${variance > 0 ? '+' : ''}${variance.toFixed(1)}`)
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
        <div className="px-5 py-3 bg-stone-50 border-b border-stone-100">
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
        </div>
      )}

      <div className="p-4 space-y-4">

        {/* Production order */}
        {poStr && (
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl">
            <Hash size={13} className="text-stone-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest">Production Order</p>
              <p className="text-[13px] font-mono font-medium text-stone-800">{poStr}</p>
            </div>
          </div>
        )}

        {!hasData ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Package size={22} className="text-stone-300" />
            <p className="text-[12px] text-stone-400">Nothing captured yet — add debagging and bagging in the Capture step first.</p>
          </div>
        ) : (
          <>
            {/* ── Debagging — in ──────────────────────────────────────────────── */}
            {(debagGroups.length > 0 || bucketKg > 0) && (
              <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: DEBAG_BLUE + '40' }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ background: DEBAG_BLUE + '12' }}>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: DEBAG_BLUE }}>
                    <Package size={14} /> Debagging — in
                  </span>
                  <span className="font-mono font-bold text-[13px]" style={{ color: DEBAG_BLUE }}>{totalIncl.toFixed(1)} kg</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse min-w-[420px]">
                    <thead>
                      <tr className="border-b border-stone-100 text-left text-[9px] font-bold uppercase tracking-wide text-stone-400">
                        <td className="px-3 py-2 w-7"></td>
                        <td className="px-3 py-2">Lot / Batch</td>
                        <td className="px-3 py-2">Bag No.</td>
                        <td className="px-3 py-2">Variant</td>
                        <td className="px-3 py-2 text-right">Nett (kg)</td>
                      </tr>
                    </thead>
                    <tbody>
                      {debagGroups.map(g => {
                        const open = expandedDebagLots.has(g.lot)
                        return (
                          <React.Fragment key={g.lot}>
                            <tr onClick={() => toggleDebagLot(g.lot)}
                              className="border-b border-stone-100 cursor-pointer hover:bg-stone-50 transition-colors"
                              style={open ? { background: DEBAG_BLUE + '06' } : undefined}>
                              <td className="px-3 py-2 w-7">
                                {open
                                  ? <ChevronDown size={13} className="text-stone-400" />
                                  : <ChevronRight size={13} className="text-stone-400" />}
                              </td>
                              <td className="px-3 py-2 font-semibold text-[13px] text-stone-800">{g.lot}</td>
                              <td className="px-3 py-2 text-[11px] text-stone-400">{g.rows.length} bag{g.rows.length !== 1 ? 's' : ''}</td>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-[13px] text-stone-800">{g.totalKg.toFixed(1)} kg</td>
                            </tr>
                            {open && g.rows.map((r, ri) => (
                              <tr key={ri} className="border-b border-stone-50 last:border-0" style={{ background: DEBAG_BLUE + '04' }}>
                                <td className="px-3 py-2"></td>
                                <td className="px-3 py-2 pl-7 text-stone-400 text-[11px]">↳</td>
                                <td className="px-3 py-2 font-mono text-[12px] text-stone-700">{r.bagNo}</td>
                                <td className="px-3 py-2 text-[11px] text-stone-500">{r.variant}</td>
                                <td className="px-3 py-2 text-right font-mono text-[12px] text-stone-700">
                                  {r.kg.toFixed(1)} kg
                                  {r.loggedAt && <span className="ml-1.5 text-[10px] text-stone-400">{fmtTime(r.loggedAt)}</span>}
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        )
                      })}

                      {/* Total excl. spillage separator */}
                      {(bucketKg > 0 || machineKg > 0) && debagGroups.length > 0 && (
                        <tr className="border-t-2 border-stone-200">
                          <td className="px-3 py-2"></td>
                          <td colSpan={3} className="px-3 py-2 text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Total debagging (excl. spillage)</td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-stone-800">{debagOnlyKg.toFixed(1)} kg</td>
                        </tr>
                      )}

                      {/* Bucket elevator */}
                      {bucketKg > 0 && (
                        <tr className="border-t border-stone-100" style={{ background: '#f59e0b0d' }}>
                          <td className="px-3 py-2"></td>
                          <td colSpan={3} className="px-3 py-2 text-[12px] font-medium text-amber-700">
                            <Scale size={12} className="inline mr-1.5 mb-0.5 text-amber-500" />
                            Bucket elevator spillage
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[12px] font-medium text-amber-700">{bucketKg.toFixed(1)} kg</td>
                        </tr>
                      )}

                      {/* Machine spillage — captured in the Debagging step, shown here */}
                      <tr className="border-t border-stone-100" style={{ background: '#f59e0b08' }}>
                        <td className="px-3 py-2"></td>
                        <td colSpan={3} className="px-3 py-2 text-[12px] font-medium text-amber-700">
                          <Scale size={12} className="inline mr-1.5 mb-0.5 text-amber-500" />
                          Machine spillage
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[12px] font-medium text-amber-700">
                          {machineKg > 0 ? `${machineKg.toFixed(1)} kg` : <span className="text-stone-400 font-normal">—</span>}
                        </td>
                      </tr>

                      {/* Total incl. spillage */}
                      <tr className="border-t-2 border-stone-300" style={{ background: DEBAG_BLUE + '08' }}>
                        <td className="px-3 py-2.5"></td>
                        <td colSpan={3} className="px-3 py-2.5 font-bold text-[12px] text-stone-800 uppercase tracking-wide">Total incl. spillage</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-[14px] text-stone-900">{totalIncl.toFixed(1)} kg</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Bagging — out ───────────────────────────────────────────────── */}
            {productGroups.length > 0 && (
              <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: BAG_ORANGE + '40' }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ background: BAG_ORANGE + '12' }}>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: BAG_ORANGE }}>
                    <PackageCheck size={14} /> Bagging — out
                  </span>
                  <span className="font-mono font-bold text-[13px]" style={{ color: BAG_ORANGE }}>
                    {totalOut.toFixed(1)} kg · {totalBags} bag{totalBags !== 1 ? 's' : ''}
                  </span>
                </div>

                {activeFilters > 0 && filteredProducts.length !== productGroups.length && (
                  <div className="px-3 py-1.5 bg-brand/5 border-b border-brand/10 text-[11px] text-brand">
                    Showing {filteredProducts.length} of {productGroups.length} products
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse min-w-[480px]">
                    <thead>
                      <tr className="border-b border-stone-100 text-left text-[9px] font-bold uppercase tracking-wide text-stone-400">
                        <td className="px-3 py-2 w-7"></td>
                        <td className="px-3 py-2">Product</td>
                        <td className="px-3 py-2">Lot / Batch</td>
                        <td className="px-3 py-2">Variant</td>
                        <td className="px-3 py-2">Grade</td>
                        <td className="px-3 py-2 text-right">Bags</td>
                        <td className="px-3 py-2 text-right">Weight</td>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map(pg => {
                        const isProdOpen = expandedProducts.has(pg.product)
                        return (
                          <React.Fragment key={pg.product}>
                            {/* Product row */}
                            <tr onClick={() => toggleProduct(pg.product)}
                              className="border-b border-stone-200 cursor-pointer hover:opacity-90 transition-opacity font-semibold"
                              style={{ background: BAG_ORANGE + '0e' }}>
                              <td className="px-3 py-2.5 w-7">
                                {isProdOpen
                                  ? <ChevronDown size={13} className="text-stone-500" />
                                  : <ChevronRight size={13} className="text-stone-500" />}
                              </td>
                              <td className="px-3 py-2.5 font-bold text-[13px] text-stone-900">
                                {pg.product}
                                {(pg.acumaticaDesc || pg.acumaticaCode) && (
                                  <span className="ml-2 font-mono text-[10px] font-normal text-stone-400">
                                    {pg.acumaticaDesc || pg.acumaticaCode}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-[11px] text-stone-500">
                                {pg.lots.length === 1 ? pg.lots[0].lot : `${pg.lots.length} lots`}
                              </td>
                              <td className="px-3 py-2.5 text-[11px] text-stone-600">
                                {Array.from(new Set(pg.lots.map(l => l.variant))).join(', ')}
                              </td>
                              <td className="px-3 py-2.5 text-[11px] text-stone-600">
                                {Array.from(new Set(pg.lots.map(l => l.grade))).join(', ')}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono font-bold text-stone-700">{pg.totalCount}</td>
                              <td className="px-3 py-2.5 text-right font-mono font-bold text-stone-900">{pg.totalKg.toFixed(1)} kg</td>
                            </tr>

                            {/* Lot rows */}
                            {isProdOpen && pg.lots.map(lg => {
                              const lotKey  = `${pg.product}||${lg.lot}||${lg.variant}||${lg.grade}`
                              const isLotOpen = expandedLots.has(lotKey)
                              return (
                                <React.Fragment key={lotKey}>
                                  <tr onClick={() => toggleLot(lotKey)}
                                    className="border-b border-stone-100 cursor-pointer hover:bg-stone-50 transition-colors"
                                    style={{ background: BAG_ORANGE + '06' }}>
                                    <td className="px-3 py-2"></td>
                                    <td className="px-3 py-2 pl-7 text-stone-700 text-[12px]">
                                      <div className="flex items-center gap-1.5">
                                        {isLotOpen
                                          ? <ChevronDown size={11} className="text-stone-400" />
                                          : <ChevronRight size={11} className="text-stone-400" />}
                                        <span className="font-mono">{lg.lot}</span>
                                      </div>
                                    </td>
                                    <td className="px-3 py-2"></td>
                                    <td className="px-3 py-2 text-[11px] text-stone-500">{lg.variant}</td>
                                    <td className="px-3 py-2 text-[11px] text-stone-500">{lg.grade}</td>
                                    <td className="px-3 py-2 text-right font-mono text-[12px] text-stone-600">{lg.count}</td>
                                    <td className="px-3 py-2 text-right font-mono text-[12px] font-medium text-stone-700">{lg.kg.toFixed(1)} kg</td>
                                  </tr>

                                  {/* Individual bags */}
                                  {isLotOpen && lg.bags.map((b, bi) => (
                                    <tr key={`${lotKey}-${bi}`} className="border-b border-stone-50 last:border-0" style={{ background: BAG_ORANGE + '03' }}>
                                      <td className="px-3 py-1.5"></td>
                                      <td className="px-3 py-1.5 pl-12 text-[11px] text-stone-400">
                                        ↳ bag {bi + 1}
                                        {b.serial && (
                                          <div className="font-mono text-[10px] text-stone-400 mt-0.5">{b.serial}</div>
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 font-mono text-[11px] text-stone-500">{b.lot}</td>
                                      <td className="px-3 py-1.5 text-[11px] text-stone-500">{b.variant}</td>
                                      <td className="px-3 py-1.5 text-[11px] text-stone-500">{b.grade}</td>
                                      <td className="px-3 py-1.5 text-right text-stone-400">
                                        {b.loggedAt && <span className="font-mono text-[10px]">{fmtTime(b.loggedAt)}</span>}
                                      </td>
                                      <td className="px-3 py-1.5 text-right font-mono text-[12px] font-medium text-stone-700">{b.kg.toFixed(1)} kg</td>
                                    </tr>
                                  ))}
                                </React.Fragment>
                              )
                            })}
                          </React.Fragment>
                        )
                      })}

                      {/* Grand total */}
                      <tr className="border-t-2 border-stone-300" style={{ background: BAG_ORANGE + '08' }}>
                        <td className="px-3 py-2.5"></td>
                        <td colSpan={4} className="px-3 py-2.5 font-bold text-[12px] text-stone-800 uppercase tracking-wide">Total bagged out</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-stone-900">{totalBags}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-[14px] text-stone-900">{totalOut.toFixed(1)} kg</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Mass balance */}
            <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-[12px] font-mono ${withinTol ? 'bg-ok/5 border-ok/30' : 'bg-warn/5 border-warn/30'}`}>
              <span className="text-stone-500">Out {totalOut.toFixed(1)} − In {totalIncl.toFixed(1)} =</span>
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
