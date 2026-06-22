// lib/logistics/types.ts
// TypeScript shapes for the logistics schema. Kept hand-written for now — replace
// with generated types once `npx supabase gen types` is run against the logistics schema.

export type UnitType = 'bag' | 'box' | 'pallet'

export type UnitStage =
  | 'received'
  | 'staged_sieving' | 'staged_refining' | 'staged_blender'
  | 'staged_pasteuriser' | 'staged_granule'
  | 'in_process'
  | 'finished' | 'picked' | 'loaded' | 'dispatched' | 'customer_received'
  | 'qc_hold' | 'rejected' | 'consumed'

export type UnitStatus =
  | 'active' | 'in_process' | 'consumed' | 'dispatched' | 'quarantine' | 'rejected'

export type LocationType =
  | 'raw_storage' | 'staging' | 'dispatch_bay' | 'qc_hold' | 'reject'
  | 'finished_storage' | 'transit'

export type EventType =
  | 'receive_in' | 'move' | 'qc_hold' | 'qc_release' | 'qc_reject'
  | 'stage_change' | 'transform' | 'pick_for_order' | 'load_to_container'
  | 'dispatch_out' | 'customer_received' | 'adjust' | 'print_label'

export type Language = 'en' | 'af' | 'zu' | 'xh'

export interface Warehouse {
  id: string
  code: string
  name: string
  type: 'raw' | 'finished' | 'export' | 'mixed'
  address: string | null
  active: boolean
  created_at: string
}

export interface Location {
  id: string
  warehouse_id: string
  code: string
  aisle: string | null
  bay: string | null
  level: string | null
  location_type: LocationType
  capacity_units: number | null
  barcode: string | null
  active: boolean
  created_at: string
}

export interface Supplier {
  id: string
  code: string
  name: string
  acumatica_id: string | null
  country: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  active: boolean
  created_at: string
}

export interface Customer {
  id: string
  code: string
  name: string
  acumatica_id: string | null
  country: string | null
  language_pref: Language
  contact_name: string | null
  contact_email: string | null
  active: boolean
  created_at: string
}

export interface Batch {
  id: string
  batch_code: string
  lot_number: string | null
  acumatica_lot_id: string | null
  supplier_id: string | null
  product_type: string | null
  variant: string | null
  harvest_date: string | null
  expiry_date: string | null
  pesticide_notes: string | null
  pesticide_doc_url: string | null
  certified_organic: boolean | null
  certificate_doc_url: string | null
  notes: string | null
  created_at: string
}

