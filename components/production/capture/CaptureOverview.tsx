'use client'

// CaptureOverview — hierarchical production summary.
// Debagging: grouped by lot with subtotals, bucket elevator + machine spillage rows,
//            total excl. and incl. spillage.
// Bagging: 3-level hierarchy (product → lot → individual bag), expandable at each level.
// Machine spillage is entered here (not in capture) and is session-level.
// Combined totals merge both shifts when same variant+grade+lot are passed in.

import { useState, useMemo, useEffect } from 'react'
import { Printer, Copy, CheckCircle2, AlertTriangle, Package, PackageCheck,
  ChevronDown, ChevronRight, Filter, X, Scale, Hash } from 'lucide-react'
import { fetchTopUpEventsForSerials, fetchFreshTopUpsForSection, type TopUpEvent, type FreshTopUpRow } from '@/lib/production/scan-utils'
import { type SievingData } from '@/components/production/capture/SievingCapture'
import { type RefiningData } from '@/components/production/capture/RefiningCapture'
import { dustProductType, type GranuleData } from '@/components/production/capture/GranuleCapture'
import { type BlenderData } from '@/components/production/capture/BlenderCapture'
import { type PasteuriserData } from '@/components/production/capture/PasteuriserCapture'
import { massBalanceToleranceFor } from '@/lib/production/capture-config'
import { n as num } from '@/lib/core/num'
import { sectionKindFor, assertNever, type SectionKind } from '@/lib/core/types/capture'

interface Production {
  id: string; variant: string; grade: string; lot: string
  data: SievingData | RefiningData | GranuleData | BlenderData | PasteuriserData
  // Which shift this batch belongs to — only meaningful for Sieving's bucket
  // elevator, which means opposite things on the two shifts (see
  // buildDebagLotGroups below). Undefined for callers that don't pass it.
  shift?: string
}

const DEBAG_BLUE  = '#1d4ed8'
const BAG_ORANGE  = '#d97706'

// ── Data types ────────────────────────────────────────────────────────────────

interface DebagRow { bagNo: string; kg: number; variant: string; loggedAt?: string; note?: string }
interface DebagLotGroup { lot: string; rows: DebagRow[]; totalKg: number }

interface FlatBag {
  product: string; lot: string; kg: number; variant: string; grade: string
  serial: string; loggedAt?: string; description?: string
  // Set only for a synthetic row injected from a cross-day Half-bag
  // Top-up — a "from today's production" addition into a bag first bagged
  // on an EARLIER day, which isn't part of this page's own captured output
  // at all (see mergeFreshTopUps below). Never set on a real captured bag.
  isTopUp?: boolean; topUpBatch?: string | null
}
interface BagLotGroup { lot: string; variant: string; grade: string; bags: FlatBag[]; count: number; kg: number }
interface ProductGroup { product: string; acumaticaCode?: string | null; acumaticaDesc?: string; lots: BagLotGroup[]; totalCount: number; totalKg: number }

// A blend's mass balance is read as a component ratio (target vs actual %
// per ingredient), not a simple in/out total — computed by the page from the
// BOM plus this section's captured inputs, since that's the only place that
// already knows both.

// ── Grouping functions ────────────────────────────────────────────────────────

