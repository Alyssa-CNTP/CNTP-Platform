// lib/production/order-detail.ts
// Assembles EVERYTHING for one PRODUCTION DAY (all shift sessions that share a
// section_id + date — morning 07h00–16h00 and afternoon/night 16h00–01h00 roll
// up into one production order) in a single call: the per-shift blocks (each
// with its own mass balance, sign-off signatures, AI check summary and reopen
// history), the whole-run output-bag list (from the reliable bag_tags ledger),
// the combined debagging inputs, and the summed mass balance. Shared by the
// detail page so the report always shows the same data.

import { getDb } from '@/lib/supabase/db'
import { massBalanceToleranceFor } from '@/lib/production/capture-config'

export interface OrderSession {
  id: string
  section_id: string
  date: string
  shift: string
  status: string
  record_no: string | null
  operator_names: string[] | null
  supervisor_name: string | null
  lot_number: string | null
  variant: string | null
  production_orders: string[] | null
  op_signed: boolean
  op_name_signoff: string | null
  op_signed_at: string | null
  sup_signed: boolean
  sup_name_signoff: string | null
  sup_signed_at: string | null
  comments: string | null
  submitted_at: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

export interface OrderMassBalance {
  total_input_kg: number | null
  total_output_a_kg: number | null
  total_output_b_kg: number | null
  total_output_c_kg: number | null
  total_output_d_kg: number | null
  balance_kg: number | null
  tolerance_kg: number | null
  water_kg: number | null
  dust_extraction_kg: number | null
  floor_waste_kg: number | null
}

export interface OrderBagRow {
  id: string
  bag_no: number
  output_group: string | null
  bag_serial_no: string | null
  product_type: string | null
  variant: string | null
  acumatica_id: string | null
  kg: number
  bagging_time: string | null
  session_id: string        // which shift-session produced this bag
  shift: string             // 'morning' | 'afternoon' | 'night'
  // true when this bag's FIRST-EVER scan_events row is 'topped_up' rather
  // than 'bagging_out' — i.e. it was born via a re-bag, not fresh capture.
  // Its kg was already counted as production on the day rebagSourceSerial
  // was originally bagged, so it's excluded from bagsOutputKg everywhere
  // below (see loadOrderDay) to avoid double-counting; it still appears in
  // `bags` and in the separate `rebagRows` list.
  bornViaRebag: boolean
  rebagSourceSerial: string | null
}

// A re-bag transaction shown on its own panel, distinct from ordinary
// output bagging — informational only, deliberately never added into any
// output-kg total (that kg was already counted the day rebagSourceSerial
// was first bagged).
export interface OrderRebagRow {
  targetSerial: string
  sourceSerial: string | null
  productType: string | null
  acumaticaId: string | null
  kg: number
  at: string | null
  sessionId: string
  shift: string
}

// Fresh production weight added straight into a bag that was first bagged
// on an EARLIER day (a Half-bag Top-up filling an old open bag instead of
// starting a new one) — the target bag's own bag_tags row belongs to that
// earlier day's session, so it's invisible to the bag_tags-snapshot sum
// above unless picked up here from its own scan_events row. Unlike
// OrderRebagRow, this kg genuinely IS new output and IS folded into
// bagsOutputKg (see loadOrderDay) — it was never counted before.
export interface OrderFreshTopUpRow {
  targetSerial: string
  productType: string | null
  batch: string | null   // parsed from the scan_events row's notes, if any
  kg: number
  at: string | null
  sessionId: string
  shift: string
}

export interface OrderDebagRow {
  id: string
  bag_no: number
  bag_serial_no: string | null
  lot_number: string | null
  product_type: string | null
  variant: string | null
  kg_gross: number | null
  kg_nett: number
  delivery_date: string | null
  grade: string | null
  org_or_conv: string | null
  is_spillage: boolean
  notes: string | null
  bagging_time: string | null
  created_at: string | null
  session_id: string
  shift: string
}

export interface OrderSignature {
  signer_role: 'operator' | 'supervisor' | 'qc'
  signer_name: string
  signature_b64: string
  signed_at: string
}

export interface OrderReopenRequest {
  id: string
  requested_by_name: string | null
  reason: string
  status: string
  decided_by_name: string | null
  decision_note: string | null
  decided_at: string | null
  created_at: string
}

export interface OrderTimesheet {
  operator_name: string
  shift: string
  shift_start: string | null
  shift_end: string | null
  worked_minutes: number | null
  breaks: { type?: string; start?: string; end?: string }[]
  confirmed: boolean
}

export interface OrderTakeover {
  from_shift: string
  to_shift: string
  operator_name: string
  rostered: boolean
  taken_over_at: string
}

// One shift within the production day — its own capture record, sign-off,
// mass balance, AI check summary, timesheet and handover note.
export interface OrderShiftBlock {
  session: OrderSession
  massBalance: OrderMassBalance | null
  signatures: OrderSignature[]
  reopenRequests: OrderReopenRequest[]
  aiSummary: string | null       // Gemini machine-checks summary for this shift
  checksStatus: string | null    // in_progress | operator_signed | supervisor_verified
  timesheets: OrderTimesheet[]   // hours worked, per operator on this shift
  bagCount: number               // this shift's own output bags (Σ its rows in the day list)
  bagsOutputKg: number
}

export interface OrderPO { code: string; description: string | null }

export interface OrderDay {
  section_id: string
  date: string
  representativeSessionId: string   // earliest non-archived session — list links here
  status: string                    // aggregate day status
  grade: string | null              // production grade (A/B/C), from the capture record
  poItems: OrderPO[]                // production order codes + their Master Inventory descriptions
  shifts: OrderShiftBlock[]         // morning first
  bags: OrderBagRow[]               // merged across ALL shifts, continuous 1..N, shift-tagged
  bagsOutputKg: number              // excludes bornViaRebag rows, includes freshTopUps — see OrderBagRow/OrderFreshTopUpRow
  rebagRows: OrderRebagRow[]        // bags born via re-bag on this day, shift-tagged
  freshTopUps: OrderFreshTopUpRow[] // today's production added into an older bag, shift-tagged
  debags: OrderDebagRow[]           // all shifts, morning first
  massBalance: OrderMassBalance | null   // whole-run (summed per-shift)
  reopenRequests: OrderReopenRequest[]   // union across shifts
  timesheets: OrderTimesheet[]      // all operators across the day, shift-tagged
  takeovers: OrderTakeover[]        // shift hand-over records (16h00 changeover)
}

// morning → 0, afternoon/night → 1; created_at breaks ties.
function shiftRank(shift: string): number { return shift === 'morning' ? 0 : 1 }

// Aggregate a day's status from its shifts. Only shifts that actually captured
// something count, so an abandoned empty afternoon draft never drags a
// signed-off morning back to "In progress".
export function aggregateDayStatus(shifts: OrderShiftBlock[]): string {
  const withData = shifts.filter(b => b.bagCount > 0 || b.massBalance || b.session.status !== 'draft')
  const rel = withData.length ? withData : shifts
  if (rel.length && rel.every(b => b.session.status === 'approved')) return 'approved'
  if (rel.some(b => b.session.status === 'draft' || b.session.status === 'new')) return 'draft'
  return 'submitted'
}

// Whole-run mass balance = honest SUM of each shift's own balance (each shift
// already booked its own bucket-elevator direction, so the day total doesn't
// re-net the elevator).
function sumMassBalance(shifts: OrderShiftBlock[], sectionId: string): OrderMassBalance | null {
  const mbs = shifts.map(s => s.massBalance).filter(Boolean) as OrderMassBalance[]
  if (!mbs.length) return null
  const sum = (f: keyof OrderMassBalance) => mbs.reduce((t, m) => t + (Number(m[f]) || 0), 0)
  const total_input_kg = sum('total_input_kg')
  const a = sum('total_output_a_kg'), b = sum('total_output_b_kg'), c = sum('total_output_c_kg'), d = sum('total_output_d_kg')
  return {
    total_input_kg,
    total_output_a_kg: a, total_output_b_kg: b, total_output_c_kg: c, total_output_d_kg: d,
    balance_kg: total_input_kg - (a + b + c + d),
    tolerance_kg: massBalanceToleranceFor(sectionId),
    water_kg: sum('water_kg'), dust_extraction_kg: sum('dust_extraction_kg'), floor_waste_kg: sum('floor_waste_kg'),
  }
}

// Merge the authoritative per-bag ledger (bag_tags) with the structured
// prod_bagging rows into one reliable output-bag list, across the WHOLE day.
//
// bag_tags is written ATOMICALLY, one row per physical bag, the moment the bag
// is tagged — it never loses a bag to the prod_bagging delete+reinsert race
// that intermittently drops bags (seen live: 11 real bags, 1 in prod_bagging).
// It's the same ledger Quality's QC queue reads, so the order and Quality can
// never disagree about which bags exist. prod_bagging only ENRICHES with the
// output group + recorded time. Serials are unique across the whole production
// day, so feeding both shifts' rows in one pass yields a correct day-wide
// voided-set and a continuous 1..N. Each row is tagged with its session_id so
// the caller can attribute it to a shift.
//
// - active bag_tags rows  → the spine (authoritative existence + weight/type)
// - prod_bagging-only rows (no-serial by-products, Pasteuriser range rows) → kept
// - voided bag_tags serials → excluded everywhere (even if prod_bagging lags)
//
// firstEvent: each active serial's EARLIEST scan_events row (action +
// related_serial_number) — used only to tell a bag born via re-bag
// ('topped_up' as its first-ever row) apart from an ordinary bag that was
// merely topped up LATER (whose first row is still 'bagging_out'). A bag
// with no scan_events row at all (shouldn't happen, but defensively) is
// treated as an ordinary bag, not a re-bag.
function mergeOutputBags(
  tags: any[], bagging: any[],
  firstEvent: Map<string, { action: string; related_serial_number: string | null }>,
): OrderBagRow[] {
  const voided = new Set(tags.filter(t => t.status === 'voided').map(t => t.serial_number))
  const active = tags.filter(t => t.status !== 'voided')

  const pbBySerial = new Map<string, any>()
  const pbNoSerial: any[] = []
  for (const r of bagging) {
    if (r.bag_serial_no) pbBySerial.set(r.bag_serial_no, r)
    else pbNoSerial.push(r)
  }

  const rows: OrderBagRow[] = []
  const base = { bag_no: 0, shift: '' }

  for (const t of active) {
    const pb = pbBySerial.get(t.serial_number)
    pbBySerial.delete(t.serial_number)
    const fe = firstEvent.get(t.serial_number)
    const bornViaRebag = fe?.action === 'topped_up'
    rows.push({
      ...base, id: t.serial_number,
      output_group: pb?.output_group ?? null,
      bag_serial_no: t.serial_number,
      product_type: t.product_type ?? pb?.product_type ?? null,
      variant: t.variant ?? pb?.variant ?? null,
      acumatica_id: t.acumatica_id ?? null,
      kg: Number(t.weight_kg) || 0,
      bagging_time: pb?.bagging_time ?? t.printed_at ?? null,
      session_id: t.session_id,
      bornViaRebag,
      rebagSourceSerial: bornViaRebag ? (fe?.related_serial_number ?? null) : null,
    })
  }
  for (const pb of pbBySerial.values()) {
    if (voided.has(pb.bag_serial_no)) continue
    rows.push({
      ...base, id: pb.id, output_group: pb.output_group ?? null,
      bag_serial_no: pb.bag_serial_no, product_type: pb.product_type ?? null,
      variant: pb.variant ?? null, acumatica_id: null,
      kg: Number(pb.kg) || 0, bagging_time: pb.bagging_time ?? null,
      session_id: pb.session_id, bornViaRebag: false, rebagSourceSerial: null,
    })
  }
  for (const pb of pbNoSerial) {
    rows.push({
      ...base, id: pb.id, output_group: pb.output_group ?? null,
      bag_serial_no: null, product_type: pb.product_type ?? null,
      variant: pb.variant ?? null, acumatica_id: null,
      kg: Number(pb.kg) || 0, bagging_time: pb.bagging_time ?? null,
      session_id: pb.session_id, bornViaRebag: false, rebagSourceSerial: null,
    })
  }

  rows.sort((a, b) => {
    const ta = a.bagging_time ? Date.parse(a.bagging_time) : Infinity
    const tb = b.bagging_time ? Date.parse(b.bagging_time) : Infinity
    return ta - tb
  })
  rows.forEach((r, i) => { r.bag_no = i + 1 })
  return rows
}

function group<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r) }
  return m
}

