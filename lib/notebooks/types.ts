// lib/notebooks/types.ts
// Shapes + labels for the GRN / Delivery Note books (see
// supabase/migrations/20260819_001_notebooks_grn_dn.sql and
// supabase/migrations/20260819_002_notebooks_weighbridge_weight.sql).
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
  weighbridge_weight_kg: number | null

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

// ─── Field labels shared by the capture form and the printed note ───────────
// "farmer_name" / "season_year" are the DB/column names (chosen when the
// traceability fields were first added); these are what the person filling
// in the form actually reads on the page — "field name" and "plant year" —
// matching the wording used at the gate.

export const FIELD_NAME_LABEL = 'Field name'
export const PLANT_YEAR_LABEL = 'Plant year'

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

// Same two physical blocks on every note, but which one is "the person who
// brought the goods" and which is "the person who took them in" flips with
// doc_type — a GRN is signed at OUR gate (deliverer drops off, we receive), a
// DN is signed at THEIRS (we deliver, they receive). Naming both "Deliverer"
// and "Receiver" throughout, rather than book-specific wording, keeps the
// signing UI identical for either book — only the declaration text differs.
export const SIGN_BLOCK_LABELS: Record<DocType, Record<SignBlock, string>> = {
  GRN: { received: 'Receiver',  transporter: 'Deliverer' },
  DN:  { received: 'Deliverer', transporter: 'Receiver' },
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

// ─── What must be captured before a note can be saved ───────────────────────
// A draft used to be writable with everything blank. Now every one of these
// needs a value before create or edit will go through — literally the text
// "N/A" where a field genuinely doesn't apply (e.g. Control Union no. on a
// conventional load), since that is still a captured answer rather than a
// gap in the record. The stamp tick-boxes and the free-text Comments box are
// deliberately not in this list: "nothing ticked" already means something
// (conventional tea), and Comments is open remarks, not a specific figure off
// the paper book.
//
// One shared list drives three places: the client-side draft check (string
// values, before conversion — components/notebooks/note-draft.ts), the
// server-side payload check (already-converted values — lib/notebooks/server.ts),
// and the tab a field lives in for the capture form's error badges. Same list
// so the three can't quietly drift apart.
export type RequiredHeaderKey =
  | 'weighbridge_no' | 'weighbridge_weight_kg' | 'vehicle_reg'
  | 'party_name' | 'delivered_at_store' | 'purchase_order_no'
  | 'batch_no' | 'producer_lot_no' | 'farmer_name' | 'season_year' | 'transporter_company'
  | 'cert_control_union_no' | 'cert_eu_org_code'
  | 'received_by_name' | 'transporter_name' | 'driver_name'

export type NoteTab = 'weighbridge' | 'goods' | 'traceability' | 'cert' | 'comments'

export interface RequiredHeaderField {
  key:     RequiredHeaderKey
  tab:     NoteTab
  numeric?: boolean
  label:   (docType: DocType) => string
}

export const REQUIRED_HEADER_FIELDS: RequiredHeaderField[] = [
  { key: 'weighbridge_no',         tab: 'weighbridge',  label: () => 'Weighbridge no.' },
  { key: 'weighbridge_weight_kg',  tab: 'weighbridge',  label: () => 'Weight (from weighbridge)', numeric: true },
  { key: 'vehicle_reg',            tab: 'weighbridge',  label: () => 'Vehicle registration' },
  { key: 'party_name',             tab: 'goods',        label: t => PARTY_LABEL[t] },
  { key: 'delivered_at_store',     tab: 'goods',        label: () => 'Name of store goods delivered at' },
  { key: 'purchase_order_no',      tab: 'goods',        label: () => 'Our purchase order no.' },
  { key: 'batch_no',               tab: 'traceability', label: () => 'Batch no.' },
  { key: 'producer_lot_no',        tab: 'traceability', label: () => 'Producer lot no.' },
  { key: 'farmer_name',            tab: 'traceability', label: () => FIELD_NAME_LABEL },
  { key: 'season_year',            tab: 'traceability', label: () => PLANT_YEAR_LABEL, numeric: true },
  { key: 'transporter_company',    tab: 'traceability', label: () => 'Transporter company' },
  { key: 'cert_control_union_no',  tab: 'cert',          label: () => 'Control Union no.' },
  { key: 'cert_eu_org_code',       tab: 'cert',          label: () => 'EU organic code' },
  { key: 'received_by_name',       tab: 'comments',      label: t => SIGN_BLOCK_LABELS[t].received },
  { key: 'transporter_name',       tab: 'comments',      label: t => SIGN_BLOCK_LABELS[t].transporter },
  { key: 'driver_name',            tab: 'comments',      label: () => 'Driver' },
]

export type RequiredLineKey = 'qty' | 'weight_kg' | 'description' | 'batch_no'

export const REQUIRED_LINE_FIELDS: { key: RequiredLineKey; label: string; numeric?: boolean }[] = [
  { key: 'qty',         label: 'Qty',          numeric: true },
  { key: 'weight_kg',   label: 'Weight (kg)',  numeric: true },
  { key: 'description', label: 'Description' },
  { key: 'batch_no',    label: 'Batch no.' },
]