function buildDebagLotGroups(prods: Production[], kind: SectionKind): { groups: DebagLotGroup[]; bucketInKg: number; bucketOutKg: number; machineKg: number } {
  const map = new Map<string, DebagLotGroup>()
  let bucketInKg = 0
  let bucketOutKg = 0
  let machineKg = 0
  prods.forEach(p => {
    const d = p.data as any
    if (kind === 'blender') {
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
    } else if (kind === 'refining') {
      // RefiningData: group by input product type (Coarse Leaf, Fine Leaf,
      // Sticks, …) — the same grouping the Capture tab already uses, and the
      // only one that actually consolidates anything: each bag's lot/serial
      // is its own value (often just the date on the tag), so grouping by
      // lot produced one group per bag instead of a real rollup.
      ;(d.inputs ?? []).forEach((r: any, i: number) => {
        if (num(r.weight) === 0) return
        const type = (r.productType || 'Other').trim()
        const row: DebagRow = {
          bagNo: r.serial || `Input bag ${i + 1}`, kg: num(r.weight), variant: r.variant || p.variant,
          loggedAt: r.logged_at, note: r.deliveryDate || r.lot || undefined,
        }
        const g = map.get(type)
        if (g) { g.rows.push(row); g.totalKg += num(r.weight) }
        else map.set(type, { lot: type, rows: [row], totalKg: num(r.weight) })
      })
    } else if (kind === 'granule') {
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
    } else if (kind === 'pasteuriser') {
      // PasteuriserData: debagged blend bags (both streams) grouped by lot,
      // falling back to serial then a positional placeholder — merged, not
      // overwritten, for the same cross-shift reason as the branches above.
      ;(d.debag ?? []).forEach((r: any, i: number) => {
        if (num(r.weight) === 0) return
        const lot = (r.lot || r.serial || `Input bag ${i + 1}`).trim()
        const row: DebagRow = { bagNo: r.serial || `Input bag ${i + 1}`, kg: num(r.weight), variant: r.variant || p.variant, loggedAt: r.logged_at }
        const g = map.get(lot)
        if (g) { g.rows.push(row); g.totalKg += num(r.weight) }
        else map.set(lot, { lot, rows: [row], totalKg: num(r.weight) })
      })
    } else if (kind === 'sieving') {
      // SievingData: debag + spillage. The bucket elevator (spillage[0]) means
      // opposite things depending on which shift this production belongs to —
      // the morning shift CONSUMES what last night's afternoon shift left
      // behind (an input), the afternoon shift LEAVES a new figure for
      // tomorrow (an output). These are two different physical quantities a
      // day apart, not one number to sum, even though the Overview may be
      // showing both shifts' productions side by side. p.shift is missing for
      // callers that never pass it (treated as morning/input, the historical
      // default) — see the Production interface's own comment.
      ;(d.spillage ?? []).forEach((r: any, i: number) => {
        if (num(r.kg) === 0) return
        if (i === 0) { if (p.shift === 'afternoon') bucketOutKg += num(r.kg); else bucketInKg += num(r.kg) }
        else         machineKg += num(r.kg)
      })
      ;(d.debag ?? []).forEach((r: any, i: number) => {
        if (num(r.nett) === 0) return
        const lot = (r.lot || p.lot || '—').trim()
        const row: DebagRow = { bagNo: r.bag_no || `Bulk bag ${i + 1}`, kg: num(r.nett), variant: p.variant, loggedAt: r.logged_at }
        const g = map.get(lot)
        if (g) { g.rows.push(row); g.totalKg += num(r.nett) }
        else map.set(lot, { lot, rows: [row], totalKg: num(r.nett) })
      })
    } else { assertNever(kind, 'section kind') }
  })
  return { groups: Array.from(map.values()), bucketInKg, bucketOutKg, machineKg }
}

