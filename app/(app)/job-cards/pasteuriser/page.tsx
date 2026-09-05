'use client'

import { Fragment, Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import { Save, Send, CheckCircle2, XCircle, Clock, Printer, Download, FileClock, Plus } from 'lucide-react'
import clsx from 'clsx'
import { jsPDF } from 'jspdf'
import { useAuth } from '@/lib/auth/context'
import { listBoms, getBomComponents, findParentBlendBom, type BomSummary } from '@/lib/production/bom'
import { upperCode } from '@/lib/production/normalize-code'
import { loadImage } from '@/lib/pdf/load-image'
import { getMySignatureStatus, type MySignatureStatus } from '@/lib/production/employee-signature'
import { JobCardApprovalsPanel } from '@/components/production/JobCardApprovalsPanel'
import { publicDb } from '@/features/pasteuriser-labels'

interface RatioLine { componentItemId: string; label: string; pct: number }
interface PackagingLine { componentItemId: string; label: string; kgPerUnit: number }
type CardStatus = 'draft' | 'sent_for_approval' | 'approved' | 'rejected'

interface Form {
  customer: string; date_of_card: string; expected_commencement: string
  job_card_no: string; item_no: string; blend_description: string
  fine_leaf_export_a_kg: string; fine_leaf_export_a_pct: string
  fine_leaf_blend_b_kg: string; fine_leaf_blend_b_pct: string
  cut_block_kg: string; cut_block_pct: string
  clean_block_kg: string; clean_block_pct: string; total_blend_size: string
  fp_fine_leaf_export_a_pct: string; fp_fine_leaf_blend_b_pct: string
  fp_sg_granules_pct: string
  fp_cut_coarse_leaf_a_pct: string; fp_cut_coarse_leaf_b_pct: string; fp_cut_coarse_leaf_c_pct: string
  fp_fine_granule_pct: string
  product_name: string; total_mass: string; weight_per_bulk_bag: string
  no_of_bags: string; packaging: string; batch_number: string
  customer_po: string; bag_markings: string; local_or_export: string; palletised: string
  debagging_hopper_inverter: string; debagging_hopper_manual: string
  steriliser_inverter: string; post_sieve_plate_size: string; product_temp_at_pasteuriser: string
  special_instructions: string; rework_material: string
  sig_production_coordinator: string | null; sig_production_supervisor: string | null
  sig_quality_officer: string | null; sig_production_manager: string | null
  submitted_at: string | null
  // BOM-driven generation + approval workflow
  status: CardStatus
  bom_output_item_id: string | null
  rejected_reason: string | null
  blend_ratio_lines: RatioLine[] | null
  final_ratio_lines: RatioLine[] | null
  packaging_item_id: string | null
  packaging_lines: PackagingLine[] | null
  // The approved label + customer PO this card produces against. Nullable:
  // plenty of Pasteuriser product has no customer label, and cards raised
  // before the label workflow existed have none.
  label_assignment_id: string | null
}

function empty(): Form {
  return {
    customer: '', date_of_card: format(new Date(), 'yyyy-MM-dd'), expected_commencement: '', job_card_no: '', item_no: '',
    blend_description: '', fine_leaf_export_a_kg: '', fine_leaf_export_a_pct: '', fine_leaf_blend_b_kg: '', fine_leaf_blend_b_pct: '',
    cut_block_kg: '', cut_block_pct: '', clean_block_kg: '', clean_block_pct: '', total_blend_size: '',
    fp_fine_leaf_export_a_pct: '', fp_fine_leaf_blend_b_pct: '', fp_sg_granules_pct: '',
    fp_cut_coarse_leaf_a_pct: '', fp_cut_coarse_leaf_b_pct: '', fp_cut_coarse_leaf_c_pct: '',
    fp_fine_granule_pct: '', product_name: '', total_mass: '', weight_per_bulk_bag: '',
    no_of_bags: '', packaging: '', batch_number: '', customer_po: '', bag_markings: '',
    local_or_export: 'Export', palletised: 'No',
    debagging_hopper_inverter: 'Auto', debagging_hopper_manual: '',
    steriliser_inverter: '', post_sieve_plate_size: '', product_temp_at_pasteuriser: '>85°C',
    special_instructions: '', rework_material: '',
    sig_production_coordinator: null, sig_production_supervisor: null,
    sig_quality_officer: null, sig_production_manager: null, submitted_at: null,
    label_assignment_id: null,
    status: 'draft', bom_output_item_id: null, rejected_reason: null,
    blend_ratio_lines: null, final_ratio_lines: null,
    packaging_item_id: null, packaging_lines: null,
  }
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><label className="font-mono text-[10px] uppercase tracking-wide text-text-muted">{label}</label>{children}</div>
}

function RatioTable({ lines }: { lines: RatioLine[] }) {
  const total = lines.reduce((s, l) => s + l.pct, 0)
  const outOfRange = Math.abs(total - 100) > 1
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-surface-rule">
          {lines.map(l => (
            <tr key={l.componentItemId}>
              <td className="py-2 text-[13px] text-text">
                <span className="font-mono text-[11px] text-text-muted mr-1.5">{l.componentItemId}</span>{l.label}
              </td>
              <td className="py-1.5 pl-2 text-right font-mono text-[13px] text-text w-20">{l.pct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={clsx('font-mono text-[10px] mt-1 text-right', outOfRange ? 'text-warn' : 'text-text-faint')}>Total: {total.toFixed(1)}%</p>
    </div>
  )
}

// Quality's own sign-off, appearing once a card is approved. No drawing — the
// signature already on file (Staff Directory profile) is stamped server-side
// the moment they click; the click itself IS the identity verification.
function QualitySignOff({ cardId, onSigned }: { cardId: string; onSigned: (record: any) => void }) {
  const [status, setStatus] = useState<MySignatureStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { getMySignatureStatus().then(setStatus) }, [])

  async function sign() {
    setBusy(true); setError(null)
    const res = await fetch(`/api/production/job-cards/${cardId}/quality-sign`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    if (res.ok) onSigned(body.record)
    else setError(body.error || 'Could not sign')
    setBusy(false)
  }

  if (!status) return null
  if (!status.hasSignature) {
    return (
      <p className="text-[11px] text-warn">
        No signature on file — {status.employeeId
          ? <Link href={`/production/staff/${status.employeeId}`} className="underline">set one up on your Staff Directory profile</Link>
          : 'ask IT to link your login to your Staff Directory profile'} first.
      </p>
    )
  }
  return (
    <div className="space-y-1.5">
      <button disabled={busy}
        onClick={sign}
        className="px-3 py-2 rounded-lg text-[13px] font-semibold bg-brand text-white hover:opacity-90 disabled:opacity-60">
        {busy ? 'Signing…' : `Verify & Sign as ${status.employeeName ?? 'you'}`}
      </button>
      {error && <p className="text-[11px] text-err">{error}</p>}
    </div>
  )
}

// Search-picker over Pasteuriser-work-centre BOMs (production.bom_components),
// following the same pattern as ItemPicker but over listBoms() instead of
// Master Inventory — picking one auto-fills both ratio tables and the item
// code/description, eliminating hand-re-typing what the BOM already encodes.
function BomPicker({ onPick, disabled }: { onPick: (b: BomSummary) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<BomSummary[]>([])

  useEffect(() => {
    let cancelled = false
    listBoms('06-PASTEURISING', query || undefined).then(r => { if (!cancelled) setResults(r.slice(0, 30)) })
    return () => { cancelled = true }
  }, [query])

  return (
    <div className="relative">
      <input value={query} disabled={disabled}
        onChange={e => { setQuery(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        placeholder="Search Acumatica code or product…" className="input font-mono" />
      {open && !disabled && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-surface-rule bg-surface-card shadow-lg">
          {results.map(b => (
            <button key={b.bomId} type="button"
              onClick={() => { onPick(b); setQuery(`${b.outputItemId} — ${b.outputDescription ?? ''}`); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-surface-dim/60 text-[12px] border-b border-surface-rule/40 last:border-0">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[11px] text-text">{b.outputItemId}</span>
                {!b.itemFound && <span className="text-[9px] text-warn">not in Master Inventory</span>}
              </div>
              <div className="text-text-muted truncate">{b.outputDescription}</div>
            </button>
          ))}
        </div>
      )}
      {open && (
        <button type="button" onClick={() => setOpen(false)}
          className="fixed inset-0 z-[5] cursor-default" style={{ background: 'transparent' }} aria-hidden />
      )}
    </div>
  )
}

interface DraftRow {
  id: string; job_card_no: string | null; item_no: string | null
  product_name: string | null; customer: string | null; date_of_card: string | null; created_at: string
}

// A saved draft previously had no way back into the UI at all — the form's
// savedId only ever lived in React state, so navigating away (or refreshing)
// lost the trail entirely and finding it meant querying Supabase directly.
// This lists every draft-status card so a manager can resume one with a
// click, and excludes whichever draft is currently open in the form.
function DraftsPanel({ excludeId, refreshToken, onResume }: {
  excludeId: string | null; refreshToken: number; onResume: (id: string) => void
}) {
  const db = getDb()
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    db.from('job_cards_pasteuriser')
      .select('id, job_card_no, item_no, product_name, customer, date_of_card, created_at')
      .eq('status', 'draft').order('created_at', { ascending: false }).limit(20)
      .then(({ data }: any) => { if (!cancelled) { setDrafts((data as DraftRow[]) ?? []); setLoading(false) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  const visible = drafts.filter(d => d.id !== excludeId)
  if (loading || visible.length === 0) return null

  return (
    <div className="card p-4 space-y-2 border border-surface-rule no-print">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left">
        <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold flex items-center gap-1.5">
          <FileClock className="w-3.5 h-3.5" /> Saved drafts ({visible.length})
        </span>
        <span className="text-[10px] text-text-faint">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="divide-y divide-surface-rule -mx-4 -mb-4 mt-1">
          {visible.map(d => (
            <button key={d.id} type="button" onClick={() => onResume(d.id)}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-dim/40">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-text truncate">{d.product_name || d.item_no || d.job_card_no || 'Untitled draft'}</div>
                <div className="text-[11px] text-text-muted font-mono truncate">
                  {d.job_card_no || '—'} · {d.customer || 'no customer'}
                  {d.date_of_card ? ` · ${format(new Date(d.date_of_card + 'T12:00:00'), 'd MMM')}` : ''}
                </div>
              </div>
              <span className="text-[10px] text-brand font-semibold shrink-0">Resume →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PasteuriserJobCardScreen() {
  const db = getDb()
  const { p, isFullAdmin, isQuality } = useAuth()
  const canGenerate = isFullAdmin || p('can_generate_job_cards')
  const canApprove = isFullAdmin || p('can_approve_job_cards')
  const searchParams = useSearchParams()
  const deepLinkBomId = searchParams.get('bomId')
  // Arriving from /pasteuriser/job-cards: the manager picked an approved
  // label + PO and this card produces against it.
  const deepLinkAssignment = searchParams.get('assignment')

  const [form, setForm] = useState<Form>(empty())
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [bomLoading, setBomLoading] = useState(false)
  const [myStatus, setMyStatus] = useState<MySignatureStatus | null>(null)
  const [jobCardNoError, setJobCardNoError] = useState<string | null>(null)
  const [lastOrderNote, setLastOrderNote] = useState<string | null>(null)
  const [draftsRefresh, setDraftsRefresh] = useState(0)

  // Locked once sent for approval or approved — the manager's job is done;
  // a supervisor either approves it (via the panel above) or rejects it back
  // to draft-editable. Legacy submitted_at (pre-workflow cards) also locks.
  const locked = form.status === 'sent_for_approval' || form.status === 'approved' || !!form.submitted_at
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  // A fresh draft gets its number the moment the page opens — auto, atomic
  // (public.next_job_card_no(), a DB sequence), never hand-typed. Surfaced
  // in the UI (not just console) if it fails, with a manual retry — a silent
  // failure here just looked like the feature didn't exist.
  function generateJobCardNo() {
    setJobCardNoError(null)
    db.rpc('next_job_card_no' as any).then(({ data, error }: any) => {
      if (error) {
        setJobCardNoError(`Could not auto-generate a number — ${error.message || error.code || 'unknown error'} (migration 20260729_003 must be applied in this environment)`)
        return
      }
      if (data) setForm(f => (f.job_card_no ? f : { ...f, job_card_no: data as string }))
    })
  }
  useEffect(() => {
    if (savedId || form.job_card_no) return
    generateJobCardNo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Deep-linked from the BOMs page's "Generate Job Card" button (?bomId=...) —
  // picks that BOM automatically so the manager never has to re-search it here.
  useEffect(() => {
    if (!deepLinkBomId) return
    listBoms('06-PASTEURISING').then(all => {
      const match = all.find(b => b.bomId === deepLinkBomId)
      if (match) pickBom(match)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBomId])

  // Deep-linked from /pasteuriser/job-cards — the manager picked an approved
  // label with a customer PO on it. Prefills the customer, PO and the order's
  // own product/item, and binds the card to that assignment so the supervisor's
  // print screen knows which approved wording this run's bags carry.
  //
  // The supply-chain planned batch number is offered as a DEFAULT, not
  // enforced: it is advisory, and the manager sets the real batch on the day.
  // The whole workflow exists so the line does not wait on that field.
  useEffect(() => {
    if (!deepLinkAssignment) return
    ;(async () => {
      const { data } = await publicDb()
        .from('label_po_assignments')
        .select('*, template:label_templates(name, code, version)')
        .eq('id', deepLinkAssignment).maybeSingle()
      if (!data) return
      setForm(f => ({
        ...f,
        label_assignment_id: data.id,
        customer:     f.customer     || data.customer   || '',
        customer_po:  f.customer_po  || data.po_number  || '',
        item_no:      f.item_no      || data.item_number || '',
        product_name: f.product_name || data.product    || '',
        batch_number: f.batch_number || data.planned_batch_no || '',
        expected_commencement: f.expected_commencement || data.planned_date || '',
        bag_markings: f.bag_markings || (data.template ? `${data.template.name} (${data.template.code} v${data.template.version})` : ''),
      }))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkAssignment])

  // No drawing here — "Send to Supervisor" IS the manager's Verify & Sign;
  // this just tells the UI whether they have a signature on file yet.
  useEffect(() => { getMySignatureStatus().then(setMyStatus) }, [])

  async function save(patch?: Partial<Form>): Promise<string | null> {
    setSaving(true)
    const nextForm = { ...form, ...(patch ?? {}) }
    const payload = { ...nextForm, batch_number: upperCode(nextForm.batch_number) }
    let id = savedId
    if (id) { await db.from('job_cards_pasteuriser').update(payload).eq('id', id) }
    else {
      const { data } = await db.from('job_cards_pasteuriser').insert(payload).select('id').single()
      if (data) { id = (data as any).id; setSavedId(id); setDraftsRefresh(x => x + 1) }
    }
    setSaving(false)
    setForm(f => ({ ...f, ...(patch ?? {}), batch_number: payload.batch_number }))
    saveSettingsTemplate(nextForm)
    return id
  }

  // Plant settings + special/re-work instructions, remembered per (item,
  // customer) so the manager only ever types them once for a given blend and
  // customer — every later card for the same pair prefills them (still
  // editable). Best-effort: never blocks the primary save.
  async function saveSettingsTemplate(f: Form) {
    const item = upperCode(f.item_no)
    const customer = f.customer.trim()
    if (!item || !customer) return
    try {
      await db.from('job_card_settings_templates').upsert({
        item_no: item, customer,
        debagging_hopper_inverter: f.debagging_hopper_inverter || null,
        debagging_hopper_manual: f.debagging_hopper_manual || null,
        steriliser_inverter: f.steriliser_inverter || null,
        post_sieve_plate_size: f.post_sieve_plate_size || null,
        product_temp_at_pasteuriser: f.product_temp_at_pasteuriser || null,
        special_instructions: f.special_instructions || null,
        rework_material: f.rework_material || null,
      } as any, { onConflict: 'item_no,customer' })
    } catch { /* memory is a convenience, never block the real save */ }
  }

  async function applySettingsTemplate(itemNo: string, customer: string) {
    const item = upperCode(itemNo)
    const cust = customer.trim()
    if (!item || !cust) return
    const { data } = await db.from('job_card_settings_templates')
      .select('*').eq('item_no', item).ilike('customer', cust).maybeSingle()
    if (!data) return
    const t = data as any
    // Only fill fields the manager hasn't already touched this session — never
    // clobber something they just typed.
    setForm(f => ({
      ...f,
      debagging_hopper_inverter: f.debagging_hopper_inverter || t.debagging_hopper_inverter || f.debagging_hopper_inverter,
      debagging_hopper_manual: f.debagging_hopper_manual || t.debagging_hopper_manual || f.debagging_hopper_manual,
      steriliser_inverter: f.steriliser_inverter || t.steriliser_inverter || f.steriliser_inverter,
      post_sieve_plate_size: f.post_sieve_plate_size || t.post_sieve_plate_size || f.post_sieve_plate_size,
      product_temp_at_pasteuriser: (f.product_temp_at_pasteuriser === '>85°C' || !f.product_temp_at_pasteuriser)
        ? (t.product_temp_at_pasteuriser || f.product_temp_at_pasteuriser) : f.product_temp_at_pasteuriser,
      special_instructions: f.special_instructions || t.special_instructions || f.special_instructions,
      rework_material: f.rework_material || t.rework_material || f.rework_material,
    }))
  }

  async function pickBom(b: BomSummary) {
    setBomLoading(true)
    const [finalComponents, parent] = await Promise.all([
      getBomComponents(b.bomId),
      findParentBlendBom(b.bomId),
    ])
    const finalLines: RatioLine[] = finalComponents.map(c => ({
      componentItemId: c.componentItemId, label: c.componentDescription || c.componentItemId, pct: c.qtyRequired * 100,
    }))
    const blendLines: RatioLine[] = (parent?.components ?? []).map(c => ({
      componentItemId: c.componentItemId, label: c.componentDescription || c.componentItemId, pct: c.qtyRequired * 100,
    }))
    // Packaging is predefined per finished good in the BOM itself — any
    // component line measured in PCS (a bag/box/carton, not a raw material)
    // with qty_required as "N units per kg" (e.g. 0.055556 = 1 per 18kg).
    // The manager confirms rather than types it; No. of bags then derives
    // from Total mass automatically.
    const packagingLines: PackagingLine[] = finalComponents
      .filter(c => c.uom === 'PCS' && c.qtyRequired > 0)
      .map(c => ({ componentItemId: c.componentItemId, label: c.componentDescription || c.componentItemId, kgPerUnit: Math.round((1 / c.qtyRequired) * 100) / 100 }))
    const primaryPackaging = packagingLines[0] ?? null

    setForm(f => ({
      ...f,
      item_no: upperCode(b.outputItemId) ?? b.outputItemId,
      product_name: b.outputDescription ?? f.product_name,
      blend_description: parent?.outputDescription ?? f.blend_description,
      bom_output_item_id: b.outputItemId,
      final_ratio_lines: finalLines,
      blend_ratio_lines: blendLines.length ? blendLines : null,
      packaging_lines: packagingLines.length ? packagingLines : null,
      packaging_item_id: primaryPackaging?.componentItemId ?? f.packaging_item_id,
      packaging: primaryPackaging?.label ?? f.packaging,
      weight_per_bulk_bag: primaryPackaging ? String(primaryPackaging.kgPerUnit) : f.weight_per_bulk_bag,
    }))
    if (form.customer.trim()) applySettingsTemplate(b.outputItemId, form.customer)
    setBomLoading(false)
  }

  function selectPackaging(line: PackagingLine) {
    setForm(f => ({ ...f, packaging_item_id: line.componentItemId, packaging: line.label, weight_per_bulk_bag: String(line.kgPerUnit) }))
  }

  // No. of bags is always Total mass ÷ Weight per bulk bag once both are
  // known — computed live, still a plain editable field for a manual override.
  useEffect(() => {
    const mass = parseFloat(form.total_mass)
    const perBag = parseFloat(form.weight_per_bulk_bag)
    if (mass > 0 && perBag > 0) {
      const bags = String(Math.ceil(mass / perBag))
      setForm(f => (f.no_of_bags === bags ? f : { ...f, no_of_bags: bags }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.total_mass, form.weight_per_bulk_bag])

  async function onCustomerBlur() {
    if (form.item_no.trim()) applySettingsTemplate(form.item_no, form.customer)
    // A customer usually reorders the same thing — if no BOM has been picked
    // yet this session, default to whatever we last generated for them
    // (still fully overridable via the picker above).
    if (!form.bom_output_item_id && form.customer.trim()) {
      const { data } = await db.from('job_cards_pasteuriser')
        .select('bom_output_item_id').eq('customer', form.customer.trim())
        .not('bom_output_item_id', 'is', null)
        .order('date_of_card', { ascending: false }).limit(1).maybeSingle()
      const lastItemId = (data as any)?.bom_output_item_id
      if (lastItemId) {
        const all = await listBoms('06-PASTEURISING')
        const match = all.find(b => b.outputItemId === lastItemId)
        if (match && !form.bom_output_item_id) { setLastOrderNote(match.outputItemId); await pickBom(match) }
      }
    }
  }

  async function sendForApproval() {
    setSending(true)
    const id = await save()
    if (id) {
      const res = await fetch(`/api/production/job-cards/${id}/send-for-approval`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (res.ok) setForm(f => ({ ...f, status: 'sent_for_approval', sig_production_manager: body.record?.sig_production_manager ?? f.sig_production_manager }))
      else alert(body.error || 'Could not send for approval')
    }
    setSending(false)
  }

  // Loads a previously saved draft back into the form — the only way back in
  // before this was querying Supabase directly, since savedId only ever lived
  // in React state. Missing/null columns fall back to empty()'s defaults so a
  // partially-filled draft doesn't render undefined into a controlled input.
  async function resumeDraft(id: string) {
    const { data } = await db.from('job_cards_pasteuriser').select('*').eq('id', id).single()
    if (!data) return
    const row = data as any
    const base = empty()
    const next: any = { ...base }
    for (const key of Object.keys(base)) {
      if (row[key] !== undefined && row[key] !== null) next[key] = row[key]
    }
    setForm(next as Form)
    setSavedId(id)
    setJobCardNoError(null)
    setLastOrderNote(null)
  }

  function startNew() {
    setForm(empty())
    setSavedId(null)
    setJobCardNoError(null)
    setLastOrderNote(null)
    generateJobCardNo()
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-5 pb-48">
      <style>{`@media print { body * { visibility: hidden; } .jobcard-print, .jobcard-print * { visibility: visible; } .jobcard-print { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`}</style>

      <div className="rounded-2xl p-4 bg-brand text-white no-print flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-white/50 mb-1">PR-FM-013/1 · Cape Natural Tea Products</p>
          <h1 className="font-display font-extrabold text-2xl">Pasteuriser Line Job Card</h1>
        </div>
        {canGenerate && (savedId || form.job_card_no) && (
          <button type="button" onClick={startNew}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-[12px] font-semibold transition-colors">
            <Plus size={14} /> New job card
          </button>
        )}
      </div>

      {canApprove && <div className="no-print"><JobCardApprovalsPanel onApproved={resumeDraft} /></div>}

      {canGenerate && (
        <DraftsPanel excludeId={savedId} refreshToken={draftsRefresh} onResume={resumeDraft} />
      )}

      {canGenerate && !locked && (
        <div className="card p-4 space-y-2 border-2 border-brand/20 no-print">
          <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Generate from BOM</p>
          <BomPicker onPick={b => { setLastOrderNote(null); pickBom(b) }} disabled={bomLoading} />
          <p className="text-[11px] text-text-faint">Picks up the Acumatica code, blend ratio and final product ratio straight from the BOM catalogue — nothing here needs re-typing. Batch details, plant settings and special instructions below are still yours to fill in.</p>
          {lastOrderNote && (
            <p className="text-[11px] text-brand">Auto-filled <span className="font-mono">{lastOrderNote}</span> — {form.customer}'s last order. Search above to pick something different for this run.</p>
          )}
        </div>
      )}

      <div className="no-print space-y-5">
      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Job details</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="Customer"><input className="input" value={form.customer} onChange={set('customer')} onBlur={onCustomerBlur} disabled={locked} /></F>
          <F label="Date of job card"><input type="date" className="input" value={form.date_of_card} onChange={set('date_of_card')} disabled={locked} /></F>
          <F label="Expected commencement"><input type="date" className="input" value={form.expected_commencement} onChange={set('expected_commencement')} disabled={locked} /></F>
          <F label="Job card no. (auto)">
            <div className="flex items-center gap-1.5">
              <input className="input font-mono" value={form.job_card_no} onChange={set('job_card_no')} disabled={locked} placeholder={jobCardNoError ? '—' : 'Generating…'} />
              {!locked && !form.job_card_no && (
                <button type="button" onClick={generateJobCardNo} className="shrink-0 text-[11px] font-semibold text-brand hover:underline whitespace-nowrap">Retry</button>
              )}
            </div>
            {jobCardNoError && <p className="text-[10px] text-err mt-1">{jobCardNoError}</p>}
          </F>
        </div>
        <F label="Item no. (Acumatica code)"><input className="input font-mono" value={form.item_no} onChange={set('item_no')} disabled={locked || !!form.bom_output_item_id} /></F>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Diamond blender ratio — before adding granules</p>
        <F label="Blend description"><input className="input" value={form.blend_description} onChange={set('blend_description')} disabled={locked || !!form.bom_output_item_id} /></F>
        {form.blend_ratio_lines?.length ? (
          <RatioTable lines={form.blend_ratio_lines} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-surface-rule">
                <th className="text-left py-2 font-mono text-[10px] text-text-muted uppercase">Component</th>
                <th className="text-right py-2 font-mono text-[10px] text-text-muted uppercase w-24">kg</th>
                <th className="text-right py-2 font-mono text-[10px] text-text-muted uppercase w-24">%</th>
              </tr></thead>
              <tbody className="divide-y divide-surface-rule">
                {[
                  { label: 'Fine leaf: Export — A grade', kg: 'fine_leaf_export_a_kg', pct: 'fine_leaf_export_a_pct' },
                  { label: 'Fine leaf: Export Blend — B grade', kg: 'fine_leaf_blend_b_kg', pct: 'fine_leaf_blend_b_pct' },
                  { label: 'Cut block', kg: 'cut_block_kg', pct: 'cut_block_pct' },
                  { label: 'Clean block', kg: 'clean_block_kg', pct: 'clean_block_pct' },
                ].map(row => (
                  <tr key={row.kg}>
                    <td className="py-2 text-[13px] text-text">{row.label}</td>
                    <td className="py-1.5 pl-2"><input className="input text-right w-full" value={(form as any)[row.kg]} onChange={set(row.kg as any)} disabled={locked} placeholder="0.0" /></td>
                    <td className="py-1.5 pl-2"><input className="input text-right w-full" value={(form as any)[row.pct]} onChange={set(row.pct as any)} disabled={locked} placeholder="0%" /></td>
                  </tr>
                ))}
                <tr className="bg-surface">
                  <td className="py-2 font-bold text-[13px]">Total blend size</td>
                  <td className="py-1.5 pl-2"><input className="input text-right w-full font-bold" value={form.total_blend_size} onChange={set('total_blend_size')} disabled={locked} /></td>
                  <td />
                </tr>
              </tbody>
            </table>
            <p className="font-mono text-[10px] text-text-muted mt-2">** 3 blends required for a 3 ton batch</p>
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Final product ratio — Rooibos Tea</p>
        {form.final_ratio_lines?.length ? (
          <RatioTable lines={form.final_ratio_lines} />
        ) : (
          [
            { label: 'Fine leaf: Export — A grade %', key: 'fp_fine_leaf_export_a_pct' },
            { label: 'Fine leaf: Export Blend — B grade %', key: 'fp_fine_leaf_blend_b_pct' },
            { label: 'SG granules %', key: 'fp_sg_granules_pct' },
            { label: 'Cut coarse leaf: Export A grade %', key: 'fp_cut_coarse_leaf_a_pct' },
            { label: 'Cut coarse leaf: Export Blend B grade %', key: 'fp_cut_coarse_leaf_b_pct' },
            { label: 'Cut coarse leaf: Domestic C grade %', key: 'fp_cut_coarse_leaf_c_pct' },
            { label: 'Fine granule %', key: 'fp_fine_granule_pct' },
          ].map(row => (
            <div key={row.key} className="flex items-center justify-between gap-4">
              <span className="text-[13px] text-text flex-1">{row.label}</span>
              <input className="input w-24 text-right" value={(form as any)[row.key]} onChange={set(row.key as any)} disabled={locked} placeholder="0%" />
            </div>
          ))
        )}
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Batch details</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="Product name"><input className="input" value={form.product_name} onChange={set('product_name')} disabled={locked} /></F>
          <F label="Batch number"><input className="input font-mono" value={form.batch_number} onChange={set('batch_number')} disabled={locked} /></F>
          <F label="Total mass (kg)"><input className="input" value={form.total_mass} onChange={set('total_mass')} disabled={locked} /></F>
          <F label="Weight per bulk bag (kg)"><input className="input" value={form.weight_per_bulk_bag} onChange={set('weight_per_bulk_bag')} disabled={locked} /></F>
          <F label="No. of bags (auto — Total mass ÷ weight)"><input className="input" value={form.no_of_bags} onChange={set('no_of_bags')} disabled={locked} /></F>
          <F label="Packaging">
            {form.packaging_lines && form.packaging_lines.length > 1 ? (
              <select className="input" value={form.packaging_item_id ?? ''} disabled={locked}
                onChange={e => { const line = form.packaging_lines!.find(l => l.componentItemId === e.target.value); if (line) selectPackaging(line) }}>
                {form.packaging_lines.map(l => <option key={l.componentItemId} value={l.componentItemId}>{l.label} ({l.kgPerUnit}kg)</option>)}
              </select>
            ) : (
              <input className="input" value={form.packaging} onChange={set('packaging')} disabled={locked || !!form.packaging_item_id}
                placeholder={form.bom_output_item_id ? undefined : 'Pick a BOM above, or type it'} />
            )}
          </F>
          <F label="Customer PO"><input className="input" value={form.customer_po} onChange={set('customer_po')} disabled={locked} /></F>
          <F label="Bag markings"><input className="input" value={form.bag_markings} onChange={set('bag_markings')} disabled={locked} /></F>
          <F label="Local or export"><select className="input" value={form.local_or_export} onChange={set('local_or_export')} disabled={locked}><option>Export</option><option>Local</option></select></F>
          <F label="Palletised"><select className="input" value={form.palletised} onChange={set('palletised')} disabled={locked}><option>No</option><option>Yes</option></select></F>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Plant settings</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="Debagging hopper speed inverter setting"><input className="input" value={form.debagging_hopper_inverter} onChange={set('debagging_hopper_inverter')} disabled={locked} /></F>
          <F label="Debagging hopper manual setting"><input className="input" value={form.debagging_hopper_manual} onChange={set('debagging_hopper_manual')} disabled={locked} /></F>
          <F label="Steriliser inverter setting (%)"><input className="input" value={form.steriliser_inverter} onChange={set('steriliser_inverter')} disabled={locked} /></F>
          <F label="Post-sieve plate size (mm)"><input className="input" value={form.post_sieve_plate_size} onChange={set('post_sieve_plate_size')} disabled={locked} /></F>
        </div>
        <F label="Product temperature at pasteuriser (°C)"><input className="input" value={form.product_temp_at_pasteuriser} onChange={set('product_temp_at_pasteuriser')} disabled={locked} /></F>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Special instructions</p>
        <F label="Instructions"><textarea className="input resize-none" rows={3} value={form.special_instructions} onChange={set('special_instructions')} disabled={locked} placeholder="Over runs must be blended according to lab recommendation…" /></F>
        <F label="Re-work material for this batch"><textarea className="input resize-none" rows={2} value={form.rework_material} onChange={set('rework_material')} disabled={locked} /></F>
      </div>

      <div className="card p-4 space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Sign-offs</p>
        <p className="text-[11px] text-text-faint -mt-2">Sequential, no drawing: sending this card IS the Production Manager's Verify &amp; Sign, approving is the Supervisor's, and Quality signs once approved — each stamped from the signature already on file on their Staff Directory profile.</p>

        {form.sig_production_manager ? (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">Production Manager</p>
            <img src={form.sig_production_manager} alt="Production manager signature" style={{ height: 40 }} />
          </div>
        ) : !locked && myStatus && !myStatus.hasSignature ? (
          <p className="text-[11px] text-warn">
            No signature on file — {myStatus.employeeId
              ? <Link href={`/production/staff/${myStatus.employeeId}`} className="underline">set one up on your Staff Directory profile</Link>
              : 'ask IT to link your login to your Staff Directory profile'} before you can send this for approval.
          </p>
        ) : !locked && myStatus?.hasSignature ? (
          <p className="text-[11px] text-text-faint">Ready to sign as {myStatus.employeeName} — click "Send to Supervisor" below.</p>
        ) : null}

        {form.sig_production_supervisor ? (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">Production Supervisor</p>
            <img src={form.sig_production_supervisor} alt="Supervisor signature" style={{ height: 40 }} />
          </div>
        ) : (form.status === 'sent_for_approval' || form.status === 'approved') && (
          <p className="text-[11px] text-text-faint">Awaiting the Supervisor's sign-off.</p>
        )}

        {form.status === 'approved' && (
          form.sig_quality_officer ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">Quality Officer / Controller</p>
              <img src={form.sig_quality_officer} alt="Quality officer signature" style={{ height: 40 }} />
            </div>
          ) : (isFullAdmin || isQuality) && savedId ? (
            <QualitySignOff cardId={savedId} onSigned={rec => setForm(f => ({ ...f, sig_quality_officer: rec?.sig_quality_officer ?? f.sig_quality_officer }))} />
          ) : (
            <p className="text-[11px] text-text-faint">Awaiting the Quality Officer's sign-off.</p>
          )
        )}
      </div>

      {form.status === 'sent_for_approval' && (
        <div className="flex items-center gap-3 p-4 bg-info-bg border border-info/30 rounded-xl">
          <Clock size={20} className="text-info" />
          <p className="font-semibold text-text">Sent to the supervisor — awaiting approval.</p>
        </div>
      )}
      {form.status === 'approved' && (
        <div className="flex items-center gap-3 p-4 bg-ok-bg border border-ok/30 rounded-xl">
          <CheckCircle2 size={20} className="text-status-ok" />
          <p className="font-semibold text-text">Job card approved ✓</p>
        </div>
      )}
      {form.status === 'rejected' && (
        <div className="flex items-center gap-3 p-4 bg-err-bg border border-err/30 rounded-xl">
          <XCircle size={20} className="text-err" />
          <div>
            <p className="font-semibold text-text">Rejected by the supervisor.</p>
            {form.rejected_reason && <p className="text-[13px] text-text-muted mt-0.5">"{form.rejected_reason}"</p>}
            <p className="text-[12px] text-text-faint mt-1">Make your changes and send it again.</p>
          </div>
        </div>
      )}
      {submittedLegacy(form) && (
        <div className="flex items-center gap-3 p-4 bg-ok-bg border border-ok/30 rounded-xl">
          <CheckCircle2 size={20} className="text-status-ok" />
          <p className="font-semibold text-text">Job card submitted ✓</p>
        </div>
      )}
      </div>

      {/* Printable / downloadable view — a clean tabular layout for the audit
          trail, kept visually separate from the editable form above. Hidden
          on screen (Tailwind's `hidden`), shown only for print (`print:block`
          overrides it); the @media print rule above hides everything else and
          repositions this to fill the page. exportJobCardPdf() mirrors this
          layout by hand for the downloadable PDF (same approach as the COA
          page — kept in sync manually, not from one shared renderer). */}
      <div className="hidden print:block jobcard-print bg-white text-[#111] p-6 text-[12px]">
        <div className="flex items-center justify-between border-b-2 border-black pb-2 mb-3">
          <img src="/logo.png" alt="Cape Natural" style={{ height: 42 }} />
          <div className="text-right">
            <div className="font-bold text-[15px]">PASTEURISER LINE JOB CARD</div>
            <div className="text-[9px] text-gray-600">PR-FM-013/1 · Cape Natural Tea Products</div>
          </div>
        </div>
        <table className="w-full text-[11px] mb-3"><tbody>
          {[['Customer', form.customer], ['Job card no.', form.job_card_no], ['Date of job card', form.date_of_card],
            ['Expected commencement', form.expected_commencement], ['Item no.', form.item_no], ['Batch number', form.batch_number]]
            .reduce<[string, string][][]>((rows, cell, i) => { if (i % 2 === 0) rows.push([cell as any]); else rows[rows.length - 1].push(cell as any); return rows }, [])
            .map((pair, i) => (
              <tr key={i}>
                {pair.map(([label, val]) => (
                  <Fragment key={label}>
                    <td className="py-1 font-bold pr-2 w-1/6">{label}</td>
                    <td className="py-1 pr-6 border-b border-dotted border-gray-400 w-1/3">{val || '—'}</td>
                  </Fragment>
                ))}
              </tr>
          ))}
        </tbody></table>

        <div className="font-bold text-[11px] uppercase mb-1">Blend ratio — {form.blend_description || 'before adding granules'}</div>
        <table className="w-full text-[11px] mb-3 border border-gray-300">
          <thead><tr className="bg-gray-200"><th className="text-left p-1">Component</th><th className="text-right p-1 w-20">%</th></tr></thead>
          <tbody>{blendRatioRows(form).map(([label, pct]) => (
            <tr key={label} className="border-t border-gray-300"><td className="p-1">{label}</td><td className="p-1 text-right font-mono">{pct}</td></tr>
          ))}</tbody>
        </table>

        <div className="font-bold text-[11px] uppercase mb-1">Final product ratio</div>
        <table className="w-full text-[11px] mb-3 border border-gray-300">
          <thead><tr className="bg-gray-200"><th className="text-left p-1">Component</th><th className="text-right p-1 w-20">%</th></tr></thead>
          <tbody>{finalRatioRows(form).map(([label, pct]) => (
            <tr key={label} className="border-t border-gray-300"><td className="p-1">{label}</td><td className="p-1 text-right font-mono">{pct}</td></tr>
          ))}</tbody>
        </table>

        <table className="w-full text-[11px] mb-3"><tbody>
          {[['Product name', form.product_name], ['Total mass (kg)', form.total_mass], ['Weight/bulk bag (kg)', form.weight_per_bulk_bag],
            ['No. of bags', form.no_of_bags], ['Packaging', form.packaging], ['Customer PO', form.customer_po],
            ['Bag markings', form.bag_markings], ['Local or export', form.local_or_export], ['Palletised', form.palletised]]
            .reduce<[string, string][][]>((rows, cell, i) => { if (i % 2 === 0) rows.push([cell as any]); else rows[rows.length - 1].push(cell as any); return rows }, [])
            .map((pair, i) => (
              <tr key={i}>
                {pair.map(([label, val]) => (
                  <Fragment key={label}>
                    <td className="py-1 font-bold pr-2 w-1/6">{label}</td>
                    <td className="py-1 pr-6 border-b border-dotted border-gray-400 w-1/3">{val || '—'}</td>
                  </Fragment>
                ))}
                {pair.length === 1 && <Fragment><td /><td /></Fragment>}
              </tr>
          ))}
        </tbody></table>

        <table className="w-full text-[11px] mb-3"><tbody>
          <tr>
            <td className="py-1 font-bold pr-2 w-1/6">Hopper inverter</td><td className="py-1 pr-6 border-b border-dotted border-gray-400 w-1/3">{form.debagging_hopper_inverter || '—'}</td>
            <td className="py-1 font-bold pr-2 w-1/6">Hopper manual</td><td className="py-1 pr-6 border-b border-dotted border-gray-400 w-1/3">{form.debagging_hopper_manual || '—'}</td>
          </tr>
          <tr>
            <td className="py-1 font-bold pr-2">Steriliser inverter (%)</td><td className="py-1 pr-6 border-b border-dotted border-gray-400">{form.steriliser_inverter || '—'}</td>
            <td className="py-1 font-bold pr-2">Post-sieve plate (mm)</td><td className="py-1 pr-6 border-b border-dotted border-gray-400">{form.post_sieve_plate_size || '—'}</td>
          </tr>
          <tr>
            <td className="py-1 font-bold pr-2">Product temp. (°C)</td><td className="py-1 pr-6 border-b border-dotted border-gray-400" colSpan={3}>{form.product_temp_at_pasteuriser || '—'}</td>
          </tr>
        </tbody></table>

        {form.special_instructions && (
          <div className="mb-2"><div className="font-bold text-[11px] uppercase">Special instructions</div><div className="text-[11px]">{form.special_instructions}</div></div>
        )}
        {form.rework_material && (
          <div className="mb-3"><div className="font-bold text-[11px] uppercase">Re-work material</div><div className="text-[11px]">{form.rework_material}</div></div>
        )}

        <div className="grid grid-cols-3 gap-x-6 gap-y-6 mt-6">
          {[
            { label: 'Production Manager', sig: form.sig_production_manager },
            { label: 'Production Supervisor', sig: form.sig_production_supervisor },
            { label: 'Quality Officer / Controller', sig: form.sig_quality_officer },
          ].map(s => (
            <div key={s.label}>
              <div style={{ height: 30 }}>{s.sig && <img src={s.sig} alt="" style={{ height: 28 }} />}</div>
              <div className="border-t border-black pt-1 text-[10px] font-bold">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 p-4 bg-surface-card border-t border-surface-rule z-20 no-print">
        <div className="max-w-3xl mx-auto flex gap-3">
          <button onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-3 border border-surface-rule rounded-xl font-semibold text-sm text-text-muted hover:bg-surface">
            <Printer size={16} /> Print
          </button>
          <button onClick={() => exportJobCardPdf(form)}
            className="flex items-center gap-2 px-4 py-3 border border-surface-rule rounded-xl font-semibold text-sm text-text-muted hover:bg-surface">
            <Download size={16} /> PDF
          </button>
          <button onClick={() => save()} disabled={saving || locked}
            className="flex items-center gap-2 px-4 py-3 border border-surface-rule rounded-xl font-semibold text-sm text-text-muted hover:bg-surface disabled:opacity-40">
            <Save size={16} /> {saving ? 'Saving…' : 'Save draft'}
          </button>
          {!locked && (form.status === 'draft' || form.status === 'rejected') && (
            <button onClick={sendForApproval} disabled={sending || !myStatus?.hasSignature}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-base bg-brand text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed">
              <Send size={16} /> {sending ? 'Signing & sending…' : !myStatus?.hasSignature ? 'Signature required to send' : form.status === 'rejected' ? 'Verify & Sign to Resend' : 'Verify & Sign to Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PasteuriserJobCard() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-text-muted">Loading…</div>}>
      <PasteuriserJobCardScreen />
    </Suspense>
  )
}

// Any pre-workflow card only ever set submitted_at (no status column existed
// yet) — the migration backfills those to status='approved', so this is a
// belt-and-braces check for a card loaded before that backfill ran.
function submittedLegacy(form: Form) {
  return !!form.submitted_at && form.status !== 'approved' && form.status !== 'sent_for_approval' && form.status !== 'rejected'
}

// Normalize either the BOM-generated JSONB lines or the legacy fixed pct
// fields into one [label, pct-string] shape, so the printed table and the
// PDF export don't need two branches each — only this conversion does.
function blendRatioRows(form: Form): [string, string][] {
  if (form.blend_ratio_lines?.length) return form.blend_ratio_lines.map(l => [`${l.componentItemId} — ${l.label}`, `${l.pct.toFixed(1)}%`])
  return [
    ['Fine leaf: Export — A grade', form.fine_leaf_export_a_pct || '—'],
    ['Fine leaf: Export Blend — B grade', form.fine_leaf_blend_b_pct || '—'],
    ['Cut block', form.cut_block_pct || '—'],
    ['Clean block', form.clean_block_pct || '—'],
  ]
}
function finalRatioRows(form: Form): [string, string][] {
  if (form.final_ratio_lines?.length) return form.final_ratio_lines.map(l => [`${l.componentItemId} — ${l.label}`, `${l.pct.toFixed(1)}%`])
  return [
    ['Fine leaf: Export — A grade', form.fp_fine_leaf_export_a_pct || '—'],
    ['Fine leaf: Export Blend — B grade', form.fp_fine_leaf_blend_b_pct || '—'],
    ['SG granules', form.fp_sg_granules_pct || '—'],
    ['Cut coarse leaf: Export A grade', form.fp_cut_coarse_leaf_a_pct || '—'],
    ['Cut coarse leaf: Export Blend B grade', form.fp_cut_coarse_leaf_b_pct || '—'],
    ['Cut coarse leaf: Domestic C grade', form.fp_cut_coarse_leaf_c_pct || '—'],
    ['Fine granule', form.fp_fine_granule_pct || '—'],
  ]
}

// ─── PDF export (jsPDF, mirrors the COA page's approach: manual layout, no
// template engine, kept in sync by hand with the print-CSS view below) ────────
async function exportJobCardPdf(form: Form) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 40
  let y = 50

  const logo = await loadImage('/logo.png')
  if (logo) {
    const h = 42, w = logo.w * (h / logo.h)
    doc.addImage(logo.dataUrl, 'PNG', margin, y - 28, w, h)
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text('PASTEURISER LINE JOB CARD', pageW / 2, y, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text('PR-FM-013/1 · Cape Natural Tea Products', pageW / 2, y + 14, { align: 'center' })
  doc.setLineWidth(1.2); doc.line(margin, y + 24, pageW - margin, y + 24)
  y += 46

  // Label above value (not side-by-side) — a fixed label/value split column
  // overlapped on long labels ("Debagging hopper speed inverter setting" etc.)
  // since the value always started at a hardcoded +120pt regardless of how
  // wide the label actually was. Stacking removes the overlap entirely: label
  // and value never share a baseline, so label length can never collide with it.
  const kv = (rows: [string, string][]) => {
    const gap = 16
    const colW = (pageW - 2 * margin - gap) / 2
    const colX = [margin, margin + colW + gap]
    for (let i = 0; i < rows.length; i += 2) {
      for (let c = 0; c < 2; c++) {
        const item = rows[i + c]; if (!item) continue
        const x = colX[c]
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
        doc.text(item[0].toUpperCase(), x, y)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
        const valueLines = doc.splitTextToSize(String(item[1] || '—'), colW)
        doc.text(valueLines, x, y + 10)
        doc.setDrawColor(200); doc.setLineWidth(0.5)
        doc.line(x, y + 13, x + colW, y + 13)
      }
      y += 20
    }
    y += 6
  }

  const drawTable = (title: string, rows: [string, string][]) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(title.toUpperCase(), margin, y); y += 12
    const w = pageW - 2 * margin
    const cw = [w * 0.7, w * 0.3]
    doc.setFontSize(8)
    doc.setFillColor(230, 230, 230); doc.rect(margin, y - 9, w, 14, 'F')
    doc.setFont('helvetica', 'bold')
    doc.text('Component', margin + cw[0] / 2, y, { align: 'center' })
    doc.text('%', margin + cw[0] + cw[1] / 2, y, { align: 'center' })
    y += 6
    doc.setFont('helvetica', 'normal')
    rows.forEach(([label, pct]) => {
      const cellLines = doc.splitTextToSize(label, cw[0] - 8)
      const rowH = cellLines.length * 9 + 4
      doc.setDrawColor(200); doc.rect(margin, y - 2, w, rowH)
      doc.text(cellLines, margin + 4, y + 7)
      doc.line(margin + cw[0], y - 2, margin + cw[0], y - 2 + rowH)
      doc.text(pct, margin + cw[0] + cw[1] / 2, y + 7, { align: 'center' })
      y += rowH
    })
    y += 10
  }

  kv([
    ['Customer', form.customer], ['Job card no.', form.job_card_no],
    ['Date of job card', form.date_of_card], ['Expected commencement', form.expected_commencement],
    ['Item no.', form.item_no], ['Batch number', form.batch_number],
  ])

  drawTable(`Blend ratio — ${form.blend_description || 'before adding granules'}`, blendRatioRows(form))
  drawTable('Final product ratio', finalRatioRows(form))

  kv([
    ['Product name', form.product_name], ['Total mass (kg)', form.total_mass],
    ['Weight per bulk bag (kg)', form.weight_per_bulk_bag], ['No. of bags', form.no_of_bags],
    ['Packaging', form.packaging], ['Customer PO', form.customer_po],
    ['Bag markings', form.bag_markings], ['Local or export', form.local_or_export],
    ['Palletised', form.palletised], ['', ''],
  ])
  kv([
    ['Debagging hopper speed inverter', form.debagging_hopper_inverter],
    ['Debagging hopper manual setting', form.debagging_hopper_manual],
    ['Steriliser inverter setting (%)', form.steriliser_inverter],
    ['Post-sieve plate size (mm)', form.post_sieve_plate_size],
    ['Product temp. at pasteuriser (°C)', form.product_temp_at_pasteuriser], ['', ''],
  ])

  if (form.special_instructions) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('SPECIAL INSTRUCTIONS', margin, y); y += 11
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    const lines = doc.splitTextToSize(form.special_instructions, pageW - 2 * margin)
    doc.text(lines, margin, y); y += lines.length * 10 + 8
  }
  if (form.rework_material) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('RE-WORK MATERIAL', margin, y); y += 11
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    const lines = doc.splitTextToSize(form.rework_material, pageW - 2 * margin)
    doc.text(lines, margin, y); y += lines.length * 10 + 8
  }

  // Signatures — three slots in one row (Manager → Supervisor → Quality, the
  // actual sign-off order; already base64 data URLs from SignaturePad, so
  // loadImage just needs to read their natural size).
  const sigs = [
    { title: 'Production Manager', signature: form.sig_production_manager },
    { title: 'Production Supervisor', signature: form.sig_production_supervisor },
    { title: 'Quality Officer / Controller', signature: form.sig_quality_officer },
  ]
  y += 16
  const sigW = 150
  const gap = (pageW - 2 * margin - 3 * sigW) / 2
  const sigX = [margin, margin + sigW + gap, margin + 2 * (sigW + gap)]
  for (let col = 0; col < 3; col++) {
    const s = sigs[col]
    const x = sigX[col]
    if (s.signature) {
      const img = await loadImage(s.signature)
      if (img) {
        const h = 28, w = Math.min(sigW - 10, img.w * (h / img.h))
        try { doc.addImage(img.dataUrl, 'PNG', x, y - h - 2, w, h) } catch { /* ignore bad image */ }
      }
    }
    doc.setDrawColor(17); doc.setLineWidth(0.8); doc.line(x, y, x + sigW, y)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text(s.title, x, y + 12)
  }
  y += 50

  doc.save(`JobCard_${upperCode(form.batch_number) || form.item_no || 'pasteuriser'}.pdf`)
}
