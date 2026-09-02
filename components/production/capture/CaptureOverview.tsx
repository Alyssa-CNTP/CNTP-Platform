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
import { type SievingData } from '@/components/production/capture/SievingCapture'
import { type RefiningData } from '@/components/production/capture/RefiningCapture'
import { dustProductType, type GranuleData } from '@/components/production/capture/GranuleCapture'
import { type BlenderData } from '@/components/production/capture/BlenderCapture'
import { type PasteuriserData } from '@/components/production/capture/PasteuriserCapture'
import { getDb } from '@/lib/supabase/db'
import { GRADE_TO_LOCAL_EXPORT } from '@/lib/production/capture-config'
import { normalizeLot } from '@/lib/production/self-heal-reconcile'

interface Production {
  id: string; variant: string; grade: string; lot: string
  data: SievingData | RefiningData | GranuleData | BlenderData | PasteuriserData
  // Which shift this batch belongs to — only meaningful for Sieving's bucket
  // elevator, which means opposite things on the two shifts (see
  // buildDebagLotGroups below). Undefined for callers that don't pass it.
  shift?: string
}

const num = (v: any): number => parseFloat(String(v).replace(',', '.')) || 0
// Mass-balance tolerance: ±1% of total input, everywhere (per-section rules in
// lib/production/capture-config are for the fuller balance this replaces).
const MASS_BALANCE_TOLERANCE_PCT = 0.01

const DEBAG_BLUE  = '#1d4ed8'
const BAG_ORANGE  = '#d97706'

// ── Data types ────────────────────────────────────────────────────────────────

interface DebagRow { bagNo: string; kg: number; variant: string; loggedAt?: string; note?: string }
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

// One half-bag top-up, as a line under the product it went into. Carries the
// same facts as the "Half-bag top-ups this shift" card so a reader never has to
// cross-reference two panels to find out what the +kg on the total was.
function TopUpLine({ t }: { t: { serial: string; kg: number; productType: string | null; variant: string | null; batch: string | null; at: string | null } }) {
  return (
    <div className="flex items-center gap-2 pl-8 pr-3 py-2 text-[12px]" style={{ background: '#7c3aed08' }}>
      <Scale size={12} className="text-violet-500 shrink-0" />
      <span className="font-mono text-[11.5px] text-violet-800 shrink-0">{t.serial}</span>
      <span className="text-stone-400 truncate flex-1">
        {[t.productType, t.variant, t.batch].filter(Boolean).join(' · ')}
      </span>
      <span className="text-[10px] text-violet-500 shrink-0 hidden sm:inline">top-up</span>
      {t.at && <span className="font-mono text-[10px] text-stone-400 shrink-0">{fmtTime(t.at)}</span>}
      <span className="font-mono text-violet-700 shrink-0 w-16 text-right">+{t.kg.toFixed(1)} kg</span>
    </div>
  )
}

// ── Grouping functions ────────────────────────────────────────────────────────