function buildProductGroups(prods: Production[], kind: SectionKind): ProductGroup[] {
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
    if (kind === 'blender') {
      // BlenderData: the output is the blend itself — labeled "Blend {bomId}",
      // the same convention BlenderCapture uses when it upserts these bags to
      // bag_tags. productType/destination aren't per-bag on a BlenderOutputBag
      // (unlike every other section's output shape) so those are supplied here;
      // `lot` IS per-bag (resolved once at creation — see autoLot() in
      // BlenderCapture) — falls back to the blend code for bags logged before
      // that field existed.
      const label = d.bomId ? `Blend ${d.bomId}` : 'Blended Batch'
      ;(d.outputs ?? []).forEach((b: any) => addBag(p, {
        productType: label, weight: b.weight, serial: b.serial,
        batch: b.lot || d.bomId || undefined, destination: p.variant, logged_at: b.logged_at,
      }))
    } else if (kind === 'refining') {
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
    } else if (kind === 'granule') {
      // GranuleData: granule bags + dust-from-granule-line by-products
      ;(d.outputs ?? []).forEach((b: any) => addBag(p, {
        productType: b.item, weight: b.weight, serial: b.serial, code: b.code,
        batch: b.lot, destination: p.grade || p.variant, logged_at: b.logged_at,
      }))
      ;(d.dustOutputs ?? []).forEach((r: any) => addBag(p, {
        productType: r.dustType, weight: r.weight, serial: r.serial, code: r.code,
        batch: p.lot, destination: p.variant, logged_at: r.logged_at,
      }))
    } else if (kind === 'pasteuriser') {
      // PasteuriserData: final-product pallet lines (kg = bags × kg/bag) + by-products.
      const perBag = num(d.weightPerBag) || 0
      ;(d.outputs ?? []).forEach((l: any) => addBag(p, {
        productType: l.item || l.kind || 'Final Product', code: l.itemCode,
        weight: String(num(l.bagCount) * (num(l.bagWeight) || perBag)),
        batch: l.lot || d.batchNo, serial: l.serial, destination: p.variant, logged_at: l.logged_at,
      }))
      ;(d.byProducts ?? []).forEach((r: any) => addBag(p, {
        productType: r.type, weight: r.weight, serial: r.serial || r.type,
        batch: d.batchNo, destination: p.variant,
      }))
    } else if (kind === 'sieving') {
      // SievingData: flat outputs array
      ;(d.outputs ?? []).forEach((b: any) => addBag(p, b))
    } else { assertNever(kind, 'section kind') }
  })
  return Array.from(prodMap.values())
}

// Bumps each bag's OWN kg by its same-day top-ups (topUpsBySerial), cascading
// up through its lot and product totals. Without this, a topped-up bag's row
// kept showing its ORIGINAL weight — the addition was only visible as the
// nested violet sub-row, never counted in baggedOnlyKg/totalOut below — so
// the debagged material a top-up came from was counted as input with
// nothing added to the output side to balance it. Real activity, not a
// display quirk: this is the same root cause mergeFreshTopUps fixes for the
// cross-day case below.
//
// Restricted to mode==='production' ("from today's production", no source
// bag) — mode==='existing' ("from another bag") moves weight OUT of a
// source bag already counted as output when IT was first bagged, so adding
// it again here would double-count.
function bumpSameDayTopUps(groups: ProductGroup[], topUpsBySerial: Map<string, TopUpEvent[]>): ProductGroup[] {
  if (!topUpsBySerial.size) return groups
  return groups.map(pg => {
    let pgDelta = 0
    const lots = pg.lots.map(lg => {
      let lgDelta = 0
      const bags = lg.bags.map(b => {
        const added = b.serial
          ? (topUpsBySerial.get(b.serial) ?? []).filter(t => t.mode === 'production').reduce((s, t) => s + t.kg, 0)
          : 0
        if (!added) return b
        lgDelta += added; pgDelta += added
        return { ...b, kg: b.kg + added }
      })
      return lgDelta ? { ...lg, bags, kg: lg.kg + lgDelta } : lg
    })
    return pgDelta ? { ...pg, lots, totalKg: pg.totalKg + pgDelta } : pg
  })
}

