// lib/production/order-detail.ts
// Assembles EVERYTHING for one production order (production.prod_sessions
// row) in one call — core identifiers, mass balance, the full bag/debag
// list (not just counts), both sign-off signatures (from session_signatures,
// not just the denormalized name on prod_sessions), and reopen history.
// Shared by the detail page and its PDF export so both always show the same data.

import { getDb } from '@/lib/supabase/db'

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
  kg: number
  bagging_time: string | null
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
  local_or_export: string | null
  org_or_conv: string | null
  is_spillage: boolean
  notes: string | null
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

export interface OrderDetail {
  session: OrderSession
  massBalance: OrderMassBalance | null
  bags: OrderBagRow[]
  bagsOutputKg: number      // reliable output total = Σ of the bags below (bag_tags-sourced)
  debags: OrderDebagRow[]
  signatures: OrderSignature[]
  reopenRequests: OrderReopenRequest[]
}

// Merge the authoritative per-bag ledger (bag_tags) with the structured
// prod_bagging rows into one reliable output-bag list.
//
// bag_tags is written ATOMICALLY, one row per physical bag, the moment the
// bag is tagged — it never loses a bag to the prod_bagging delete+reinsert
// race that intermittently drops bags on a save that collides with a rapid
// bag-add (seen live: 11 real bags, 1 in prod_bagging). It's the same ledger
// Quality's QC queue reads, so the Orders record and Quality can never
// disagree about which bags exist. prod_bagging is used only to ENRICH each
// bag with its output group + recorded bagging time where a serial matches.
//
// - active bag_tags rows  → the spine (authoritative existence + weight/type)
// - prod_bagging-only rows (no-serial by-products, Pasteuriser range rows,
//   or a serial with no bag_tags row) → still included, so no section regresses
// - voided bag_tags serials → excluded everywhere (even if prod_bagging lags)
function mergeOutputBags(tags: any[], bagging: any[]): OrderBagRow[] {
  const voided = new Set(tags.filter(t => t.status === 'voided').map(t => t.serial_number))
  const active = tags.filter(t => t.status !== 'voided')

  const pbBySerial = new Map<string, any>()
  const pbNoSerial: any[] = []
  for (const r of bagging) {
    if (r.bag_serial_no) pbBySerial.set(r.bag_serial_no, r)
    else pbNoSerial.push(r)
  }

  const rows: OrderBagRow[] = []

  for (const t of active) {
    const pb = pbBySerial.get(t.serial_number)
    pbBySerial.delete(t.serial_number)
    rows.push({
      id: t.serial_number,
      bag_no: 0,
      output_group: pb?.output_group ?? null,
      bag_serial_no: t.serial_number,
      product_type: t.product_type ?? pb?.product_type ?? null,
      variant: t.variant ?? pb?.variant ?? null,
      kg: Number(t.weight_kg) || 0,
      bagging_time: pb?.bagging_time ?? t.printed_at ?? null,
    })
  }

  // prod_bagging rows left over (serial present but no active bag_tags row).
  // Skip anything explicitly voided; keep the rest (a section whose output
  // lives only in prod_bagging, e.g. Pasteuriser).
  for (const pb of pbBySerial.values()) {
    if (voided.has(pb.bag_serial_no)) continue
    rows.push({
      id: pb.id, bag_no: 0, output_group: pb.output_group ?? null,
      bag_serial_no: pb.bag_serial_no, product_type: pb.product_type ?? null,
      variant: pb.variant ?? null, kg: Number(pb.kg) || 0, bagging_time: pb.bagging_time ?? null,
    })
  }
  // No-serial by-product rows (identity is bag_no, no bag_tags equivalent).
  for (const pb of pbNoSerial) {
    rows.push({
      id: pb.id, bag_no: 0, output_group: pb.output_group ?? null,
      bag_serial_no: null, product_type: pb.product_type ?? null,
      variant: pb.variant ?? null, kg: Number(pb.kg) || 0, bagging_time: pb.bagging_time ?? null,
    })
  }

  // Order by real bagging time (nulls last), then stamp a stable 1..N display
  // number — the stored prod_bagging.bag_no is itself derived from the
  // race-prone snapshot, so it isn't trusted for identity here.
  rows.sort((a, b) => {
    const ta = a.bagging_time ? Date.parse(a.bagging_time) : Infinity
    const tb = b.bagging_time ? Date.parse(b.bagging_time) : Infinity
    return ta - tb
  })
  rows.forEach((r, i) => { r.bag_no = i + 1 })
  return rows
}

export async function loadOrderDetail(sessionId: string): Promise<OrderDetail | null> {
  const db = getDb().schema('production')

  const { data: session } = await db.from('prod_sessions').select('*').eq('id', sessionId).maybeSingle()
  if (!session) return null

  const [mbRes, tagsRes, bagsRes, debagsRes, sigRes, reopenRes] = await Promise.all([
    db.from('prod_mass_balance').select('*').eq('session_id', sessionId).maybeSingle(),
    db.from('bag_tags').select('serial_number,product_type,variant,weight_kg,printed_at,status').eq('session_id', sessionId),
    db.from('prod_bagging').select('*').eq('session_id', sessionId).order('bag_no'),
    db.from('prod_debagging').select('*').eq('session_id', sessionId).order('bag_no'),
    db.from('session_signatures').select('*').eq('session_id', sessionId).order('signed_at'),
    db.from('po_reopen_requests').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }),
  ])

  const bags = mergeOutputBags((tagsRes.data as any[]) ?? [], (bagsRes.data as any[]) ?? [])
  const bagsOutputKg = bags.reduce((s, b) => s + (b.kg || 0), 0)

  return {
    session: session as OrderSession,
    massBalance: (mbRes.data as OrderMassBalance) ?? null,
    bags,
    bagsOutputKg,
    debags: (debagsRes.data as OrderDebagRow[]) ?? [],
    signatures: (sigRes.data as OrderSignature[]) ?? [],
    reopenRequests: (reopenRes.data as OrderReopenRequest[]) ?? [],
  }
}