function buildDebagLotGroups(prods: Production[]): { groups: DebagLotGroup[]; bucketInKg: number; bucketOutKg: number; machineKg: number; duplicatesHidden: number } {
  const map = new Map<string, DebagLotGroup>()
  // Spans every production, so a copy sitting in batch 6 is recognised against
  // the original in batch 1 — the copies live in OTHER batches, not this one.
  const seenSievingBag = new Set<string>()
  let duplicatesHidden = 0
  let bucketInKg = 0
  let bucketOutKg = 0
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
    } else if ('byProducts' in d) {
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
    } else {
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
      // A changeover (and a page reload) copied a session's debagging rows into
      // its other batches, and this Overview sums EVERY batch — so the same
      // physical bag was counted once per copy: GS-0314 read 32 bags / 11 200 kg
      // for one bag, and the panel totalled 95 900 kg against ~6 t debagged.
      //
      // A farm bag is a physical object debagged ONCE, so (lot, bag label) is its
      // identity and a repeat is a copy. Confirmed against the floor's paper
      // sheet for 31-08-2026: 41 bags, 41 distinct pairs.
      //
      // A row with a BLANK bag label is never deduplicated — two different bags
      // both captured without one would collapse into a single bag and
      // UNDER-count, which is worse than showing the copy. Those fall back to a
      // positional placeholder, which is unique per row anyway.
      ;(d.debag ?? []).forEach((r: any, i: number) => {
        if (num(r.nett) === 0) return
        const lot = (r.lot || p.lot || '—').trim()
        const label = String(r.bag_no ?? '').trim()
        if (label) {
          // Lot compared by identity, not by how it was typed: live data holds
          // `MAT-0375` and `  MAT- 0375` in one session, and a copy either side
          // of that correction is still a copy.
          const identity = `${normalizeLot(lot)}|${label}`
          if (seenSievingBag.has(identity)) { duplicatesHidden++; return }
          seenSievingBag.add(identity)
        }
        const row: DebagRow = { bagNo: label || `Bulk bag ${i + 1}`, kg: num(r.nett), variant: p.variant, loggedAt: r.logged_at }
        const g = map.get(lot)
        if (g) { g.rows.push(row); g.totalKg += num(r.nett) }
        else map.set(lot, { lot, rows: [row], totalKg: num(r.nett) })
      })
    }
  })
  return { groups: Array.from(map.values()), bucketInKg, bucketOutKg, machineKg, duplicatesHidden }
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
    } else if ('byProducts' in d) {
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
  productions, dayProductions, sectionId, sessionId, sectionName, sectionColor, date, shift, showSerials = false,
  productionOrders, locked = false, blenderRatios,
}: {
  productions: Production[]
  // Every production for the WHOLE DAY (both shifts). Used for the mass balance
  // and nothing else: the tables below stay this record's own capture, so they
  // still match the Capture tab bag for bag, while the balance answers the
  // question actually asked of it -- did the day close. Omitted by callers that
  // have only one shift's worth, in which case the balance is this record's.
  dayProductions?: Production[]
  sectionId?: string; sessionId?: string | null
  sectionName: string; sectionColor: string; date: string; shift: string; showSerials?: boolean
  productionOrders?: any; locked?: boolean
  blenderRatios?: BlenderRatioGroup[]
}) {
  const [copied, setCopied] = useState(false)
  const [expandedProducts,  setExpandedProducts]  = useState<Set<string>>(new Set())
  const [expandedLots,      setExpandedLots]      = useState<Set<string>>(new Set())
  const [expandedDebagLots, setExpandedDebagLots] = useState<Set<string>>(new Set())
  const [filterProduct, setFilterProduct] = useState('')
  const [filterVariant, setFilterVariant] = useState('')
  const [filterGrade,   setFilterGrade]   = useState('')
  const [showFilters,   setShowFilters]   = useState(false)

  const { groups: debagGroups, bucketInKg, bucketOutKg, machineKg, duplicatesHidden } = useMemo(() => buildDebagLotGroups(productions), [productions])
  const productGroups = useMemo(() => buildProductGroups(productions), [productions])

  // ── Half-bag top-ups ──────────────────────────────────────────────────────
  // A top-up is a deliberate side-channel write (see HalfBagTopUpModal) that
  // never reaches a batch's outputs array, so every total on this screen was
  // short by exactly that weight. Only mode === 'production' counts: it logs a
  // plain 'bagging_out' row (carrying the HALF_BAG_TOPUP notes prefix) because
  // the weight is genuinely new product. A mode === 'existing' bag-to-bag
  // transfer logs 'topped_up' instead and must NOT be counted — it moves
  // weight already counted as output when its SOURCE bag was bagged.
  // Carries what the activity card carries -- product, variant, batch and the
  // time -- because a top-up folded silently into a total is exactly what made
  // the output figure unexplainable. Shown as its own line under its product.
  interface TopUp { serial: string; kg: number; productType: string | null; variant: string | null; batch: string | null; at: string | null }
  const [topUpRows, setTopUpRows] = useState<TopUp[]>([])
  const [dayTopUpKg, setDayTopUpKg] = useState(0)
  useEffect(() => {
    if (!sectionId) { setTopUpRows([]); setDayTopUpKg(0); return }
    let cancelled = false
    ;(async () => {
      const db = getDb().schema('production')
      // Every session for this section on this date -- the day-wide balance
      // needs the other shift's top-ups too, and scan_events only knows
      // session_id.
      const { data: daySess } = await db.from('prod_sessions')
        .select('id').eq('section_id', sectionId).eq('date', date)
      const dayIds = ((daySess as any[]) ?? []).map(r => r.id as string)
      if (!dayIds.length) { if (!cancelled) { setTopUpRows([]); setDayTopUpKg(0) } ; return }

      const { data } = await db.from('scan_events')
        .select('serial_number, weight_kg, notes, scanned_at, session_id')
        .eq('section_id', sectionId).in('session_id', dayIds).eq('action', 'bagging_out')
      if (cancelled) return
      const all = ((data as any[]) ?? []).filter(r => String(r.notes ?? '').startsWith('HALF_BAG_TOPUP'))

      // Product and variant come from the bag that was topped up.
      const serials = Array.from(new Set(all.map(r => String(r.serial_number))))
      const tagBySerial = new Map<string, any>()
      if (serials.length) {
        const { data: tags } = await db.from('bag_tags')
          .select('serial_number, product_type, variant').in('serial_number', serials)
        for (const t of ((tags as any[]) ?? [])) tagBySerial.set(t.serial_number, t)
      }
      if (cancelled) return

      const shape = (r: any): TopUp => {
        const tag = tagBySerial.get(String(r.serial_number))
        const m = /^HALF_BAG_TOPUP:\s*(.+)$/.exec(String(r.notes ?? '').trim())
        return {
          serial: String(r.serial_number), kg: Number(r.weight_kg) || 0,
          productType: tag?.product_type ?? null, variant: tag?.variant ?? null,
          batch: m ? m[1] : null, at: r.scanned_at ?? null,
        }
      }
      setTopUpRows(sessionId ? all.filter(r => r.session_id === sessionId).map(shape) : [])
      setDayTopUpKg(all.reduce((t, r) => t + (Number(r.weight_kg) || 0), 0))
    })()
    return () => { cancelled = true }
  }, [sectionId, sessionId, date])

  const debagOnlyKg   = debagGroups.reduce((s, g) => s + g.totalKg, 0)
  const baggedOnlyKg  = productGroups.reduce((s, g) => s + g.totalKg, 0)
  const totalBags     = productGroups.reduce((s, g) => s + g.totalCount, 0)
  const hasData       = debagGroups.length > 0 || productGroups.length > 0
  const poStr         = formatPO(productionOrders)

  // EVERY top-up increment counts, including one into a bag bagged earlier the
  // same day. HalfBagTopUpModal never touches draft_data (it says so at the top
  // of that file) -- the increment lives only in bag_tags and scan_events -- so
  // a bag captured at 300 kg still reads 300 kg in the local array after being
  // topped up by 22. Excluding same-day tops-ups, as this did, therefore left
  // the displayed output SHORT by them rather than protecting against a double
  // count.
  //
  // Only the increment, and only today's: that weight was produced today. A
  // top-up on a later day belongs to that day's total, and the full history of
  // a bag -- how many times, when, how much -- stays on its scan_events rows,
  // which are never rewritten.
  const freshTopUps = topUpRows
  const topUpKg = freshTopUps.reduce((t, r) => t + r.kg, 0)
  // Keyed by the product of the bag that was topped up, so each one can sit
  // under that product's own heading in the bagging list instead of only
  // appearing as an unexplained "+22.0 kg" on the total.
  const topUpsByProduct = useMemo(() => {
    const m = new Map<string, TopUp[]>()
    for (const r of freshTopUps) {
      const k = (r.productType || 'Other').trim()
      const cur = m.get(k)
      if (cur) cur.push(r); else m.set(k, [r])
    }
    return m
  }, [topUpRows])
  // A top-up into a product nothing was bagged of today has no group to sit
  // under, so it needs one of its own or it would vanish from the list while
  // still counting toward the total.
  const orphanTopUpProducts = useMemo(
    () => Array.from(topUpsByProduct.keys()).filter(k => !productGroups.some(g => g.product === k)),
    [topUpsByProduct, productGroups])

  // ── Mass balance: Total Output − Total Input ───────────────────────────────
  // One figure, computed one way, from the same rows the tables below show.
  //
  // Total Input  = everything debagged, plus machine spillage, plus the bucket
  //                elevator carried in from the previous day. That carry-over
  //                is only ever this run's input when it is the same variant,
  //                and here it always is: production.bucket_elevator_log keeps
  //                conventional and organic as separate pools that never sum
  //                across each other (lib/production/bucket-elevator.ts), and
  //                a shift can only draw on its own family's balance. So there
  //                is no cross-variant carry-over to exclude at this level.
  // Total Output = bags bagged out, plus half-bag TOP-UP INCREMENTS — the
  //                weight added into an older bag today, never that bag's full
  //                weight.
  //                The bucket elevator this afternoon shift LEAVES for tomorrow
  //                is work in progress, not product: excluded from output
  //                entirely rather than counted on either side.
  //
  // Read as out − in, so the normal case (moisture, dust, spillage) is a
  // NEGATIVE number that says "material lost" at a glance. Flagged outside ±1%
  // of total input — the tolerance a real run is expected to close within.
  // ── One mass balance per shift, unless a changeover happened ─────────────
  // Normally a shift runs one grade and one balance is the whole story. A
  // changeover splits the shift into two products under one record, and a
  // single pair of totals then hides which is which -- exactly what made the
  // 31-08 production order unreadable.
  //
  // Split only when this record actually holds more than one grade. Input and
  // output are captured per bag so both are real per grade; the bucket elevator
  // and machine spillage are not attributable to one grade (the elevator
  // carries material across the changeover), so they sit on their own line and
  // the split still adds up to the totals.
  const gradeOf = (p: Production) => GRADE_TO_LOCAL_EXPORT[p.grade] ?? (p.grade || '').trim()
  const gradeTotals = useMemo(() => {
    const m = new Map<string, { grade: string; inKg: number; outKg: number; bags: number }>()
    const bump = (g: string, patch: Partial<{ inKg: number; outKg: number; bags: number }>) => {
      const cur = m.get(g) ?? { grade: g, inKg: 0, outKg: 0, bags: 0 }
      cur.inKg  += patch.inKg  ?? 0
      cur.outKg += patch.outKg ?? 0
      cur.bags  += patch.bags  ?? 0
      m.set(g, cur)
    }
    productions.forEach(p => {
      const g = gradeOf(p)
      if (!g) return
      const d = p.data as any
      // Sieving only: the other sections have one grade per record, so this
      // whole block collapses to a single row for them anyway.
      ;(d.debag ?? []).forEach((r: any) => { if (num(r.nett) > 0) bump(g, { inKg: num(r.nett) }) })
      ;(d.outputs ?? []).forEach((b: any) => {
        if (num(b.weight) === 0) return
        bump(g, { outKg: num(b.weight), bags: 1 })
      })
    })
    return Array.from(m.values()).sort((a, b) => a.grade.localeCompare(b.grade))
  }, [productions])
  const showGradeSplit = gradeTotals.length > 1

  // The balance is the DAY's, computed from the same builders the tables use so
  // the two can never drift apart in method -- only in scope, which is stated
  // on the panel.
  const spansDay = !!dayProductions && dayProductions.length > productions.length
  const dayDebag = useMemo(
    () => buildDebagLotGroups(spansDay ? dayProductions! : productions),
    [spansDay, dayProductions, productions])
  const dayProducts = useMemo(
    () => buildProductGroups(spansDay ? dayProductions! : productions),
    [spansDay, dayProductions, productions])
  const dayDebagKg   = dayDebag.groups.reduce((t, g) => t + g.totalKg, 0)
  const dayBaggedKg  = dayProducts.reduce((t, g) => t + g.totalKg, 0)
  // Every increment the day recorded, for the same reason as above: none of
  // them reach draft_data, so none of them are already in dayBaggedKg.
  const dayTopUpNew = spansDay ? dayTopUpKg : topUpKg

  const mbInputKg  = dayDebagKg + dayDebag.bucketInKg + dayDebag.machineKg
  const mbOutputKg = dayBaggedKg + Math.max(0, dayTopUpNew)
  const balanceKg  = mbOutputKg - mbInputKg
  const balancePct = mbInputKg > 0 ? (balanceKg / mbInputKg) * 100 : 0
  const withinTol  = mbInputKg > 0 ? Math.abs(balanceKg) <= mbInputKg * MASS_BALANCE_TOLERANCE_PCT : true
  const yieldPct   = mbInputKg > 0 ? Math.round((mbOutputKg / mbInputKg) * 1000) / 10 : null

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
    if (bucketInKg > 0 || machineKg > 0) {
      lines.push(`Debagged (excl. spillage)\t\t\t${debagOnlyKg.toFixed(1)}`)
      if (bucketInKg > 0) lines.push(`Bucket elevator (from yesterday)\t\t\t${bucketInKg.toFixed(1)}`)
      if (machineKg > 0) lines.push(`Machine spillage\t\t\t${machineKg.toFixed(1)}`)
    }
    lines.push(`Total input\t\t\t${mbInputKg.toFixed(1)}`)
    lines.push('', 'BAGGING', 'Product\tLot\tVariant\tGrade\tBags\tWeight (kg)')
    productGroups.forEach(g => {
      g.lots.forEach(l => lines.push(`${g.product}\t${l.lot}\t${l.variant}\t${l.grade}\t${l.count}\t${l.kg.toFixed(1)}`))
      if (g.lots.length > 1) lines.push(`Total ${g.product}\t\t\t\t${g.totalCount}\t${g.totalKg.toFixed(1)}`)
    })
    if (topUpKg > 0) lines.push(`Half-bag top-ups (added into older bags)\t\t\t\t\t${topUpKg.toFixed(1)}`)
    lines.push('', `Total output\t\t\t\t${totalBags}\t${mbOutputKg.toFixed(1)}`)
    if (bucketOutKg > 0) lines.push(`Bucket elevator (left for tomorrow — not output)\t\t\t\t\t${bucketOutKg.toFixed(1)}`)
    lines.push(`Balance (out − in)\t\t\t\t\t${balanceKg >= 0 ? '+' : ''}${balanceKg.toFixed(1)}`)
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
            {(debagGroups.length > 0 || bucketInKg > 0) && (
              <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: DEBAG_BLUE + '40' }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ background: DEBAG_BLUE + '12' }}>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: DEBAG_BLUE }}>
                    <Package size={14} /> Debagging — in
                    {duplicatesHidden > 0 && (
                      <span className="font-normal normal-case tracking-normal text-[10px] text-stone-400">
                        · {duplicatesHidden} duplicate row{duplicatesHidden === 1 ? '' : 's'} hidden
                      </span>
                    )}
                  </span>
                  <span className="font-mono font-bold text-[13px]" style={{ color: DEBAG_BLUE }}>{mbInputKg.toFixed(1)} kg</span>
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
                      <span>Debagged (excl. spillage)</span>
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
                    <span>Total input</span>
                    <span className="font-mono font-bold text-[14px] text-stone-900 normal-case">{mbInputKg.toFixed(1)} kg</span>
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
            {(productGroups.length > 0 || bucketOutKg > 0) && (
              <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: BAG_ORANGE + '40' }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ background: BAG_ORANGE + '12' }}>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: BAG_ORANGE }}>
                    <PackageCheck size={14} /> Bagging — out
                  </span>
                  <span className="font-mono font-bold text-[13px]" style={{ color: BAG_ORANGE }}>
                    {mbOutputKg.toFixed(1)} kg · {totalBags} bag{totalBags !== 1 ? 's' : ''}
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
                          {(topUpsByProduct.get(pg.product)?.length ?? 0) > 0 && (
                            <span className="font-mono text-[10.5px] font-normal text-violet-600 shrink-0">
                              +{(topUpsByProduct.get(pg.product) ?? []).reduce((t, r) => t + r.kg, 0).toFixed(1)} top-up
                            </span>
                          )}
                          <span className="font-mono font-bold text-stone-700 shrink-0">{pg.totalCount}</span>
                          <span className="font-mono font-bold text-stone-900 shrink-0 w-20 text-right">{pg.totalKg.toFixed(1)} kg</span>
                        </button>

                        {isProdOpen && (
                          <div className="divide-y divide-stone-100">
                            {/* Top-ups first: they are weight added to a bag from an
                                earlier day, not a bag of this product bagged today,
                                so they sit apart from the lot hierarchy below. */}
                            {(topUpsByProduct.get(pg.product) ?? []).map(t => (
                              <TopUpLine key={t.serial} t={t} />
                            ))}
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
                  {/* A top-up into a product nothing was bagged of today: its own
                      heading, because the weight is in Total output either way and
                      a figure in the total with no line under it is what made the
                      output unexplainable in the first place. */}
                  {orphanTopUpProducts.map(prod => {
                    const rows = topUpsByProduct.get(prod) ?? []
                    return (
                      <div key={`orphan-${prod}`}>
                        <div className="w-full flex items-center gap-2 px-3 py-2.5 font-semibold"
                          style={{ background: BAG_ORANGE + '0e' }}>
                          <span className="w-[13px] shrink-0" />
                          <span className="font-bold text-[13px] text-stone-900 truncate">{prod}</span>
                          <span className="font-mono text-[10px] font-normal text-stone-400">top-up only — no bag of this product bagged today</span>
                          <span className="flex-1" />
                          <span className="font-mono text-[10.5px] font-normal text-violet-600 shrink-0">
                            +{rows.reduce((t, r) => t + r.kg, 0).toFixed(1)} top-up
                          </span>
                          <span className="font-mono font-bold text-stone-700 shrink-0">0</span>
                          <span className="font-mono font-bold text-stone-900 shrink-0 w-20 text-right">
                            {rows.reduce((t, r) => t + r.kg, 0).toFixed(1)} kg
                          </span>
                        </div>
                        <div className="divide-y divide-stone-100">
                          {rows.map(t => <TopUpLine key={t.serial} t={t} />)}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Totals — the same parts the mass balance adds up, in the
                    same order and under the same names, so the panel below can
                    be checked against this card line by line. The bucket
                    elevator this afternoon shift leaves for tomorrow morning is
                    a different physical quantity from bucketInKg above, and is
                    NOT product: it sits below the total, not inside it. */}
                <div className="border-t-2 border-stone-300 divide-y divide-stone-100">
                  {(bucketOutKg > 0 || topUpKg > 0) && productGroups.length > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                      <span>Bagged out</span>
                      <span className="font-mono font-bold text-stone-800 normal-case">{totalBags} bags · {baggedOnlyKg.toFixed(1)} kg</span>
                    </div>
                  )}
                  {topUpKg > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 text-[12px] font-medium text-violet-700" style={{ background: '#7c3aed0d' }}>
                      <span className="flex items-center gap-1.5"><Scale size={12} className="text-violet-500" /> Half-bag top-ups — added into older bags</span>
                      <span className="font-mono">+{topUpKg.toFixed(1)} kg</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-3 py-2.5 font-bold text-[12px] text-stone-800 uppercase tracking-wide" style={{ background: BAG_ORANGE + '08' }}>
                    <span>Total output</span>
                    <span className="flex items-center gap-3 normal-case">
                      <span className="font-mono font-bold text-stone-900">{totalBags} bags</span>
                      <span className="font-mono font-bold text-[14px] text-stone-900">{mbOutputKg.toFixed(1)} kg</span>
                    </span>
                  </div>
                  {bucketOutKg > 0 && (
                    <div className="flex items-start justify-between gap-3 px-3 py-2 text-[12px] font-medium text-amber-700" style={{ background: '#f59e0b0d' }}>
                      <span className="flex items-start gap-1.5">
                        <Scale size={12} className="text-amber-500 shrink-0 mt-0.5" />
                        <span>Bucket elevator — left for tomorrow
                          <span className="block text-[10.5px] font-normal text-amber-600/80">work in progress · not counted as output</span>
                        </span>
                      </span>
                      <span className="font-mono shrink-0">{bucketOutKg.toFixed(1)} kg</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Mass balance — one figure, stated in full ──────────────
                Output − Input, over the two totals shown on the cards above.
                Everything it leaves out is named underneath, in kg, so the
                number can be checked rather than taken on trust. */}
            {(mbInputKg > 0 || mbOutputKg > 0) && (
              <div className={`rounded-xl border-2 overflow-hidden ${withinTol ? 'border-ok/30' : 'border-warn/40'}`}>
                <div className={`flex items-center justify-between px-3 py-2 ${withinTol ? 'bg-ok/5' : 'bg-warn/5'}`}>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-stone-700">
                    <Scale size={14} className="text-stone-500" /> Mass balance
                    <span className="font-normal text-[10.5px] text-stone-400">
                      output − input · {spansDay ? 'full day, both shifts' : 'this shift'}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono font-bold text-[14px]">
                    <span className={withinTol ? 'text-ok' : 'text-warn'}>
                      {balanceKg >= 0 ? '+' : ''}{balanceKg.toFixed(1)} kg
                      {mbInputKg > 0 && <span className="font-normal text-[12px]"> ({balancePct >= 0 ? '+' : ''}{balancePct.toFixed(1)}%)</span>}
                    </span>
                    {withinTol ? <CheckCircle2 size={14} className="text-ok" /> : <AlertTriangle size={14} className="text-warn" />}
                  </span>
                </div>
                <div className="grid grid-cols-3 divide-x divide-stone-100 border-t border-stone-100 bg-white">
                  {[
                    { label: 'Total input',  value: `${mbInputKg.toFixed(1)} kg` },
                    { label: 'Total output', value: `${mbOutputKg.toFixed(1)} kg` },
                    { label: 'Yield',        value: yieldPct != null ? `${yieldPct}%` : '—' },
                  ].map(t => (
                    <div key={t.label} className="px-3 py-2.5">
                      <div className="font-mono font-bold text-[15px] leading-tight text-stone-800">{t.value}</div>
                      <div className="text-[9.5px] text-stone-400 uppercase tracking-wide">{t.label}</div>
                    </div>
                  ))}
                </div>
                {/* Which of those kilograms are which grade. Only on a
                    changeover record -- one grade, one balance, no extra table. */}
                {showGradeSplit && (
                  <div className="border-t border-stone-100 divide-y divide-stone-100">
                    <div className="px-3 py-1.5 bg-stone-50 text-[10px] font-semibold text-stone-500 uppercase tracking-wide">
                      By grade — this shift changed over
                    </div>
                    {gradeTotals.map(g => (
                      <div key={g.grade} className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
                        <span className="font-medium text-stone-700">{g.grade}</span>
                        <span className="flex items-center gap-4 font-mono text-stone-600 tabular-nums">
                          <span>in {g.inKg.toFixed(1)}</span>
                          <span>out {g.outKg.toFixed(1)}</span>
                          <span className="text-stone-400">{g.bags} bag{g.bags === 1 ? '' : 's'}</span>
                        </span>
                      </div>
                    ))}
                    {(bucketInKg > 0 || machineKg > 0 || bucketOutKg > 0 || topUpKg > 0) && (
                      <div className="flex items-start justify-between gap-3 px-3 py-2 text-[11.5px] text-stone-500">
                        <span>Not attributable to one grade
                          <span className="block text-[10.5px] text-stone-400">bucket elevator across the changeover, machine spillage, half-bag top-ups</span>
                        </span>
                        <span className="font-mono tabular-nums shrink-0">
                          in {(bucketInKg + machineKg).toFixed(1)} · out {topUpKg.toFixed(1)}
                        </span>
                      </div>
                    )}
                    <p className="px-3 py-2 bg-stone-50/60 text-[11px] text-stone-500 leading-relaxed">
                      No balance per grade: the tower is one stream, so the elevator carries material
                      across the changeover and what went in as one grade can come out as the other.
                      The figures above are captured per bag and are real; a balance per grade would
                      not be.
                    </p>
                  </div>
                )}
                <p className="px-3 py-2.5 border-t border-stone-100 bg-stone-50/60 text-[11.5px] text-stone-500 leading-relaxed">
                  Input is everything debagged plus machine spillage
                  {bucketInKg > 0 && <>, plus the {bucketInKg.toFixed(1)} kg of bucket elevator carried in from yesterday (always this run&apos;s own variant — the carry-over ledger keeps conventional and organic apart)</>}.
                  {' '}Output is bags bagged out
                  {topUpKg > 0 && <> plus the {topUpKg.toFixed(1)} kg added into other bags by half-bag top-up — only the amount added today, never a topped bag&apos;s full weight, and never an increment from another day</>}.
                  {bucketOutKg > 0 && <> The {bucketOutKg.toFixed(1)} kg left in the elevator for tomorrow is work in progress and counts on neither side.</>}
                  {duplicatesHidden > 0 && <> Excludes {duplicatesHidden} duplicate debagging row{duplicatesHidden === 1 ? '' : 's'} left by the changeover fault.</>}
                  {spansDay && <> These totals are the <strong>whole day, both shifts</strong> — the
                  debagging and bagging tables above are this record&apos;s own capture, which is why
                  they are smaller.</>}
                  {' '}Flagged outside ±1% of total input.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default CaptureOverview
