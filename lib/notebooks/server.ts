// lib/notebooks/server.ts
// Server-only data access for the GRN / Delivery Note books.
//
// Everything goes through the service-role client against the public.notebook_*
// views (see the header of 20260819_001_notebooks_grn_dn.sql for why the tables
// sit in their own `notebooks` schema but are reached through public views).
// Permission checks live in the API routes that call these functions — this
// module deliberately holds no opinion about who is allowed to do what.

import { getAdminClient } from '@/lib/auth/server-helpers'
import {
  type DocType, type NotebookDoc, type NotebookLine, type NotebookDocWithLines,
  type NotebookLocation,
} from './types'

const DOCS   = 'notebook_documents'
const LINES  = 'notebook_document_lines'
const PLACES = 'notebook_locations'

// Only these ever come off a request body. Anything to do with the note's
// identity (doc_no / doc_type / location_code / seq) or its lifecycle
// (status / issued_at / voided_by / …) is set here, never by the client — the
// DB enforces the same rule in notebooks.protect_doc_identity(), this is just
// the earlier, friendlier boundary.
//
// doc_date is deliberately NOT in this list: "date received" is automated —
// stamped once by the DB default (today, Africa/Johannesburg) the moment the
// note is created, and fixed after that. Nobody, including a later edit,
// backdates or postdates a receipt.
const EDITABLE_HEADER_FIELDS = [
  'party_name', 'party_address', 'delivered_at_store', 'purchase_order_no',
  'weighbridge_no', 'weighbridge_weight_kg',
  'lot_no', 'batch_no', 'producer_lot_no', 'season_year', 'farmer_name',
  'vehicle_reg', 'transporter_company', 'driver_name',
  'cert_organic_nop', 'cert_organic_jas', 'cert_organic_eu',
  'cert_rainforest_alliance', 'cert_fairtrade',
  'cert_control_union_no', 'cert_eu_org_code',
  'received_by_name', 'received_at', 'transporter_name', 'transporter_at',
  'notes',
] as const

const EDITABLE_LINE_FIELDS = [
  'qty', 'weight_kg', 'description', 'variant', 'lot_no', 'batch_no', 'farmer_name', 'notes',
] as const

export interface LineInput {
  qty?: number | null
  weight_kg?: number | null
  description?: string | null
  variant?: string | null
  lot_no?: string | null
  batch_no?: string | null
  farmer_name?: string | null
  notes?: string | null
}

export interface ListFilter {
  locationCode?: string | null
  docType?: DocType | null
  status?: string | null
  search?: string | null      // matches note number, party, PO or weighbridge no
  from?: string | null        // doc_date >=
  to?: string | null          // doc_date <=
  limit?: number
  offset?: number
}

function pick<T extends readonly string[]>(body: Record<string, unknown>, allowed: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) out[key] = body[key] === '' ? null : body[key]
  }
  return out
}

export async function listLocations(): Promise<NotebookLocation[]> {
  const admin = getAdminClient() as any
  const { data, error } = await admin.from(PLACES)
    .select('code, name, short_name, address, sort_order, active')
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as NotebookLocation[]
}

export interface ListResult {
  rows:  (NotebookDoc & { line_count: number; total_qty: number; total_weight_kg: number })[]
  total: number
}

export async function listDocuments(f: ListFilter): Promise<ListResult> {
  const admin = getAdminClient() as any
  const limit  = Math.min(Math.max(f.limit ?? 50, 1), 200)
  const offset = Math.max(f.offset ?? 0, 0)

  let q = admin.from(DOCS).select('*', { count: 'exact' })
  if (f.locationCode) q = q.eq('location_code', f.locationCode)
  if (f.docType)      q = q.eq('doc_type', f.docType)
  if (f.status)       q = q.eq('status', f.status)
  if (f.from)         q = q.gte('doc_date', f.from)
  if (f.to)           q = q.lte('doc_date', f.to)
  if (f.search) {
    // Escape PostgREST's or() delimiters so a stray comma or paren in the box
    // can't rewrite the filter expression.
    const term = f.search.trim().replace(/[,()\\]/g, ' ')
    if (term) {
      q = q.or(
        `doc_no.ilike.*${term}*,party_name.ilike.*${term}*,` +
        `purchase_order_no.ilike.*${term}*,weighbridge_no.ilike.*${term}*,` +
        `lot_no.ilike.*${term}*,batch_no.ilike.*${term}*`
      )
    }
  }

  // Newest page first, and always within its own book — the number IS the
  // chronology, so ordering by seq (not created_at) is what a reader expects.
  const { data, error, count } = await q
    .order('doc_date', { ascending: false })
    .order('location_code', { ascending: true })
    .order('doc_type', { ascending: true })
    .order('seq', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(error.message)

  const docs = (data ?? []) as NotebookDoc[]
  if (docs.length === 0) return { rows: [], total: count ?? 0 }

  // One round trip for every line on the page of results, then fold the
  // totals in memory — cheaper and simpler than a count query per note.
  const { data: lineRows } = await admin.from(LINES)
    .select('document_id, qty, weight_kg')
    .in('document_id', docs.map(d => d.id))

  const agg = new Map<string, { n: number; qty: number; kg: number }>()
  for (const l of (lineRows ?? []) as any[]) {
    const cur = agg.get(l.document_id) ?? { n: 0, qty: 0, kg: 0 }
    cur.n   += 1
    cur.qty += Number(l.qty) || 0
    cur.kg  += Number(l.weight_kg) || 0
    agg.set(l.document_id, cur)
  }

  return {
    rows: docs.map(d => {
      const a = agg.get(d.id) ?? { n: 0, qty: 0, kg: 0 }
      return { ...d, line_count: a.n, total_qty: a.qty, total_weight_kg: a.kg }
    }),
    total: count ?? docs.length,
  }
}

export async function getDocument(id: string): Promise<NotebookDocWithLines | null> {
  const admin = getAdminClient() as any
  const { data: doc, error } = await admin.from(DOCS).select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!doc) return null

  const { data: lines } = await admin.from(LINES)
    .select('*').eq('document_id', id).order('line_no', { ascending: true })

  return { ...(doc as NotebookDoc), lines: (lines ?? []) as NotebookLine[] }
}

