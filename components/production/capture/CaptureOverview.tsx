'use client'

// CaptureOverview — hierarchical production summary.
// Debagging: grouped by lot with subtotals, bucket elevator + machine spillage rows,
//            total excl. and incl. spillage.
// Bagging: 3-level hierarchy (product → lot → individual bag), expandable at each level.
// Machine spillage is entered here (not in capture) and is session-level.
// Combined totals merge both shifts when same variant+grade+lot are passed in.

import { useState, useMemo } from 'react'
import { Printer, Copy, CheckCircle2, AlertTriangle, Package, PackageCheck,
  ChevronDown, ChevronRight, Filter, X, Scale, Hash } from 'lucide-react'
import { type SievingData } from '@/components/production/capture/SievingCapture'
import { type RefiningData } from '@/components/production/capture/RefiningCapture'
import { dustProductType, type GranuleData } from '@/components/production/capture/GranuleCapture'
import { type BlenderData } from '@/components/production/capture/BlenderCapture'
import { MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'
import { MassBalanceTable, type BalanceRow } from '@/components/production/capture/MassBalanceTable'

interface Production { id: string; variant: string; grade: string; lot: string; data: SievingData | RefiningData | GranuleData | BlenderData }

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

// A blend's mass balance is read as a component ratio (target vs actual %
// per ingredient), not a simple in/out total — computed by the page from the
// BOM plus this section's captured inputs, since that's the only place that
// already knows both.
export interface BlenderRatioGroup {
  bomId: string
  rows: { label: string; kg: number; actualPct: number; targetPct: number }[]
}

// ── Grouping functions ────────────────────────────────────────────────────────

function buildDebagLotGroups(prods: Production[]): { groups: DebagLotGroup[]; bucketKg: number; machineKg: number } {
  const map = new Map<string, DebagLotGroup>()
  let bucketKg = 0
  let machineKg = 0
  prods.forEach(p => {
    const d = p.data as any
    if ('bomId' in d) {
      // BlenderData: group by batch number (lot) — this is how mass balance is
      // actually read for a blend on the floor. Falls back to the ingredient's
      // material label for slots that don't carry a lot (sugar, flavour, etc.),
      // then a positional placeholder. Merges into an existing group rather
      // than overwriting, so two rows sharing a fallback key never clobber
      // each other (see the RefiningData branch below for why that matters).
      ;(d.inputs ?? []).forEach((r: any, i: number) => {
        if (num(r.weight) === 0) return
        const lot = (r.lot || r.productType || `Input bag ${i + 1}`).trim()
        const row: DebagRow = { bagNo: r.serial || `Bag ${i + 1}`, kg: num(r.weight), variant: r.variant || p.variant, loggedAt: r.logged_at }
        const g = map.get(lot)
        if (g) { g.rows.push(row); g.totalKg += num(r.weight) }
        else map.set(lot, { lot, rows: [row], totalKg: num(r.weight) })
      })
    } else if ('inputs' in d) {
      // RefiningData: group by batch/lot number when one was captured (e.g.
      // Refining 2's Coarse Leaf, which requires it), falling back to serial,
      // then a positional placeholder. Merging (not overwriting) matters here:
      // manual-entry rows without a serial all fall back to the same
      // "Input bag N" key, and productions from both shifts are passed in
      // together — an unconditional `map.set` would let a later shift's
      // fallback-keyed row silently discard an earlier one's kg.
      ;(d.inputs ?? []).forEach((r: any, i: number) => {
        if (num(r.weight) === 0) return
        const lot = (r.lot || r.serial || `Input bag ${i + 1}`).trim()
        const row: DebagRow = { bagNo: r.serial || `Input bag ${i + 1}`, kg: num(r.weight), variant: r.variant || p.variant, loggedAt: r.logged_at }
        const g = map.get(lot)
        if (g) { g.rows.push(row); g.totalKg += num(r.weight) }
        else map.set(lot, { lot, rows: [row], totalKg: num(r.weight) })
      })
    } else if ('blends' in d) {
      // GranuleData: group dust inputs by dust type — the plant reads dust totals first.
      ;(d.blends ?? []).forEach((bl: any) => {
        ;(bl.rows ?? []).forEach((r: any) => {
          if (num(r.weight) === 0) return
          const label = dustProductType(r.dustKey)
          const row: DebagRow = { bagNo: r.serial || label, kg: num(r.weight), variant: r.variant || p.variant, loggedAt: r.logged_at }
          const g = map.get(label)
          if (g) { g.rows.push(row); g.totalKg += num(r.weight) }
          else map.set(label, { lot: label, rows: [row], totalKg: num(r.weight) })
        })
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
    if ('bomId' in d) {
      // BlenderData: the output is the blend itself — labeled "Blend {bomId}",
      // the same convention BlenderCapture uses when it upserts these bags to
      // bag_tags. There's no per-bag productType/batch/destination on a
      // BlenderOutputBag (unlike every other section's output shape), so
      // those are supplied here rather than read off `b`.
      const label = d.bomId ? `Blend ${d.bomId}` : 'Blended Batch'
      ;(d.outputs ?? []).forEach((b: any) => addBag(p, {
        productType: label, weight: b.weight, serial: b.serial,
        batch: d.bomId || undefined, destination: p.variant, logged_at: b.logged_at,
      }))
    } else if ('inputs' in d) {
      // RefiningData: outputA/B/C/D groups each have a bags array
      ;[d.outputA, d.outputB, d.outputC, d.outputD].forEach((grp: any) => {
        if (!grp) return
        ;(grp.bags ?? []).forEach((b: any) => addBag(p, {
          ...b,
          productType: grp.productType ?? grp.label,
          code: grp.code,
          description: grp.description,
          batch: b.serial,        // show serial in the LOT/BATCH column
          destination: p.variant, // no grade — show variant instead
        }))
      })
    } else if ('blends' in d) {
      // GranuleData: granule bags + dust-from-granule-line by-products
      ;(d.outputs ?? []).forEach((b: any) => addBag(p, {
        productType: b.item, weight: b.weight, serial: b.serial, code: b.code,
        batch: b.lot, destination: p.grade || p.variant, logged_at: b.logged_at,
      }))
      ;(d.dustOutputs ?? []).forEach((r: any) => addBag(p, {
        productType: r.dustType, weight: r.weight, serial: r.serial, code: r.code,
        batch: p.lot, destination: p.variant, logged_at: r.logged_at,
      }))
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
  productionOrders, locked = false, balanceRows, balanceNote, blenderRatios,
}: {
  productions: Production[]; sectionName: string; sectionColor: string; date: string; shift: string; showSerials?: boolean
  productionOrders?: any; locked?: boolean
  balanceRows?: BalanceRow[]; balanceNote?: string; blenderRatios?: BlenderRatioGroup[]
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
            {/* Flat list of lot cards (not a table) — each bag inside shows its
                serial as its own chip, isolated from the surrounding text, so
                wrapping it in a link to Bag Tracking later is a one-line change
                once barcodes drive that lookup, not a layout rework. */}
            {(debagGroups.length > 0 || bucketKg > 0) && (
              <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: DEBAG_BLUE + '40' }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ background: DEBAG_BLUE + '12' }}>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: DEBAG_BLUE }}>
                    <Package size={14} /> Debagging — in
                  </span>
                  <span className="font-mono font-bold text-[13px]" style={{ color: DEBAG_BLUE }}>{totalIncl.toFixed(1)} kg</span>
                </div>

                <div className="divide-y divide-stone-100">
                  {debagGroups.map(g => {
                    const open = expandedDebagLots.has(g.lot)
                    return (
                      <div key={g.lot}>
                        <button onClick={() => toggleDebagLot(g.lot)}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-stone-50 transition-colors"
                          style={open ? { background: DEBAG_BLUE + '06' } : undefined}>
                          {open ? <ChevronDown size={13} className="text-stone-400 shrink-0" /> : <ChevronRight size={13} className="text-stone-400 shrink-0" />}
                          <span className="font-semibold text-[13px] text-stone-800 truncate">{g.lot}</span>
                          <span className="text-[11px] text-stone-400 shrink-0">{g.rows.length} bag{g.rows.length !== 1 ? 's' : ''}</span>
                          <span className="flex-1" />
                          <span className="font-mono font-bold text-[13px] text-stone-800 shrink-0">{g.totalKg.toFixed(1)} kg</span>
                        </button>
                        {open && (
                          <div className="pl-9 pr-3 pb-2 space-y-1">
                            {g.rows.map((r, ri) => (
                              <div key={ri} className="flex items-center gap-2 py-1 text-[12px]">
                                <span className="font-mono text-[11px] font-medium text-stone-600 bg-stone-100 border border-stone-200 rounded-md px-1.5 py-0.5 shrink-0">{r.bagNo}</span>
                                <span className="text-stone-400 truncate flex-1">{r.variant}</span>
                                {r.loggedAt && <span className="text-[10px] text-stone-400 shrink-0">{fmtTime(r.loggedAt)}</span>}
                                <span className="font-mono text-stone-700 shrink-0 w-16 text-right">{r.kg.toFixed(1)} kg</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Totals + spillage — plain summary rows, not part of the lot list */}
                <div className="border-t-2 border-stone-200 divide-y divide-stone-100">
                  {(bucketKg > 0 || machineKg > 0) && debagGroups.length > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                      <span>Total debagging (excl. spillage)</span>
                      <span className="font-mono font-bold text-stone-800 normal-case">{debagOnlyKg.toFixed(1)} kg</span>
                    </div>
                  )}
                  {bucketKg > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 text-[12px] font-medium text-amber-700" style={{ background: '#f59e0b0d' }}>
                      <span className="flex items-center gap-1.5"><Scale size={12} className="text-amber-500" /> Bucket elevator spillage</span>
                      <span className="font-mono">{bucketKg.toFixed(1)} kg</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-3 py-2 text-[12px] font-medium text-amber-700" style={{ background: '#f59e0b08' }}>
                    <span className="flex items-center gap-1.5"><Scale size={12} className="text-amber-500" /> Machine spillage</span>
                    <span className="font-mono">{machineKg > 0 ? `${machineKg.toFixed(1)} kg` : <span className="text-stone-400 font-normal">—</span>}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2.5 font-bold text-[12px] text-stone-800 uppercase tracking-wide" style={{ background: DEBAG_BLUE + '08' }}>
                    <span>Total incl. spillage</span>
                    <span className="font-mono font-bold text-[14px] text-stone-900 normal-case">{totalIncl.toFixed(1)} kg</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Blend component ratio — target vs actual (mass balance for a
                blend is read as a ratio per ingredient, not a simple total) ── */}
            {blenderRatios && blenderRatios.length > 0 && blenderRatios.map(br => (
              <div key={br.bomId} className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
                <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                  Blend <span className="font-mono">{br.bomId}</span> — component ratio (target vs actual)
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {br.rows.map(r => {
                    const off = Math.abs(r.actualPct - r.targetPct) > 5
                    return (
                      <div key={r.label} className={`flex justify-between px-3 py-2 rounded-lg border text-[11px] ${off ? 'bg-amber-50 border-amber-200' : 'bg-stone-50 border-stone-100'}`}>
                        <span className="text-stone-600 truncate pr-2">{r.label}</span>
                        <span className={`font-mono font-bold flex-shrink-0 ${off ? 'text-amber-700' : 'text-stone-700'}`}>
                          {r.actualPct.toFixed(0)}% <span className="text-stone-400">/ {r.targetPct.toFixed(0)}%</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

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

                <div className="divide-y divide-stone-200">
                  {filteredProducts.map(pg => {
                    const isProdOpen = expandedProducts.has(pg.product)
                    return (
                      <div key={pg.product}>
                        <button onClick={() => toggleProduct(pg.product)}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-left font-semibold hover:opacity-90 transition-opacity"
                          style={{ background: BAG_ORANGE + '0e' }}>
                          {isProdOpen ? <ChevronDown size={13} className="text-stone-500 shrink-0" /> : <ChevronRight size={13} className="text-stone-500 shrink-0" />}
                          <span className="font-bold text-[13px] text-stone-900 truncate">{pg.product}</span>
                          {(pg.acumaticaDesc || pg.acumaticaCode) && (
                            <span className="font-mono text-[10px] font-normal text-stone-400 truncate">{pg.acumaticaDesc || pg.acumaticaCode}</span>
                          )}
                          <span className="flex-1" />
                          <span className="text-[11px] font-normal text-stone-500 shrink-0 hidden sm:inline">
                            {Array.from(new Set(pg.lots.map(l => l.variant))).join(', ')}
                            {pg.lots.some(l => l.grade) ? ` · ${Array.from(new Set(pg.lots.map(l => l.grade))).join(', ')}` : ''}
                          </span>
                          <span className="font-mono font-bold text-stone-700 shrink-0">{pg.totalCount}</span>
                          <span className="font-mono font-bold text-stone-900 shrink-0 w-20 text-right">{pg.totalKg.toFixed(1)} kg</span>
                        </button>

                        {isProdOpen && (
                          <div className="divide-y divide-stone-100">
                            {pg.lots.map(lg => {
                              const lotKey  = `${pg.product}||${lg.lot}||${lg.variant}||${lg.grade}`
                              const isLotOpen = expandedLots.has(lotKey)
                              return (
                                <div key={lotKey}>
                                  <button onClick={() => toggleLot(lotKey)}
                                    className="w-full flex items-center gap-1.5 pl-8 pr-3 py-2 text-left hover:bg-stone-50 transition-colors"
                                    style={{ background: BAG_ORANGE + '06' }}>
                                    {isLotOpen ? <ChevronDown size={11} className="text-stone-400 shrink-0" /> : <ChevronRight size={11} className="text-stone-400 shrink-0" />}
                                    <span className="font-mono text-[12px] text-stone-700">{lg.lot}</span>
                                    <span className="text-[11px] text-stone-500">{[lg.variant, lg.grade].filter(Boolean).join(' · ')}</span>
                                    <span className="flex-1" />
                                    <span className="font-mono text-[12px] text-stone-600 shrink-0">{lg.count}</span>
                                    <span className="font-mono text-[12px] font-medium text-stone-700 shrink-0 w-16 text-right">{lg.kg.toFixed(1)} kg</span>
                                  </button>

                                  {isLotOpen && (
                                    <div className="pl-12 pr-3 pb-2 space-y-1" style={{ background: BAG_ORANGE + '03' }}>
                                      {lg.bags.map((b, bi) => (
                                        <div key={bi} className="flex items-center gap-2 py-1 text-[12px]">
                                          {b.serial
                                            ? <span className="font-mono text-[11px] font-medium text-stone-600 bg-stone-100 border border-stone-200 rounded-md px-1.5 py-0.5 shrink-0">{b.serial}</span>
                                            : <span className="text-[11px] text-stone-400 shrink-0">bag {bi + 1}</span>}
                                          <span className="text-stone-400 truncate flex-1">{[b.variant, b.grade].filter(Boolean).join(' · ')}</span>
                                          {b.loggedAt && <span className="font-mono text-[10px] text-stone-400 shrink-0">{fmtTime(b.loggedAt)}</span>}
                                          <span className="font-mono text-stone-700 shrink-0 w-16 text-right">{b.kg.toFixed(1)} kg</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Grand total */}
                <div className="flex items-center justify-between px-3 py-2.5 font-bold text-[12px] text-stone-800 uppercase tracking-wide border-t-2 border-stone-300" style={{ background: BAG_ORANGE + '08' }}>
                  <span>Total bagged out</span>
                  <span className="flex items-center gap-3 normal-case">
                    <span className="font-mono font-bold text-stone-900">{totalBags} bags</span>
                    <span className="font-mono font-bold text-[14px] text-stone-900">{totalOut.toFixed(1)} kg</span>
                  </span>
                </div>
              </div>
            )}

            {/* Mass balance — tabular (Morning / Afternoon / whole run) when the
                page supplies per-shift rows; otherwise a single-line fallback. */}
            {balanceRows && balanceRows.length > 0 ? (
              <MassBalanceTable rows={balanceRows} tolerance={MASS_BALANCE_TOLERANCE_KG} note={balanceNote} />
            ) : (
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-[12px] font-mono ${withinTol ? 'bg-ok/5 border-ok/30' : 'bg-warn/5 border-warn/30'}`}>
                <span className="text-stone-500">In {totalIncl.toFixed(1)} − Out {totalOut.toFixed(1)} =</span>
                <span className="inline-flex items-center gap-1.5 font-bold text-[13px]">
                  <span className={withinTol ? 'text-ok' : 'text-warn'}>{(-variance) > 0 ? '+' : ''}{(-variance).toFixed(1)} kg</span>
                  {withinTol ? <CheckCircle2 size={14} className="text-ok" /> : <AlertTriangle size={14} className="text-warn" />}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default CaptureOverview
