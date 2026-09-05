/**
 * Reading and writing the label tables.
 *
 * Reads are client-side (the pages are client components, same as the rest of
 * the app). Every WRITE that changes workflow state goes through an API route
 * instead — see app/api/pasteuriser/labels. That is not ceremony:
 *
 *   - the approval state machine has rules a disabled button cannot enforce
 *     (ARCHITECTURE.md §6: the tier is decided server-side from a fresh read,
 *     never from a client flag),
 *   - serial allocation must happen in the database or two supervisors mint the
 *     same number (§5),
 *   - and the print ledger has to record who printed, resolved server-side.
 *
 * So this module reads freely and writes only drafts.
 */

import { getSupabaseClient } from '@/lib/supabase/client'
import type {
  LabelCertification,
  LabelLine,
  LabelMarkPosition,
  LabelMarket,
  LabelSizeKey,
  LabelTemplate,
  LabelTemplateStatus,
} from '@/lib/core/labels'

/** A row of public.label_templates. */
export interface LabelTemplateRow {
  id: string
  code: string
  name: string
  version: number
  status: LabelTemplateStatus
  market: LabelMarket
  organic: boolean
  size: LabelSizeKey
  lines: LabelLine[] | null
  certifications: LabelCertification[] | null
  mark_position: LabelMarkPosition
  proof_note: string | null
  supersedes_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  proof_issued_at: string | null
  approved_by: string | null
  approved_at: string | null
  rejected_reason: string | null
  cu_approval_ref: string | null
  customer_approval_ref: string | null
}

export interface LabelPoAssignmentRow {
  id: string
  template_id: string
  customer: string
  po_number: string
  item_number: string | null
  product: string | null
  net_mass: string | null
  gross_mass: string | null
  importer: string | null
  ordered_bags: number | null
  planned_batch_no: string | null
  planned_date: string | null
  status: 'open' | 'in_production' | 'closed' | 'cancelled'
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface LabelPrintRow {
  id: string
  job_card_id: string | null
  assignment_id: string | null
  template_id: string
  serial_no: string
  binding: Record<string, string>
  print_path: 'pplb' | 'browser' | 'pdf'
  reprint_of: string | null
  void_of: string | null
  void_reason: string | null
  printed_by: string | null
  printed_at: string
}

/**
 * A row → the core `LabelTemplate` the renderer and compliance work on.
 *
 * Null-coalescing `lines`/`certifications` matters: a row written before a
 * column existed, or by a partial insert, would otherwise crash the renderer
 * mid-shift. An empty label is caught by compliance ('empty'); a null one is a
 * TypeError on the capture screen.
 */
export function toTemplate(row: LabelTemplateRow): LabelTemplate {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    version: row.version,
    status: row.status,
    market: row.market,
    organic: row.organic,
    size: row.size,
    lines: row.lines ?? [],
    certifications: row.certifications ?? [],
    markPosition: row.mark_position,
    proofNote: row.proof_note ?? undefined,
  }
}

/**
 * The shared client re-pointed at the `public` schema.
 *
 * The label tables live in `public`, alongside job_cards_pasteuriser, while the
 * shared client is bound to `production`. Exported so the five pages that read
 * these tables call one helper instead of each repeating `as any`-style
 * re-pointing inline — which is how a screen ends up reaching the wrong schema
 * and silently finding nothing.
 */
export function publicDb() {
  return getSupabaseClient().schema('public')
}

/** An unknown thrown value → something showable. Every page catches with this,
 *  so none of them needs `catch (e: any)`. */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function fetchTemplates(): Promise<LabelTemplateRow[]> {
  const { data, error } = await publicDb()
    .from('label_templates')
    .select('*')
    .order('code', { ascending: true })
    .order('version', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as LabelTemplateRow[]
}

export async function fetchTemplate(id: string): Promise<LabelTemplateRow | null> {
  const { data, error } = await publicDb()
    .from('label_templates').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as LabelTemplateRow | null
}

export interface TemplateEventRow {
  id: string
  template_id: string
  event: 'created' | 'proof_issued' | 'approved' | 'rejected' | 'superseded' | 'reopened'
  actor_id: string | null
  note: string | null
  external_ref: string | null
  created_at: string
}

export async function fetchTemplateEvents(templateId: string): Promise<TemplateEventRow[]> {
  const { data, error } = await publicDb()
    .from('label_template_events')
    .select('*').eq('template_id', templateId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as TemplateEventRow[]
}

/**
 * PO assignments, newest first, with their template joined.
 *
 * `status` defaults to the ones a production manager cares about. Closed and
 * cancelled orders stay in the table — they are the audit trail — but showing
 * them on the job-card picker by default would bury the three that are actually
 * live.
 */
export async function fetchAssignments(
  statuses: LabelPoAssignmentRow['status'][] = ['open', 'in_production'],
): Promise<(LabelPoAssignmentRow & { template: LabelTemplateRow })[]> {
  const { data, error } = await publicDb()
    .from('label_po_assignments')
    .select('*, template:label_templates(*)')
    .in('status', statuses)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as (LabelPoAssignmentRow & { template: LabelTemplateRow })[]
}

export async function fetchPrints(jobCardId: string): Promise<LabelPrintRow[]> {
  const { data, error } = await publicDb()
    .from('label_prints')
    .select('*').eq('job_card_id', jobCardId)
    .order('printed_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as LabelPrintRow[]
}

/**
 * Serials on this job card that are still live.
 *
 * A void row reverses an earlier print, so a serial with a matching void is not
 * on a usable bag. Reprints repeat a serial by design and must not be counted
 * twice — that is the same rule as reporting summing `bagging_out` only and
 * never `topped_up` (ARCHITECTURE.md §6).
 */
export function liveSerials(prints: LabelPrintRow[]): string[] {
  const voided = new Set(prints.filter(p => p.void_of).map(p => p.void_of as string))
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of prints) {
    if (p.void_of) continue          // the void row itself is not a label
    if (voided.has(p.id)) continue   // this print was reversed
    if (p.reprint_of) continue       // same bag, already counted via the original
    if (seen.has(p.serial_no)) continue
    seen.add(p.serial_no)
    out.push(p.serial_no)
  }
  return out
}

/** Save edits to a DRAFT template. Any other status is refused server-side too. */
export async function saveDraft(
  id: string,
  patch: Partial<Pick<LabelTemplateRow,
    'name' | 'market' | 'organic' | 'size' | 'lines' | 'certifications' | 'mark_position' | 'proof_note'>>,
): Promise<void> {
  const { error } = await publicDb()
    .from('label_templates')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'draft')   // belt and braces; the route enforces it properly
  if (error) throw new Error(error.message)
}