// Load the whole production day that `sessionId` belongs to.
export async function loadOrderDay(sessionId: string): Promise<OrderDay | null> {
  const db = getDb().schema('production')

  const { data: clicked } = await db.from('prod_sessions').select('section_id,date').eq('id', sessionId).maybeSingle()
  if (!clicked) return null
  const section_id = (clicked as any).section_id as string
  const date = (clicked as any).date as string

  const { data: sessRaw } = await db.from('prod_sessions').select('*')
    .eq('section_id', section_id).eq('date', date)
  const sessions = ((sessRaw as any[]) ?? []).sort(
    (a, b) => shiftRank(a.shift) - shiftRank(b.shift) || String(a.created_at).localeCompare(String(b.created_at)),
  )
  if (!sessions.length) return null

  const ids = sessions.map(s => s.id)
  const shiftBySession = new Map<string, string>(sessions.map(s => [s.id, s.shift]))

  // Grade lives on the capture record (draft_data.productions[].grade), not a
  // session column — take the first production's grade across the day.
  const grade: string | null = sessions
    .flatMap(s => ((s.draft_data?.productions ?? []) as any[]).map(p => p?.grade))
    .find((g: any) => !!g) ?? null

  // Every production-order code used across the day, resolved to its Master
  // Inventory description so the report shows "CODE — Description".
  const poCodes = Array.from(new Set(sessions.flatMap(s => (s.production_orders ?? []) as string[]).filter(Boolean)))

  const [mbRes, tagsRes, bagsRes, debagsRes, sigRes, reopenRes, checksRes, tsRes, takeoverRes, invRes] = await Promise.all([
    db.from('prod_mass_balance').select('*').in('session_id', ids),
    db.from('bag_tags').select('session_id,serial_number,product_type,variant,acumatica_id,weight_kg,printed_at,status').in('session_id', ids),
    db.from('prod_bagging').select('*').in('session_id', ids),
    db.from('prod_debagging').select('*').in('session_id', ids).order('bag_no'),
    db.from('session_signatures').select('*').in('session_id', ids),
    db.from('po_reopen_requests').select('*').in('session_id', ids).order('created_at', { ascending: false }),
    // AI check summary is keyed by (section_id, date, shift), not session_id.
    db.from('check_records').select('shift,ai_summary,status').eq('section_id', section_id).eq('date', date),
    db.from('prod_timesheets').select('*').in('session_id', ids),
    db.from('shift_takeovers').select('*').in('session_id', ids).order('taken_over_at'),
    poCodes.length
      ? db.from('inventory_items').select('inventory_id,description').in('inventory_id', poCodes)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const descByCode = new Map<string, string>(((invRes.data as any[]) ?? []).map(r => [r.inventory_id, r.description]))
  const poItems: OrderPO[] = poCodes.map(code => ({ code, description: descByCode.get(code) ?? null }))
  // Earliest scan_events row per active serial — tells a bag born via
  // re-bag ('topped_up' as its first-ever row) apart from an ordinary bag
  // topped up later (still 'bagging_out' first). One batched query, not one
  // per bag: fetch every event for this day's active serials, ordered, then
  // take each serial's first occurrence.
  const activeSerials = ((tagsRes.data as any[]) ?? [])
    .filter(t => t.status !== 'voided').map(t => t.serial_number)
  const firstEventBySerial = new Map<string, { action: string; related_serial_number: string | null }>()
  if (activeSerials.length) {
    const { data: evData } = await db.from('scan_events')
      .select('serial_number, action, related_serial_number, scanned_at')
      .in('serial_number', activeSerials)
      .order('scanned_at', { ascending: true })
    for (const ev of (evData as any[]) ?? []) {
      if (!firstEventBySerial.has(ev.serial_number)) {
        firstEventBySerial.set(ev.serial_number, { action: ev.action, related_serial_number: ev.related_serial_number ?? null })
      }
    }
  }

  const mbBySession = new Map<string, OrderMassBalance>(((mbRes.data as any[]) ?? []).map(m => [m.session_id, m]))
  const sigBySession = group<any>((sigRes.data as any[]) ?? [], (s: any) => s.session_id) as Map<string, OrderSignature[]>
  const reopenBySession = group<any>((reopenRes.data as any[]) ?? [], (r: any) => r.session_id) as Map<string, OrderReopenRequest[]>
  const checkByShift = new Map<string, any>(((checksRes.data as any[]) ?? []).map(c => [c.shift, c]))
  const tsBySession = group<any>((tsRes.data as any[]) ?? [], (t: any) => t.session_id)
  const timesheets: OrderTimesheet[] = ((tsRes.data as any[]) ?? []).map(t => ({
    operator_name: t.operator_name, shift: shiftBySession.get(t.session_id) ?? '',
    shift_start: t.shift_start, shift_end: t.shift_end, worked_minutes: t.worked_minutes,
    breaks: Array.isArray(t.breaks) ? t.breaks : [], confirmed: !!t.confirmed,
  }))
  const takeovers: OrderTakeover[] = ((takeoverRes.data as any[]) ?? []).map(t => ({
    from_shift: t.from_shift, to_shift: t.to_shift, operator_name: t.operator_name,
    rostered: !!t.rostered, taken_over_at: t.taken_over_at,
  }))

  // Whole-day output bags, then attribute each to its shift.
  const bags = mergeOutputBags((tagsRes.data as any[]) ?? [], (bagsRes.data as any[]) ?? [], firstEventBySerial)
  bags.forEach(b => { b.shift = shiftBySession.get(b.session_id) ?? '' })

  // Re-bag transactions shown on their own panel — never folded into
  // bagsOutputKg (see OrderBagRow/mergeOutputBags): that kg was already
  // counted as output on whatever earlier day rebagSourceSerial was
  // originally bagged.
  const rebagRows: OrderRebagRow[] = bags.filter(b => b.bornViaRebag && b.bag_serial_no).map(b => ({
    targetSerial: b.bag_serial_no as string, sourceSerial: b.rebagSourceSerial,
    productType: b.product_type, acumaticaId: b.acumatica_id,
    kg: b.kg, at: b.bagging_time, sessionId: b.session_id, shift: b.shift,
  }))

  // "From today's production" Half-bag Top-ups into a bag first bagged on
  // an EARLIER day — that bag's own bag_tags row belongs to that day's
  // session, so it never appears in `bags` above at all. addFreshWeightToBag
  // always marks its scan_events row's notes with HALF_BAG_TOPUP, so this
  // is never confused with an ordinary bag's own first-ever 'bagging_out'
  // row. A same-day bag's own 'bagging_out' rows — its original creation, or
  // a same-day top-up — are already fully reflected in its bag_tags.weight_kg
  // snapshot above, so they're excluded here (via todaysBagSerials) too, to
  // avoid double-counting.
  const todaysBagSerials = new Set(bags.map(b => b.bag_serial_no).filter(Boolean) as string[])
  const { data: freshEvData } = await db.from('scan_events')
    .select('serial_number, session_id, weight_kg, notes, scanned_at')
    .in('session_id', ids).eq('action', 'bagging_out').ilike('notes', 'HALF_BAG_TOPUP%')
  const freshRows = ((freshEvData as any[]) ?? [])
    .filter(e => e.serial_number && !todaysBagSerials.has(e.serial_number))
  const freshSerials = Array.from(new Set(freshRows.map(e => e.serial_number)))
  let freshProductBySerial = new Map<string, string | null>()
  if (freshSerials.length) {
    const { data: freshTagsData } = await db.from('bag_tags')
      .select('serial_number, product_type').in('serial_number', freshSerials)
    freshProductBySerial = new Map(((freshTagsData as any[]) ?? []).map((t: any) => [t.serial_number, t.product_type ?? null]))
  }
  const freshTopUps: OrderFreshTopUpRow[] = freshRows.map(e => {
    const m = /^HALF_BAG_TOPUP:\s*(.+)$/.exec((e.notes ?? '').trim())
    return {
      targetSerial: e.serial_number, productType: freshProductBySerial.get(e.serial_number) ?? null,
      batch: m ? m[1] : null, kg: Number(e.weight_kg) || 0, at: e.scanned_at,
      sessionId: e.session_id, shift: shiftBySession.get(e.session_id) ?? '',
    }
  })
  const freshKgBySession = new Map<string, number>()
  for (const r of freshTopUps) freshKgBySession.set(r.sessionId, (freshKgBySession.get(r.sessionId) ?? 0) + r.kg)

  // Debag inputs across the day, tagged with shift and sorted by time.
  const debags: OrderDebagRow[] = ((debagsRes.data as any[]) ?? []).map(d => ({
    ...d, shift: shiftBySession.get(d.session_id) ?? '',
  })).sort((a, b) => {
    const ta = a.bagging_time ? Date.parse(a.bagging_time) : a.created_at ? Date.parse(a.created_at) : Infinity
    const tb = b.bagging_time ? Date.parse(b.bagging_time) : b.created_at ? Date.parse(b.created_at) : Infinity
    return ta - tb
  })

  const shifts: OrderShiftBlock[] = sessions.map(s => {
    const own = bags.filter(b => b.session_id === s.id)
    const chk = checkByShift.get(s.shift)
    return {
      session: s as OrderSession,
      massBalance: mbBySession.get(s.id) ?? null,
      signatures: sigBySession.get(s.id) ?? [],
      reopenRequests: reopenBySession.get(s.id) ?? [],
      aiSummary: chk?.ai_summary ?? null,
      checksStatus: chk?.status ?? null,
      timesheets: (tsBySession.get(s.id) ?? []).map((t: any) => ({
        operator_name: t.operator_name, shift: s.shift,
        shift_start: t.shift_start, shift_end: t.shift_end, worked_minutes: t.worked_minutes,
        breaks: Array.isArray(t.breaks) ? t.breaks : [], confirmed: !!t.confirmed,
      })),
      bagCount: own.length,
      bagsOutputKg: own.filter(b => !b.bornViaRebag).reduce((t, b) => t + (b.kg || 0), 0)
        + (freshKgBySession.get(s.id) ?? 0),
    }
  })

  const representative = sessions.find(s => !s.deleted_at) ?? sessions[0]

  return {
    section_id, date,
    representativeSessionId: representative.id,
    status: aggregateDayStatus(shifts),
    grade,
    poItems,
    shifts,
    bags,
    bagsOutputKg: bags.filter(b => !b.bornViaRebag).reduce((t, b) => t + (b.kg || 0), 0)
      + freshTopUps.reduce((t, r) => t + r.kg, 0),
    rebagRows,
    freshTopUps,
    debags,
    massBalance: sumMassBalance(shifts, section_id),
    reopenRequests: ((reopenRes.data as any[]) ?? []) as OrderReopenRequest[],
    timesheets,
    takeovers,
  }
}