export interface Unit {
  id: string
  barcode: string
  unit_type: UnitType
  parent_unit_id: string | null
  batch_id: string | null
  supplier_id: string | null
  customer_id: string | null
  grn_id: string | null
  product_type: string | null
  variant: string | null
  weight_kg: number | null
  current_stage: UnitStage
  current_location_id: string | null
  status: UnitStatus
  arrived_at: string
  departed_at: string | null
  acumatica_inventory_id: string | null
  acumatica_lot_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface UnitEvent {
  id: number
  unit_id: string
  event_type: EventType
  from_stage: string | null
  to_stage: string | null
  from_location_id: string | null
  to_location_id: string | null
  operator_id: string | null
  operator_name: string | null
  device_id: string | null
  session_id: string | null
  grn_id: string | null
  dispatch_id: string | null
  payload: Record<string, unknown>
  notes: string | null
  scanned_at: string
}

export interface UnitLineageRow {
  id: number
  parent_unit_id: string
  child_unit_id: string
  transform_event_id: number | null
  share_kg: number | null
  created_at: string
}

export interface GRN {
  id: string
  grn_code: string
  acumatica_po_id: string | null
  acumatica_grn_id: string | null
  supplier_id: string | null
  warehouse_id: string | null
  status: 'open' | 'receiving' | 'closed' | 'cancelled'
  received_at: string | null
  received_by: string | null
  notes: string | null
  created_at: string
  closed_at: string | null
}

export interface GRNLine {
  id: string
  grn_id: string
  line_no: number
  product_type: string
  variant: string | null
  expected_kg: number | null
  received_kg: number
  batch_id: string | null
  notes: string | null
}

export interface SalesOrder {
  id: string
  so_code: string
  acumatica_so_id: string | null
  customer_id: string | null
  status: 'open' | 'allocating' | 'picking' | 'loading' | 'sealed' | 'dispatched' | 'invoiced' | 'cancelled'
  scheduled_dispatch_at: string | null
  notes: string | null
  created_at: string
}

export interface SOLine {
  id: string
  so_id: string
  line_no: number
  product_type: string
  variant: string | null
  qty_kg: number
  allocated_kg: number
  notes: string | null
}

export interface Dispatch {
  id: string
  dispatch_code: string
  so_id: string | null
  container_no: string | null
  container_size: '20ft' | '40ft' | 'truck' | 'other' | null
  seal_no: string | null
  transporter: string | null
  scheduled_at: string | null
  dispatched_at: string | null
  dispatched_by: string | null
  verified_by: string | null
  verified_at: string | null
  status: 'planning' | 'picking' | 'loading' | 'sealed' | 'dispatched' | 'cancelled'
  records_confirmed: boolean
  comments: string | null
  created_at: string
}

export const DISPATCH_DOC_CODES = [
  'DELIVERY_NOTE',
  'TRANSPORTERS_DOC',
  'ORDER_CONFIRMATION',
  'WL_FM_017',
  'WL_FM_012',
  'LAB_FM_033',
  'LAB_FM_032',
  'LAB_FM_034',
  'WL_FM_014',
  'WL_FM_015',
] as const

export type DispatchDocCode = (typeof DISPATCH_DOC_CODES)[number]

export const DISPATCH_DOC_LABELS: Record<DispatchDocCode, string> = {
  DELIVERY_NOTE:       'Delivery Note',
  TRANSPORTERS_DOC:    'Transporter’s Document',
  ORDER_CONFIRMATION:  'Order Confirmation',
  WL_FM_017:           'Sales Loading Advice (WL-FM-017)',
  WL_FM_012:           'Goods Dispatching Warehouse Inspection Checklist (WL-FM-012)',
  LAB_FM_033:          'Bin Loading Checklist (LAB-FM-033)',
  LAB_FM_032:          'Container Inspection Checklist (LAB-FM-032)',
  LAB_FM_034:          'Goods Dispatching Quality Inspection Checklist (LAB-FM-034)',
  WL_FM_014:           '20 Foot Container Loading Map (WL-FM-014)',
  WL_FM_015:           '40 Foot Container Loading Map (WL-FM-015)',
}

export interface DispatchDocument {
  id: string
  dispatch_id: string
  doc_code: DispatchDocCode
  status: 'pending' | 'uploaded' | 'signed' | 'verified' | 'na'
  file_url: string | null
  signed_by: string | null
  signed_at: string | null
  verified_by: string | null
  verified_at: string | null
  notes: string | null
}

export const UNIT_STAGE_LABELS: Record<UnitStage, string> = {
  received:           'Received',
  staged_sieving:     'Staged — Sieving',
  staged_refining:    'Staged — Refining',
  staged_blender:     'Staged — Blender',
  staged_pasteuriser: 'Staged — Pasteuriser',
  staged_granule:     'Staged — Granule',
  in_process:         'In process',
  finished:           'Finished',
  picked:             'Picked',
  loaded:             'Loaded',
  dispatched:         'Dispatched',
  customer_received:  'Customer received',
  qc_hold:            'QC hold',
  rejected:           'Rejected',
  consumed:           'Consumed',
}

export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  active:     'Active',
  in_process: 'In process',
  consumed:   'Consumed',
  dispatched: 'Dispatched',
  quarantine: 'Quarantine',
  rejected:   'Rejected',
}

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  raw_storage:      'Raw storage',
  staging:          'Staging',
  dispatch_bay:     'Dispatch bay',
  qc_hold:          'QC hold',
  reject:           'Reject',
  finished_storage: 'Finished storage',
  transit:          'Transit',
}
