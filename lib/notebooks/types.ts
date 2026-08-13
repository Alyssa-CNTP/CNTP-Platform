// lib/notebooks/types.ts
// Shapes + labels for the GRN / Delivery Note books (see
// supabase/migrations/20260813_010_notebooks_grn_dn.sql).
//
// A "book" is one (site, doc type) pair — Graafwater Depot's GRN book is a
// different book from its DN book, and both are different from Blackheath's.
// Every note carries the number of the page it was written on, and those run
// chronologically inside their own book: GD-GRN-0000001, GD-GRN-0000002, …

export type DocType = 'GRN' | 'DN'
export type DocStatus = 'draft' | 'issued' | 'void'

export const DOC_TYPES: DocType[] = ['GRN', 'DN']

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  GRN: 'Goods Received Note',
  DN:  'Delivery Note',
}

export const DOC_TYPE_SHORT: Record<DocType, string> = {
  GRN: 'GRN',
  DN:  'Delivery Note',
}

// Printed under the English title on the note itself — the paper books in use
// at Graafwater/Vanrhynsdorp are Afrikaans-facing.
export const DOC_TYPE_AF: Record<DocType, string> = {
  GRN: 'Goedere Ontvangs Nota',
  DN:  'Afleweringsbewys',
}

// The one line that means something different per book type. Everything else
// on the page is identical, which is why both live in one table.
export const PARTY_LABEL: Record<DocType, string> = {
  GRN: "Supplier's name",
  DN:  'Delivered to',
}

export const STATUS_LABELS: Record<DocStatus, string> = {
  draft:  'Draft',
  issued: 'Issued',
  void:   'Void',
}

export interface NotebookLocation {
  code:       string          // 'BH' | 'GD' | 'GT' | 'VD' | 'VT' — the number prefix
  name:       string
  short_name: string | null
  address:    string | null
  sort_order: number
  active:     boolean
}

export interface NotebookLine {
  id:          string
  document_id: string
  line_no:     number
  qty:         number | null
  weight_kg:   number | null
  description: string | null
  variant:     string | null
  lot_no:      string | null
  batch_no:    string | null
  farmer_name: string | null
  notes:       string | null
}

export interface NotebookDoc {
  id:            string
  doc_no:        string
  doc_type:      DocType
  location_code: string
  seq:           number
  doc_date:      string

  party_name:         string | null
  party_address:      string | null
  delivered_at_store: string | null
  purchase_order_no:  string | null
  weighbridge_no:     string | null

  lot_no:          string | null
  batch_no:        string | null
  producer_lot_no: string | null
  season_year:     number | null
  farmer_name:     string | null

  vehicle_reg:         string | null
  transporter_company: string | null
  driver_name:         string | null

  cert_organic_nop:         boolean
  cert_organic_jas:         boolean
  cert_organic_eu:          boolean
  cert_rainforest_alliance: boolean
  cert_fairtrade:           boolean
  cert_control_union_no:    string | null
  cert_eu_org_code:         string | null

  received_by_name: string | null
  received_at:      string | null
  transporter_name: string | null
  transporter_at:   string | null

  notes:           string | null
  status:          DocStatus
  issued_at:       string | null
  voided_at:       string | null
  void_reason:     string | null
  created_by_name: string | null
  created_at:      string
  updated_at:      string
}

export interface NotebookDocWithLines extends NotebookDoc {
  lines: NotebookLine[]
}

// ─── Certification stamp ─────────────────────────────────────────────────────
// The ticked box printed on the note, matching the stamp on the paper GRNs.
// Order here is the order it prints in.

export const CERT_KEYS = [
  'cert_organic_nop',
  'cert_organic_jas',
  'cert_organic_eu',
  'cert_rainforest_alliance',
  'cert_fairtrade',
] as const

export type CertKey = (typeof CERT_KEYS)[number]

export const CERT_ROWS: { key: CertKey; label: string; sub?: string }[] = [
  { key: 'cert_organic_nop',         label: 'NOP',                 sub: 'Certified Organic by Control Union' },
  { key: 'cert_organic_jas',         label: 'JAS',                 sub: 'Certified Organic by Control Union' },
  { key: 'cert_organic_eu',          label: 'EU',                  sub: 'EU Organic' },
  { key: 'cert_rainforest_alliance', label: 'Rainforest Alliance', sub: 'Certified' },
  { key: 'cert_fairtrade',           label: 'Fairtrade',           sub: 'Certified' },
]

export function hasAnyCert(doc: Pick<NotebookDoc, CertKey>): boolean {
  return CERT_KEYS.some(k => doc[k])
}

// ─── Company block — the letterhead printed on every note ────────────────────
// Same details as the paper book and the COA (app/(app)/quality/coa/page.tsx).

export const COMPANY = {
  name:    'Cape Natural Tea Products (Pty) Ltd',
  poBox:   'P.O. Box 30',
  line1:   'Blackheath 7581',
  line2:   '27 Range Road',
  line3:   'Blackheath 7580',
  tel:     'Tel: +27 21 982 5030',
  fax:     'Fax: +27 21 982 3176',
  vat:     'VAT No. 4370164420',
  reg:     'Reg No. 1996/018192/07',
  email:   'Email: info@rooibostea.co.za',
  website: 'Website: www.rooibostea.co.za',
} as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function parseDocNo(docNo: string): { locationCode: string; docType: DocType; seq: number } | null {
  const m = /^([A-Z]{2})-(GRN|DN)-(\d{7})$/.exec(docNo.trim().toUpperCase())
  if (!m) return null
  return { locationCode: m[1], docType: m[2] as DocType, seq: Number(m[3]) }
}

export function formatDocNo(locationCode: string, docType: DocType, seq: number): string {
  return `${locationCode}-${docType}-${String(seq).padStart(7, '0')}`
}

export function totalWeightKg(lines: Pick<NotebookLine, 'weight_kg'>[]): number {
  return lines.reduce((sum, l) => sum + (Number(l.weight_kg) || 0), 0)
}

export function totalQty(lines: Pick<NotebookLine, 'qty'>[]): number {
  return lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0)
}

// ─── esign wiring ────────────────────────────────────────────────────────────
// Both acknowledgement blocks on the page are esign subjects. esign allows one
// pending request per (subject_type, subject_id), so the two blocks get their
// own subject_id suffix rather than fighting over the note's id.

export const ESIGN_SUBJECT = 'notebook_document'

export type SignBlock = 'received' | 'transporter'

export const SIGN_BLOCKS: SignBlock[] = ['received', 'transporter']

export const SIGN_BLOCK_LABELS: Record<DocType, Record<SignBlock, string>> = {
  GRN: { received: 'Received by',  transporter: 'Transporter' },
  DN:  { received: 'Delivered by', transporter: 'Received by (recipient)' },
}

export const SIGN_BLOCK_DECLARATION: Record<DocType, Record<SignBlock, string>> = {
  GRN: {
    received:    'I hereby acknowledge goods received in order.',
    transporter: 'I hereby acknowledge goods delivered in good order.',
  },
  DN: {
    received:    'I hereby acknowledge the goods described above were dispatched in good order.',
    transporter: 'I hereby acknowledge receipt of the goods described above in good order.',
  },
}

export function esignSubjectId(docId: string, block: SignBlock): string {
  return `${docId}:${block}`
}

export function signBlockFromSubjectId(subjectId: string): SignBlock | null {
  const suffix = subjectId.split(':')[1]
  return suffix === 'received' || suffix === 'transporter' ? suffix : null
}
