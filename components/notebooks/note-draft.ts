// components/notebooks/note-draft.ts
// The in-form shape of a note while it is being typed, and the conversion back
// to what the API stores.
//
// Everything the user types is held as a string — an empty number input is ''
// and not 0, and a half-typed "12." is a legal intermediate state. Coercion to
// numbers/nulls happens once, on the way out, in toHeaderPayload/toLinePayload.

import type { NotebookDocWithLines, NotebookLine } from '@/lib/notebooks/types'

export { PARTY_LABEL, CERT_ROWS, CERT_KEYS } from '@/lib/notebooks/types'
export type { DocType } from '@/lib/notebooks/types'

export interface LineDraft {
  qty:         string
  weight_kg:   string
  description: string
  lot_no:      string
  batch_no:    string
}

export interface NoteHeaderDraft {
  doc_date:           string
  party_name:         string
  delivered_at_store: string
  purchase_order_no:  string
  weighbridge_no:     string
  lot_no:             string
  batch_no:           string
  producer_lot_no:    string
  season_year:        string
  farmer_name:        string
  vehicle_reg:        string
  transporter_company: string
  driver_name:        string
  cert_organic_nop:         boolean
  cert_organic_jas:         boolean
  cert_organic_eu:          boolean
  cert_rainforest_alliance: boolean
  cert_fairtrade:           boolean
  cert_control_union_no: string
  cert_eu_org_code:      string
  received_by_name:  string
  transporter_name:  string
  notes:             string
}

function todayInSAST(): string {
  // The books are written at the gate in South Africa; a browser sitting in
  // another timezone must not date a note a day out.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export function emptyHeader(): NoteHeaderDraft {
  return {
    doc_date: todayInSAST(),
    party_name: '', delivered_at_store: '', purchase_order_no: '', weighbridge_no: '',
    lot_no: '', batch_no: '', producer_lot_no: '', season_year: '', farmer_name: '',
    vehicle_reg: '', transporter_company: '', driver_name: '',
    cert_organic_nop: false, cert_organic_jas: false, cert_organic_eu: false,
    cert_rainforest_alliance: false, cert_fairtrade: false,
    cert_control_union_no: '', cert_eu_org_code: '',
    received_by_name: '', transporter_name: '', notes: '',
  }
}

const s = (v: unknown) => (v == null ? '' : String(v))

export function headerFromDoc(doc: NotebookDocWithLines): NoteHeaderDraft {
  return {
    doc_date:           doc.doc_date ?? todayInSAST(),
    party_name:         s(doc.party_name),
    delivered_at_store: s(doc.delivered_at_store),
    purchase_order_no:  s(doc.purchase_order_no),
    weighbridge_no:     s(doc.weighbridge_no),
    lot_no:             s(doc.lot_no),
    batch_no:           s(doc.batch_no),
    producer_lot_no:    s(doc.producer_lot_no),
    season_year:        s(doc.season_year),
    farmer_name:        s(doc.farmer_name),
    vehicle_reg:        s(doc.vehicle_reg),
    transporter_company: s(doc.transporter_company),
    driver_name:        s(doc.driver_name),
    cert_organic_nop:         doc.cert_organic_nop,
    cert_organic_jas:         doc.cert_organic_jas,
    cert_organic_eu:          doc.cert_organic_eu,
    cert_rainforest_alliance: doc.cert_rainforest_alliance,
    cert_fairtrade:           doc.cert_fairtrade,
    cert_control_union_no: s(doc.cert_control_union_no),
    cert_eu_org_code:      s(doc.cert_eu_org_code),
    received_by_name:  s(doc.received_by_name),
    transporter_name:  s(doc.transporter_name),
    notes:             s(doc.notes),
  }
}

export function linesFromDoc(lines: NotebookLine[]): LineDraft[] {
  if (lines.length === 0) return [{ qty: '', weight_kg: '', description: '', lot_no: '', batch_no: '' }]
  return lines.map(l => ({
    qty:         s(l.qty),
    weight_kg:   s(l.weight_kg),
    description: s(l.description),
    lot_no:      s(l.lot_no),
    batch_no:    s(l.batch_no),
  }))
}

const num = (v: string) => {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const txt = (v: string) => {
  const t = v.trim()
  return t === '' ? null : t
}

export function toHeaderPayload(h: NoteHeaderDraft): Record<string, unknown> {
  return {
    doc_date:           h.doc_date || null,
    party_name:         txt(h.party_name),
    delivered_at_store: txt(h.delivered_at_store),
    purchase_order_no:  txt(h.purchase_order_no),
    weighbridge_no:     txt(h.weighbridge_no),
    lot_no:             txt(h.lot_no),
    batch_no:           txt(h.batch_no),
    producer_lot_no:    txt(h.producer_lot_no),
    season_year:        num(h.season_year),
    farmer_name:        txt(h.farmer_name),
    vehicle_reg:        txt(h.vehicle_reg),
    transporter_company: txt(h.transporter_company),
    driver_name:        txt(h.driver_name),
    cert_organic_nop:         h.cert_organic_nop,
    cert_organic_jas:         h.cert_organic_jas,
    cert_organic_eu:          h.cert_organic_eu,
    cert_rainforest_alliance: h.cert_rainforest_alliance,
    cert_fairtrade:           h.cert_fairtrade,
    cert_control_union_no: txt(h.cert_control_union_no),
    cert_eu_org_code:      txt(h.cert_eu_org_code),
    received_by_name:  txt(h.received_by_name),
    transporter_name:  txt(h.transporter_name),
    notes:             txt(h.notes),
  }
}

export function toLinesPayload(lines: LineDraft[]): Record<string, unknown>[] {
  return lines
    .filter(l => l.qty.trim() || l.weight_kg.trim() || l.description.trim())
    .map(l => ({
      qty:         num(l.qty),
      weight_kg:   num(l.weight_kg),
      description: txt(l.description),
      lot_no:      txt(l.lot_no),
      batch_no:    txt(l.batch_no),
    }))
}
