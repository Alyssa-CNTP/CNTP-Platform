'use client'

import { Fragment, useEffect, useState } from 'react'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import { Save, Send, CheckCircle2, XCircle, Clock, ThumbsUp, ThumbsDown, Layers, Printer, Download } from 'lucide-react'
import clsx from 'clsx'
import { jsPDF } from 'jspdf'
import SignaturePad from '@/components/ui/SignaturePad'
import { useAuth } from '@/lib/auth/context'
import { listBoms, getBomComponents, findParentBlendBom, type BomSummary } from '@/lib/production/bom'
import { upperCode } from '@/lib/production/normalize-code'
import { loadImage } from '@/lib/pdf/load-image'

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

interface PendingCard {
  id: string
  job_card_no: string | null; item_no: string | null; product_name: string | null
  batch_number: string | null; customer: string | null; blend_description: string | null
  blend_ratio_lines: RatioLine[] | null; final_ratio_lines: RatioLine[] | null
  sent_for_approval_at: string | null
}

function PendingApprovals() {
  const db = getDb()
  const [cards, setCards] = useState<PendingCard[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function reload() {
    const { data } = await db.from('job_cards_pasteuriser')
      .select('id, job_card_no, item_no, product_name, batch_number, customer, blend_description, blend_ratio_lines, final_ratio_lines, sent_for_approval_at')
      .eq('status', 'sent_for_approval').order('sent_for_approval_at', { ascending: true })
    setCards((data as PendingCard[]) ?? [])
    setLoading(false)
  }
  useEffect(() => { reload() }, [])

  async function decide(id: string, decision: 'approved' | 'rejected', extra: { reason?: string; supervisorSignature?: string }) {
    const res = await fetch(`/api/production/job-cards/${id}/decide`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, ...extra }),
    })
    if (res.ok) { setCards(cs => cs.filter(c => c.id !== id)); setExpanded(null) }
    else { const body = await res.json().catch(() => ({})); alert(body.error || 'Could not save decision') }
  }

  if (loading || cards.length === 0) return null

  return (
    <div className="card p-4 space-y-2 border-2 border-brand/30">
      <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5" /> Pending your approval ({cards.length})
      </p>
      {cards.map(c => (
        <PendingCardRow key={c.id} c={c} expanded={expanded === c.id}
          onToggle={() => setExpanded(expanded === c.id ? null : c.id)} onDecide={decide} />
      ))}
    </div>
  )
}

