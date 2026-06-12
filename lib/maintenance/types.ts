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
export interface Roster { id: number; technician: string; start_at: string; end_at: string }
export interface AreaQc { id: number; area: string; qc_name: string }
export interface Slot { id: number; card_id: number | null; technician: string; start_at: string; end_at: string; note: string }
export interface Template { id: number; frequency: 'weekly' | 'monthly'; area: string; doc_ref: string; tasks: string[]; sort_order: number }
export interface Completion { id: number; template_id: number; period_key: string; task_states: Record<string, { done?: boolean; fault?: boolean; notes?: string }>; comments: string; completed_by: string }
export interface AnnualItem { id: number; category: string; asset: string; serial_no: string; supplier: string; next_due: string | null; notes: string }
export interface SparePart { id: number; part_no: string; class: string; description: string; qty_new: number; qty_used: number }
export interface Offsite { id: number; item: string; sent_to: string; date_sent: string | null; status: string }

// Chat (WhatsApp-style job-card thread). Backend is another workstream; this is
// the shape the JobCardChat component consumes.
export interface ChatMessage {
  id: number
  card_id: number
  author_id: string | null
  author_name: string
  body: string
  mentions: string[]
  attachments: { path: string; name: string; url?: string }[]
  created_at: string
}
