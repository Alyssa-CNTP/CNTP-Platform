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
  debags: OrderDebagRow[]
  signatures: OrderSignature[]
  reopenRequests: OrderReopenRequest[]
}

export async function loadOrderDetail(sessionId: string): Promise<OrderDetail | null> {
  const db = getDb().schema('production')

  const { data: session } = await db.from('prod_sessions').select('*').eq('id', sessionId).maybeSingle()
  if (!session) return null

  const [mbRes, bagsRes, debagsRes, sigRes, reopenRes] = await Promise.all([
    db.from('prod_mass_balance').select('*').eq('session_id', sessionId).maybeSingle(),
    db.from('prod_bagging').select('*').eq('session_id', sessionId).order('bag_no'),
    db.from('prod_debagging').select('*').eq('session_id', sessionId).order('bag_no'),
    db.from('session_signatures').select('*').eq('session_id', sessionId).order('signed_at'),
    db.from('po_reopen_requests').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }),
  ])

  return {
    session: session as OrderSession,
    massBalance: (mbRes.data as OrderMassBalance) ?? null,
    bags: (bagsRes.data as OrderBagRow[]) ?? [],
    debags: (debagsRes.data as OrderDebagRow[]) ?? [],
    signatures: (sigRes.data as OrderSignature[]) ?? [],
    reopenRequests: (reopenRes.data as OrderReopenRequest[]) ?? [],
  }
}
