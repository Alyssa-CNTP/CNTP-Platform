// lib/takein/types.ts
//
// Shapes for the `takein` schema (supabase/migrations/20260915_001_takein_schema.sql).
// Hand-written to match the migration; regenerate with `npx supabase gen types`
// once the schema settles.

export type DepotCode = string

export interface Depot {
  id:                    string
  code:                  DepotCode
  name:                  string
  type:                  'raw' | 'finished' | 'export' | 'mixed'
  address:               string | null
  active:                boolean
  takes_farmer_delivery: boolean
  batch_prefix:          string | null
  batch_seq:             number
  grn_prefix:            string | null
  grn_seq:               number
  doc_prefix:            string | null
  doc_seq:               number
}

export interface Producer {
  id:             string
  acumatica_code: string
  name:           string
  contact_name:   string | null
  email:          string | null
  phone:          string | null
  address:        string | null
  active:         boolean
}

export type ContractStatus = 'draft' | 'awaiting_release' | 'released' | 'closed'

export interface Contract {
  id:            string
  contract_no:   string
  producer_id:   string
  season:        number
  variant:       string
  contracted_kg: number
  status:        ContractStatus
  created_at:    string
  producer?:     Producer | null
}

/** Rand values. Lives in its own table behind RLS — see the migration. */
export interface ContractPricing {
  contract_id:      string
  guaranteed_cents: number
  first_pay_cents:  number
  set_at:           string
}

/**
 * Which findings a panel decision BINDS the producer to. A panel sitting on a
 * batch is an in-house quality review; it reaches the producer only where the
 * contract names that finding a Verpligte Paneel Besluit.
 */
export type PanelTermKey =
  | 'density' | 'sensory' | 'organic_residue' | 'pa4' | 'organic_pa23' | 'lab_variance'

export interface PanelTerm {
  contract_id: string
  term_key:    PanelTermKey
  binding:     boolean
  clause_ref:  string | null
}

export const PANEL_TERMS: { key: PanelTermKey; label: string; clause: string }[] = [
  { key: 'density',         label: 'Mass density at or above the limit',    clause: 'Klousule 6.2 — Massadigtheid' },
  { key: 'sensory',         label: 'A sensory score at or below the floor', clause: 'Klousule 6.3 — Sensoriese ondergrens' },
  { key: 'organic_residue', label: 'Organic load with a residue detected',  clause: 'Addendum B — Organiese residu' },
  { key: 'pa4',             label: 'PA result P4',                          clause: 'Addendum B — PA vlakke' },
  { key: 'organic_pa23',    label: 'Organic load at PA P2 or P3',           clause: 'Addendum B — PA vlakke' },
  { key: 'lab_variance',    label: 'The two labs disagree on the sample',   clause: '— (not a contract term by default)' },
]

/** Ticked by default on a new contract; lab_variance is not a contract matter. */
export const DEFAULT_BINDING: Record<PanelTermKey, boolean> = {
  density: true, sensory: true, organic_residue: true,
  pa4: true, organic_pa23: true, lab_variance: false,
}

export interface Booking {
  id:              string
  warehouse_id:    string
  contract_id:     string | null
  booked_date:     string          // yyyy-mm-dd
  start_hour:      number
  hours:           number
  bags:            number
  expected_kg:     number | null
  land_name:       string | null
  note:            string | null
  kind:            'farmer' | 'shipping'
  status:          'booked' | 'cancelled' | 'arrived'
  alert:           boolean
  override_reason: string | null
  batch_id:        string | null
  created_at:      string
  contract?:       Contract | null
}

export interface Batch {
  id:             string
  batch_no:       string
  warehouse_id:   string
  contract_id:    string
  booking_id:     string | null
  delivered_on:   string
  begin_kg:       number | null
  end_kg:         number | null
  bags:           number
  weighbridge_no: string | null
  driver:         string | null
  vehicle:        string | null
  producer_lot:   string | null
  tea_court:      string | null
  harvest_year:   number | null
  checks_json:    boolean[]
  check_notes:    string[]
  qc_comment:     string | null
  returned_at:       string | null
  returned_stage:    string | null
  returned_category: string | null
  returned_reason:   string | null
  panel_outcome:  'accept' | 'downgrade' | 'reject' | null
  panel_grade:    string | null
  panel_reason:   string | null
  panel_binding:  boolean | null
  panel_covered:  string[] | null
  panel_at:       string | null
  ceiling_override_reason: string | null
  created_at:     string
  contract?:      Contract | null
}

export interface BatchLand { batch_id: string; ordinal: number; name: string }
export interface BatchBag  { batch_id: string; bag_no: number; land_ordinal: number | null }

export type DocKind = 'grn' | 'afleweringsbewys' | 'coa'

/** Payment is built from this snapshot, never from the live batch. */
export interface FrozenFigures {
  sieve:    Record<string, number>
  moisture: number
  density:  number
  shade:    number
  aroma:    number
  colour:   number
  taste:    number
  begin_kg: number
  end_kg:   number
  bags:     number
  gross_kg: number
  nett_kg:  number
  pct:      number
  group:    string
  panel:    boolean
}

export interface TakeInDocument {
  id:               string
  batch_id:         string
  kind:             DocKind
  doc_no:           string
  issued_at:        string
  issued_by_name:   string | null
  signed_by:        string | null
  signed_at:        string | null
  transporter:      string | null
  delivery_note_no: string | null
  frozen:           FrozenFigures | null
  voided_at:        string | null
  voided_by_name:   string | null
  void_category:    string | null
  void_reason:      string | null
}

export type LabSource = 'mini' | 'internal' | 'external'

export interface LabResult {
  batch_id:          string
  source:            LabSource
  sieve_json:        Record<string, number> | null
  moisture:          number | null
  density:           number | null
  shade:             number | null
  aroma:             number | null
  colour:            number | null
  taste:             number | null
  residue_name:      string | null
  residue_level:     number | null
  residue_group:     string | null
  pa_level:          number | null
  pa_group:          string | null
  agrees:            boolean | null
  variance_note:     string | null
  dispute_note:      string | null
  quality_record_id: number | null
  captured_by_name:  string | null
  captured_at:       string
}

export interface BatchEvent {
  id:         number
  batch_id:   string
  at:         string
  actor_name: string
  action:     string
  detail:     string
  payload:    Record<string, unknown> | null
}

/** The five sieve fractions plus dust, in the order every document prints them. */
export const SIEVE_FRACTIONS = [
  { key: '>10', label: 'Sieving > 10', factor: 0.18 },
  { key: '>12', label: 'Sieving > 12', factor: 0.22 },
  { key: '>18', label: 'Sieving > 18', factor: 0.90 },
  { key: '>20', label: 'Sieving > 20', factor: 1.00 },
  { key: '>40', label: 'Sieving > 40', factor: 1.00 },
  { key: '<40', label: 'Dust < 40',    factor: 0.25 },
] as const

/** The QC receiving inspection, ticked at the gate. Never pre-ticked. */
export const RECEIVING_CHECKS = [
  'Vehicle clean and free of contamination',
  'No foreign objects, insects or vermin visible',
  'Bags intact, clean and correctly closed',
  'No sign of moisture damage or wet material',
  'Load matches the booking and the delivery note',
  'No unusual odour on opening',
] as const