export interface CreateInput {
  locationCode: string
  docType:      DocType
  header:       Record<string, unknown>
  lines:        LineInput[]
  createdBy:    string
  createdByName: string | null
}

// Takes the next number in the book and writes the page under it. The number
// is allocated first and on purpose: if the insert then fails, the book shows a
// gap, which is the honest outcome — the alternative (handing the same number
// out twice) is the one thing the book must never do.
export async function createDocument(input: CreateInput): Promise<NotebookDocWithLines> {
  const admin = getAdminClient() as any

  const { data: numbered, error: numErr } = await admin.rpc('notebook_next_doc_no', {
    p_location_code: input.locationCode,
    p_doc_type:      input.docType,
  })
  if (numErr) throw new Error(numErr.message)

  const allocated = Array.isArray(numbered) ? numbered[0] : numbered
  if (!allocated?.doc_no) throw new Error('Could not take the next number in this book')

  const { data: doc, error } = await admin.from(DOCS).insert({
    ...pick(input.header, EDITABLE_HEADER_FIELDS),
    doc_no:          allocated.doc_no,
    doc_type:        input.docType,
    location_code:   input.locationCode,
    seq:             allocated.seq,
    status:          'draft',
    created_by:      input.createdBy,
    created_by_name: input.createdByName,
  }).select('*').single()
  if (error) throw new Error(error.message)

  const lines = await replaceLines(doc.id, input.lines)
  return { ...(doc as NotebookDoc), lines }
}

export async function updateDocument(
  id: string,
  header: Record<string, unknown>,
  lines: LineInput[] | null,
): Promise<NotebookDocWithLines | null> {
  const admin = getAdminClient() as any

  const patch = pick(header, EDITABLE_HEADER_FIELDS)
  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from(DOCS).update(patch).eq('id', id)
    if (error) throw new Error(error.message)
  }
  if (lines) await replaceLines(id, lines)

  return getDocument(id)
}

// The ruled table is edited as a whole — rows get inserted, reordered and
// cleared in one go on screen, so replacing the set is both simpler and a
// truer match for what the user just did than diffing row by row.
async function replaceLines(documentId: string, lines: LineInput[]): Promise<NotebookLine[]> {
  const admin = getAdminClient() as any

  await admin.from(LINES).delete().eq('document_id', documentId)

  const payload = lines
    .filter(l => l.qty != null || l.weight_kg != null || (l.description ?? '').trim() !== '')
    .map((l, i) => ({
      ...pick(l as Record<string, unknown>, EDITABLE_LINE_FIELDS),
      document_id: documentId,
      line_no:     i + 1,
    }))

  if (payload.length === 0) return []

  const { data, error } = await admin.from(LINES).insert(payload).select('*').order('line_no')
  if (error) throw new Error(error.message)
  return (data ?? []) as NotebookLine[]
}

export async function issueDocument(id: string, userId: string): Promise<NotebookDocWithLines | null> {
  const admin = getAdminClient() as any
  const { error } = await admin.from(DOCS)
    .update({ status: 'issued', issued_at: new Date().toISOString(), issued_by: userId })
    .eq('id', id).eq('status', 'draft')
  if (error) throw new Error(error.message)
  return getDocument(id)
}

export async function voidDocument(id: string, userId: string, reason: string): Promise<NotebookDocWithLines | null> {
  const admin = getAdminClient() as any
  const { error } = await admin.from(DOCS)
    .update({ status: 'void', voided_at: new Date().toISOString(), voided_by: userId, void_reason: reason })
    .eq('id', id).neq('status', 'void')
  if (error) throw new Error(error.message)
  return getDocument(id)
}