// Folds cross-day Half-bag Top-ups ("from today's production" into a bag
// first bagged on an EARLIER day — see fetchFreshTopUpsForSection) into the
// matching product/lot group, creating the group/lot if this page's own
// productions never produced that product today. Without this, such a
// top-up has no existing bag row anywhere on this page to attach to, so it
// was previously just invisible here — never shown "in its product type
// section" the way an ordinary bag is. Same-day top-ups are handled by
// bumpSameDayTopUps above, which nests those under the bag's OWN row.
function mergeFreshTopUps(groups: ProductGroup[], freshTopUps: FreshTopUpRow[]): ProductGroup[] {
  if (!freshTopUps.length) return groups
  const merged = groups.map(pg => ({ ...pg, lots: pg.lots.map(lg => ({ ...lg, bags: [...lg.bags] })) }))
  for (const r of freshTopUps) {
    const product = r.productType || 'Other'
    let pg = merged.find(g => g.product === product)
    if (!pg) { pg = { product, lots: [], totalCount: 0, totalKg: 0 }; merged.push(pg) }
    const grade = r.grade || '—'
    const variant = r.variant || ''
    const lot = r.lot || '—'
    let lg = pg.lots.find(l => l.lot === lot && l.variant === variant && l.grade === grade)
    if (!lg) { lg = { lot, variant, grade, bags: [], count: 0, kg: 0 }; pg.lots.push(lg) }
    lg.bags.push({ product, lot, kg: r.kg, variant, grade, serial: r.serial, loggedAt: r.at, isTopUp: true, topUpBatch: r.batch })
    lg.count++; lg.kg += r.kg
    pg.totalCount++; pg.totalKg += r.kg
  }
  return merged
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
  productions, sectionId, sectionName, sectionColor, date, shift, showSerials = false,
  productionOrders, locked = false,
}: {
  productions: Production[]; sectionId: string; sectionName: string; sectionColor: string; date: string; shift: string; showSerials?: boolean
  productionOrders?: any; locked?: boolean
}) {
  // Which section this screen is showing. Comes from the route, so it is
  // authoritative — the five data shapes are never told apart by guessing at
  // their fields any more. See ARCHITECTURE.md §4.
  const kind = sectionKindFor(sectionId)

  const [expandedProducts,  setExpandedProducts]  = useState<Set<string>>(new Set())
  const [expandedLots,      setExpandedLots]      = useState<Set<string>>(new Set())
  const [expandedDebagLots, setExpandedDebagLots] = useState<Set<string>>(new Set())

  const { groups: debagGroups, bucketInKg, bucketOutKg, machineKg } = useMemo(() => buildDebagLotGroups(productions, kind), [productions, kind])
  const rawProductGroups = useMemo(() => buildProductGroups(productions, kind), [productions, kind])

  // Half-bag Top-up folded into each bag's own row here, rather than a
  // separate panel — a top-up is a side-channel write that never touches
  // draft_data (see HalfBagTopUpModal), so it's otherwise invisible in this
  // page's own product/lot grouping even though it's real activity against
  // one of these exact bags. Keyed by serial, not by this page's own
  // session(s) — the top-up could have been logged in a different session
  // than the one that first bagged it. Only for bags THIS page already has
  // its own row for (same-day) — see freshTopUps below for the cross-day case.
  const [topUpsBySerial, setTopUpsBySerial] = useState<Map<string, TopUpEvent[]>>(new Map())
  useEffect(() => {
    const serials = Array.from(new Set(rawProductGroups.flatMap(pg => pg.lots.flatMap(lg => lg.bags.map(b => b.serial))).filter(Boolean))) as string[]
    if (!serials.length) { setTopUpsBySerial(new Map()); return }
    let cancelled = false
    fetchTopUpEventsForSerials(serials).then(m => { if (!cancelled) setTopUpsBySerial(m) })
    return () => { cancelled = true }
  }, [rawProductGroups])

  // Cross-day top-ups: "from today's production" added into a bag first
  // bagged on an EARLIER day, so it has no row anywhere in rawProductGroups
  // to nest under — folded in as their own synthetic rows under the
  // matching product type instead (see mergeFreshTopUps).
  const [freshTopUps, setFreshTopUps] = useState<FreshTopUpRow[]>([])
  useEffect(() => {
    if (!sectionId) { setFreshTopUps([]); return }
    const covered = new Set(rawProductGroups.flatMap(pg => pg.lots.flatMap(lg => lg.bags.map(b => b.serial))).filter(Boolean) as string[])
    let cancelled = false
    fetchFreshTopUpsForSection(sectionId, date, covered).then(rows => { if (!cancelled) setFreshTopUps(rows) })
    return () => { cancelled = true }
  }, [sectionId, date, rawProductGroups])

  const productGroups = useMemo(
    () => mergeFreshTopUps(bumpSameDayTopUps(rawProductGroups, topUpsBySerial), freshTopUps),
    [rawProductGroups, topUpsBySerial, freshTopUps],
  )

  const debagOnlyKg   = debagGroups.reduce((s, g) => s + g.totalKg, 0)
  const totalIncl     = debagOnlyKg + bucketInKg + machineKg
  const baggedOnlyKg  = productGroups.reduce((s, g) => s + g.totalKg, 0)
  const totalOut      = baggedOnlyKg + bucketOutKg
  const totalBags     = productGroups.reduce((s, g) => s + g.totalCount, 0)
  const hasData       = debagGroups.length > 0 || productGroups.length > 0
  const poStr         = formatPO(productionOrders)

  const toggleProduct  = (k: string) => setExpandedProducts(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleLot      = (k: string) => setExpandedLots(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleDebagLot = (k: string) => setExpandedDebagLots(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })



  return (
    <div className="rounded-2xl border border-stone-200 overflow-hidden bg-white shadow-sm">

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
            {(debagGroups.length > 0 || bucketInKg > 0) && (
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
                                <span className="text-stone-400 truncate flex-1">{[r.variant, r.note].filter(Boolean).join(' · ')}</span>
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
                  {(bucketInKg > 0 || machineKg > 0) && debagGroups.length > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                      <span>Total debagging (excl. spillage)</span>
                      <span className="font-mono font-bold text-stone-800 normal-case">{debagOnlyKg.toFixed(1)} kg</span>
                    </div>
                  )}
                  {bucketInKg > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 text-[12px] font-medium text-amber-700" style={{ background: '#f59e0b0d' }}>
                      <span className="flex items-center gap-1.5"><Scale size={12} className="text-amber-500" /> Bucket elevator — from yesterday</span>
                      <span className="font-mono">{bucketInKg.toFixed(1)} kg</span>
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

            {/* ── Bagging — out ───────────────────────────────────────────────── */}
            {(productGroups.length > 0 || bucketOutKg > 0) && (
              <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: BAG_ORANGE + '40' }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ background: BAG_ORANGE + '12' }}>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: BAG_ORANGE }}>
                    <PackageCheck size={14} /> Bagging — out
                  </span>
                  <span className="font-mono font-bold text-[13px]" style={{ color: BAG_ORANGE }}>
                    {totalOut.toFixed(1)} kg · {totalBags} bag{totalBags !== 1 ? 's' : ''}
                  </span>
                </div>


                <div className="divide-y divide-stone-200">
                  {productGroups.map(pg => {
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
                                      {lg.bags.map((b, bi) => {
                                        // isTopUp rows are synthetic (see mergeFreshTopUps) — the
                                        // row itself IS the top-up event, so it never also looks
                                        // up topUpsBySerial (that would just re-show the same event
                                        // nested under itself).
                                        if (b.isTopUp) {
                                          return (
                                            <div key={bi} className="flex items-center gap-2 py-1 text-[12px] pl-1 border-l-2 border-violet-300" style={{ background: '#7c3aed08' }}>
                                              <Scale size={11} className="text-violet-500 shrink-0" />
                                              <span className="font-mono text-[11px] font-medium text-violet-700 bg-violet-100 border border-violet-200 rounded-md px-1.5 py-0.5 shrink-0">{b.serial}</span>
                                              <span className="text-violet-600 truncate flex-1">
                                                half-bag top-up, into an earlier bag{b.topUpBatch ? ` · ${b.topUpBatch}` : ''}
                                              </span>
                                              {b.loggedAt && <span className="font-mono text-[10px] text-violet-400 shrink-0">{fmtTime(b.loggedAt)}</span>}
                                              <span className="font-mono text-violet-700 shrink-0 w-16 text-right">+{b.kg.toFixed(1)} kg</span>
                                            </div>
                                          )
                                        }
                                        const topUps = b.serial ? topUpsBySerial.get(b.serial) : undefined
                                        return (
                                        <div key={bi}>
                                          <div className="flex items-center gap-2 py-1 text-[12px]">
                                            {b.serial
                                              ? <span className="font-mono text-[11px] font-medium text-stone-600 bg-stone-100 border border-stone-200 rounded-md px-1.5 py-0.5 shrink-0">{b.serial}</span>
                                              : <span className="text-[11px] text-stone-400 shrink-0">bag {bi + 1}</span>}
                                            <span className="text-stone-400 truncate flex-1">{[b.variant, b.grade].filter(Boolean).join(' · ')}</span>
                                            {b.loggedAt && <span className="font-mono text-[10px] text-stone-400 shrink-0">{fmtTime(b.loggedAt)}</span>}
                                            <span className="font-mono text-stone-700 shrink-0 w-16 text-right">{b.kg.toFixed(1)} kg</span>
                                          </div>
                                          {/* Half-bag Top-up history for this exact bag — folded in here
                                              rather than a separate panel, since it's real activity
                                              against this specific serial even though the write path
                                              (see HalfBagTopUpModal) never touches this page's own
                                              draft_data-derived grouping above. */}
                                          {topUps?.map((t, ti) => (
                                            <div key={ti} className="flex items-center gap-2 py-0.5 pl-4 text-[11px] border-l-2 border-violet-200">
                                              <Scale size={10} className="text-violet-500 shrink-0" />
                                              <span className="text-violet-700 truncate flex-1">
                                                {t.mode === 'production'
                                                  ? (t.sourceOrBatch ? `today's production · ${t.sourceOrBatch}` : "today's production")
                                                  : `from ${t.sourceOrBatch}`}
                                              </span>
                                              <span className="font-mono text-[10px] text-violet-400 shrink-0">{fmtTime(t.at)}</span>
                                              <span className="font-mono text-violet-700 shrink-0 w-16 text-right">+{t.kg.toFixed(1)} kg</span>
                                            </div>
                                          ))}
                                        </div>
                                        )
                                      })}
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

                {/* Totals + bucket-elevator carry-over — mirrors the debagging
                    card's own totals block: bagged weight, then the elevator
                    figure this AFTERNOON shift is leaving for tomorrow morning
                    (a different physical quantity from bucketInKg above), then
                    the grand total. */}
                <div className="border-t-2 border-stone-300 divide-y divide-stone-100">
                  {bucketOutKg > 0 && productGroups.length > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                      <span>Total bagged out</span>
                      <span className="font-mono font-bold text-stone-800 normal-case">{totalBags} bags · {baggedOnlyKg.toFixed(1)} kg</span>
                    </div>
                  )}
                  {bucketOutKg > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 text-[12px] font-medium text-amber-700" style={{ background: '#f59e0b0d' }}>
                      <span className="flex items-center gap-1.5"><Scale size={12} className="text-amber-500" /> Bucket elevator — left for tomorrow</span>
                      <span className="font-mono">{bucketOutKg.toFixed(1)} kg</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-3 py-2.5 font-bold text-[12px] text-stone-800 uppercase tracking-wide" style={{ background: BAG_ORANGE + '08' }}>
                    <span>Total out</span>
                    <span className="flex items-center gap-3 normal-case">
                      <span className="font-mono font-bold text-stone-900">{totalBags} bags</span>
                      <span className="font-mono font-bold text-[14px] text-stone-900">{totalOut.toFixed(1)} kg</span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* General mass balance — what went in, what came out, and the
                difference. Stated plainly and nothing more: no tolerance verdict,
                no yield, no per-shift decomposition. Those read as authoritative
                while being derived from whatever the capture rows happened to
                say, so when the rows were wrong the summary was confidently
                wrong with them. The two figures here are the totals of the
                debagging and bagging tables directly above, so this can only
                ever disagree with them if those tables are themselves wrong. */}
            {hasData && (
              <div className="rounded-xl border border-stone-200 overflow-hidden">
                <div className="px-3 py-2 bg-stone-50 text-[10px] font-semibold text-stone-400 uppercase tracking-wide flex items-center gap-1.5">
                  <Scale size={12} /> Mass balance
                </div>
                <div className="divide-y divide-stone-100 text-[12px]">
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-stone-600">Total in — debagged</span>
                    <span className="font-mono text-text">{totalIncl.toFixed(1)} kg</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-stone-600">Total out — bagged</span>
                    <span className="font-mono text-text">{totalOut.toFixed(1)} kg</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2.5 font-bold bg-stone-50/70">
                    <span className="text-stone-800">Difference</span>
                    <span className="font-mono text-stone-900">
                      {totalIncl - totalOut > 0 ? '+' : ''}{(totalIncl - totalOut).toFixed(1)} kg
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default CaptureOverview
