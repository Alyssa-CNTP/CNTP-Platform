// lib/maintenance/types.ts
// Shared maintenance-module types — extracted verbatim from the original
// monolithic page (no behaviour change).

export const STATUSES = ['raised', 'clarify', 'assigned', 'in_progress', 'qc_check', 'verify', 'complete'] as const
export type Status = typeof STATUSES[number]

export type View = 'manager' | 'tech' | 'qc' | 'raiser'
export type QcAnswer = 'yes' | 'no' | 'na'

export interface JobCard {
  id: number; card_no: string; area: string; machine: string | null
  maint_types: string[]; description: string; long_desc: string
  workflow: 'breakdown' | 'planned'
  raised_by: string; raised_at: string
  status: Status; assigned_to: string | null; assigned_at: string | null
  accepted_at: string | null; completed_at: string | null
  work_done: string; root_cause: string; tools_used: string
  qc_required: boolean; external: boolean; external_company: string
  qc_checks: any[]; qc_name: string; qc_done_at: string | null
  verified_at: string | null; verified_ok: boolean | null
  photo_url: string | null; ai_suggestion: string; comments: string
  reopen_count: number
}
export interface CardLog { id: number; card_id: number; kind: 'comment' | 'event'; stage: string; author: string; body: string; created_at: string }
export interface SpareUsed { id: number; card_id: number; part_id: number | null; description: string; qty: number; from_stock: string; is_critical: boolean; logged_by: string; created_at: string }
export interface Roster { id: number; technician: string; technician_user_id?: string | null; start_at: string; end_at: string }
export interface AreaQc { id: number; area: string; qc_name: string; qc_user_id?: string | null }
export interface Slot { id: number; card_id: number | null; technician: string; technician_user_id?: string | null; start_at: string; end_at: string; note: string }

// Live staff directory entry (GET /api/maintenance/staff). Falls back to TECHS.
export interface Staff { id: string | null; name: string; initials: string; email?: string | null; phone?: string | null; role?: string }
export interface Template { id: number; frequency: 'weekly' | 'monthly'; area: string; doc_ref: string; tasks: string[]; sort_order: number }
// task_states values carry who ticked the task and when (audit trail)
export interface Completion { id: number; template_id: number; period_key: string; task_states: Record<string, { done?: boolean; fault?: boolean; notes?: string; by?: string; at?: string }>; comments: string; completed_by: string; updated_at?: string }
export interface AnnualItem { id: number; category: string; asset: string; serial_no: string; supplier: string; next_due: string | null; notes: string }
export interface SparePart { id: number; part_no: string; class: string; description: string; qty_new: number; qty_used: number; barcode?: string | null }
export interface Offsite { id: number; item: string; sent_to: string; date_sent: string | null; status: string }

// ── Readings & registers (imported from Maintenance_Database.xlsx) ──
export interface IpReading { id: number; reading_date: string; flow_meter_l: number | null; tank_dip_l: number | null; fuel_received_l: number | null; cost_r: number | null; recorded_by: string }
export interface DieselReading { id: number; reading_date: string; run_hours: number | null; fuel_l: number | null; recorded_by: string }
export interface LsLog { id: number; log_date: string; stage: string; time_slot: string; run_hours: number | null; recorded_by: string }
export interface WaterReading { id: number; reading_date: string; main_meter: number | null; unit2_w1: number | null; unit2_w2: number | null; unit1: number | null; boiler: number | null; recorded_by: string }
export interface BoilerStart { id: number; log_date: string; switched_on_by: string; morning_shift: string; afternoon_shift: string }
export interface EqConfig { id: number; equipment: string; service_interval_hours: number; hours_per_workday: number; active: boolean }
export interface EqHours { id: number; equipment: string; reading_date: string; total_hours: number | null; hours_since_service: number | null; serviced: boolean; notes: string; recorded_by: string }
export interface CalAsset { id: number; serial_no: string; department: string; asset_name: string; last_done: string | null; interval_days: number; weekly_check: boolean; comment: string; active: boolean }

// Chat (WhatsApp-style job-card thread). Backend is another workstream; this is
// the shape the JobCardChat component consumes.
export interface ChatMessage {
  id: number
  card_id: number
  author_id: string | null
  author_name: string
  body: string
  mentions: string[]
  attachments: { path: string; name: string; size?: number; mime?: string; url?: string }[]
  created_at: string
}