function PendingCardRow({ c, expanded, onToggle, onDecide }: {
  c: PendingCard; expanded: boolean; onToggle: () => void
  onDecide: (id: string, decision: 'approved' | 'rejected', extra: { reason?: string; supervisorSignature?: string }) => Promise<void>
}) {
  const [signature, setSignature] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <div className="rounded-xl border border-surface-rule overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-surface-dim/40">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-text truncate">{c.product_name || c.item_no || 'Job card'}</div>
          <div className="text-[11px] text-text-muted font-mono truncate">{c.item_no} · batch {c.batch_number || '—'} · {c.customer || 'no customer'}</div>
        </div>
        <span className="text-[10px] text-text-faint shrink-0">{expanded ? 'Hide' : 'Review'}</span>
      </button>
      {expanded && (
        <div className="border-t border-surface-rule bg-surface-dim/20 p-3 space-y-3">
          {c.blend_ratio_lines?.length ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">Blend ratio (before granules) — {c.blend_description}</p>
              <RatioTable lines={c.blend_ratio_lines} />
            </div>
          ) : null}
          {c.final_ratio_lines?.length ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">Final product ratio</p>
              <RatioTable lines={c.final_ratio_lines} />
            </div>
          ) : null}

          <SignaturePad label="Supervisor signature" name="Supervisor signature" value={signature} onChange={setSignature} />
          <button disabled={!signature || busy}
            onClick={async () => { setBusy(true); await onDecide(c.id, 'approved', { supervisorSignature: signature! }); setBusy(false) }}
            className={clsx('w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-1.5',
              signature ? 'bg-brand text-white hover:opacity-90' : 'bg-surface-rule text-text-faint cursor-not-allowed')}>
            <ThumbsUp className="w-4 h-4" /> {signature ? 'Approve' : 'Sign to approve'}
          </button>

          <div className="flex gap-2 items-center pt-1 border-t border-surface-rule/60">
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for rejection…"
              className="input flex-1 text-[12px]" />
            <button disabled={!reason.trim() || busy}
              onClick={async () => { setBusy(true); await onDecide(c.id, 'rejected', { reason }); setBusy(false) }}
              className="px-3 py-2 rounded-lg text-[13px] font-semibold border border-err text-err hover:bg-err/10 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0">
              <ThumbsDown className="w-3.5 h-3.5" /> Reject
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PasteuriserJobCard() {
  const db = getDb()
  const { p, isFullAdmin } = useAuth()
  const canGenerate = isFullAdmin || p('can_generate_job_cards')
  const canApprove = isFullAdmin || p('can_approve_job_cards')

  const [form, setForm] = useState<Form>(empty())
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [bomLoading, setBomLoading] = useState(false)

  // Locked once sent for approval or approved — the manager's job is done;
  // a supervisor either approves it (via the panel above) or rejects it back
  // to draft-editable. Legacy submitted_at (pre-workflow cards) also locks.
  const locked = form.status === 'sent_for_approval' || form.status === 'approved' || !!form.submitted_at
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  // A fresh draft gets its number the moment the page opens — auto, atomic
  // (public.next_job_card_no(), a DB sequence), never hand-typed.
  useEffect(() => {
    if (savedId || form.job_card_no) return
    db.rpc('next_job_card_no' as any).then(({ data }: any) => {
      if (data) setForm(f => (f.job_card_no ? f : { ...f, job_card_no: data as string }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(patch?: Partial<Form>): Promise<string | null> {
    setSaving(true)
    const nextForm = { ...form, ...(patch ?? {}) }
    const payload = { ...nextForm, batch_number: upperCode(nextForm.batch_number) }
    let id = savedId
    if (id) { await db.from('job_cards_pasteuriser').update(payload).eq('id', id) }
    else {
      const { data } = await db.from('job_cards_pasteuriser').insert(payload).select('id').single()
      if (data) { id = (data as any).id; setSavedId(id) }
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
      .select('*').eq('item_no', item).eq('customer', cust).maybeSingle()
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

  function onCustomerBlur() {
    if (form.item_no.trim()) applySettingsTemplate(form.item_no, form.customer)
  }

  async function sendForApproval() {
    setSending(true)
    const id = await save()
    if (id) {
      const res = await fetch(`/api/production/job-cards/${id}/send-for-approval`, { method: 'POST' })
      if (res.ok) setForm(f => ({ ...f, status: 'sent_for_approval' }))
      else { const body = await res.json().catch(() => ({})); alert(body.error || 'Could not send for approval') }
    }
    setSending(false)
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-5 pb-24">
      <style>{`@media print { body * { visibility: hidden; } .jobcard-print, .jobcard-print * { visibility: visible; } .jobcard-print { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`}</style>

      <div className="card p-4 bg-brand text-white no-print">
        <p className="font-mono text-[10px] uppercase tracking-widest text-white/50 mb-1">PR-FM-013/1 · Cape Natural Tea Products</p>
        <h1 className="font-display font-extrabold text-2xl">Pasteuriser Line Job Card</h1>
      </div>

      {canApprove && <div className="no-print"><PendingApprovals /></div>}

      {canGenerate && !locked && (
        <div className="card p-4 space-y-2 border-2 border-brand/20 no-print">
          <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Generate from BOM</p>
          <BomPicker onPick={pickBom} disabled={bomLoading} />
          <p className="text-[11px] text-text-faint">Picks up the Acumatica code, blend ratio and final product ratio straight from the BOM catalogue — nothing here needs re-typing. Batch details, plant settings and special instructions below are still yours to fill in.</p>
        </div>
      )}

      <div className="no-print space-y-5">
      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Job details</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="Customer"><input className="input" value={form.customer} onChange={set('customer')} onBlur={onCustomerBlur} disabled={locked} /></F>
          <F label="Date of job card"><input type="date" className="input" value={form.date_of_card} onChange={set('date_of_card')} disabled={locked} /></F>
          <F label="Expected commencement"><input type="date" className="input" value={form.expected_commencement} onChange={set('expected_commencement')} disabled={locked} /></F>
          <F label="Job card no."><input className="input font-mono" value={form.job_card_no} onChange={set('job_card_no')} disabled={locked} /></F>
        </div>
        <F label="Item no."><input className="input font-mono" value={form.item_no} onChange={set('item_no')} disabled={locked || !!form.bom_output_item_id} /></F>
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
        {[
          { label: 'Production Coordinator', key: 'sig_production_coordinator' },
          { label: 'Production Supervisor',  key: 'sig_production_supervisor' },
          { label: 'Quality Officer / Controller', key: 'sig_quality_officer' },
          { label: 'Production Manager',     key: 'sig_production_manager' },
        ].map(s => (
          <SignaturePad key={s.key} label={s.label} name={s.label} value={(form as any)[s.key]}
            onChange={(val: string | null) => setForm(f => ({ ...f, [s.key]: val }))} disabled={locked} />
        ))}
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

        <div className="grid grid-cols-2 gap-x-8 gap-y-6 mt-6">
          {[
            { label: 'Production Coordinator', sig: form.sig_production_coordinator },
            { label: 'Production Supervisor', sig: form.sig_production_supervisor },
            { label: 'Quality Officer / Controller', sig: form.sig_quality_officer },
            { label: 'Production Manager', sig: form.sig_production_manager },
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
            <button onClick={sendForApproval} disabled={sending}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-base bg-brand text-white hover:opacity-90 disabled:opacity-60">
              <Send size={16} /> {sending ? 'Sending…' : form.status === 'rejected' ? 'Resend to Supervisor' : 'Send to Supervisor'}
            </button>
          )}
        </div>
      </div>
    </div>
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

  const kv = (rows: [string, string][]) => {
    doc.setFontSize(8)
    const colX = [margin, pageW / 2 + 10]
    const colEnd = [pageW / 2 - 10, pageW - margin]
    for (let i = 0; i < rows.length; i += 2) {
      for (let c = 0; c < 2; c++) {
        const item = rows[i + c]; if (!item) continue
        const x = colX[c]; const valX = x + 120
        doc.setFont('helvetica', 'bold'); doc.text(item[0], x, y)
        doc.setFont('helvetica', 'normal'); doc.text(String(item[1] || '—'), valX, y)
        doc.setDrawColor(180); doc.setLineWidth(0.5); doc.setLineDashPattern([1.5, 1.5], 0)
        doc.line(valX, y + 2, colEnd[c], y + 2); doc.setLineDashPattern([], 0)
      }
      y += 15
    }
    y += 8
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

  // Signatures — four slots, two per row (already base64 data URLs from
  // SignaturePad, so loadImage just needs to read their natural size).
  const sigs = [
    { title: 'Production Coordinator', signature: form.sig_production_coordinator },
    { title: 'Production Supervisor', signature: form.sig_production_supervisor },
    { title: 'Quality Officer / Controller', signature: form.sig_quality_officer },
    { title: 'Production Manager', signature: form.sig_production_manager },
  ]
  y += 16
  const sigW = 170
  const sigX = [margin + 10, pageW - margin - 10 - sigW]
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const s = sigs[row * 2 + col]; if (!s) continue
      const x = sigX[col]
      if (s.signature) {
        const img = await loadImage(s.signature)
        if (img) {
          const h = 28, w = Math.min(140, img.w * (h / img.h))
          try { doc.addImage(img.dataUrl, 'PNG', x, y - h - 2, w, h) } catch { /* ignore bad image */ }
        }
      }
      doc.setDrawColor(17); doc.setLineWidth(0.8); doc.line(x, y, x + sigW, y)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text(s.title, x, y + 12)
    }
    y += 50
  }

  doc.save(`JobCard_${upperCode(form.batch_number) || form.item_no || 'pasteuriser'}.pdf`)
}
