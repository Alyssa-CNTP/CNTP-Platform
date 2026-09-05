'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Copy, Download, Save, Send, ThumbsDown, ThumbsUp } from 'lucide-react'
import {
  LabelPreview, TemplateEditor,
  buildLabelDocument, fetchTemplate, fetchTemplateEvents, saveDraft, toTemplate,
  type LabelTemplateRow, type TemplateEventRow,
  errMessage,
} from '@/features/pasteuriser-labels'
import { canRequestApproval, resolveLabel, type LabelTemplate } from '@/lib/core/labels'
import { useAuth } from '@/lib/auth/context'
import FeatureBoundary from '@/components/shared/FeatureBoundary'
import { StatusPill } from '../page'

/**
 * One label template version: design it, send the proof, record the approval,
 * assign a PO.
 *
 * All four live on one page because they are one artefact's lifecycle and the
 * person doing each step needs to see the label itself. What is NOT here is any
 * decision about whether a step is allowed — every transition goes to
 * /api/pasteuriser/labels/[id]/transition, which re-reads the row and decides
 * server-side. The buttons below reflect state; they do not enforce it
 * (ARCHITECTURE.md §6).
 */
export default function LabelTemplatePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { p: perm, isFullAdmin } = useAuth()
  const can = (k: Parameters<typeof perm>[0]) => isFullAdmin || perm(k)

  const [row, setRow] = useState<LabelTemplateRow | null>(null)
  const [draft, setDraft] = useState<LabelTemplate | null>(null)
  const [events, setEvents] = useState<TemplateEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetchTemplate(id)
      if (!r) { setError('Label not found'); return }
      setRow(r)
      setDraft(toTemplate(r))
      setDirty(false)
      setEvents(await fetchTemplateEvents(id))
      setError(null)
    } catch (e) { setError(errMessage(e)) }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { void load() }, [load])

  const editable = !!row && row.status === 'draft' && can('can_design_labels')
  const compliant = useMemo(() => (draft ? canRequestApproval(draft) : false), [draft])

  async function save() {
    if (!draft || !row) return
    setBusy(true)
    try {
      await saveDraft(row.id, {
        name: draft.name, market: draft.market, organic: draft.organic,
        size: draft.size, lines: [...draft.lines], certifications: [...draft.certifications],
        mark_position: draft.markPosition, proof_note: draft.proofNote ?? null,
      })
      setDirty(false)
      await load()
    } catch (e) { setError(errMessage(e)) }
    finally { setBusy(false) }
  }

  async function transition(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true)
    try {
      const res = await fetch(`/api/pasteuriser/labels/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const json = await res.json()
      if (!res.ok) {
        // The route reports compliance failures as a list, so the designer sees
        // every problem at once rather than fixing one and resubmitting.
        const issues = (json.issues ?? []) as { message: string }[]
        const detail = issues.length
          ? `${json.error}\n\n${issues.map(i => `• ${i.message}`).join('\n')}`
          : json.error
        throw new Error(detail ?? 'Could not complete that')
      }
      await load()
    } catch (e) { setError(errMessage(e)) }
    finally { setBusy(false) }
  }

  async function newVersion() {
    setBusy(true)
    try {
      const res = await fetch(`/api/pasteuriser/labels/${id}/version`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not create a new version')
      router.push(`/pasteuriser/labels/${json.template.id}`)
    } catch (e) { setError(errMessage(e)) }
    finally { setBusy(false) }
  }

  /**
   * The approval pack. Opens the proof in a print window so it can be saved as
   * PDF and emailed — the same document the label renders from, watermarked and
   * with the version stamped on it, so what the certifier signs is traceable to
   * a row here.
   */
  function downloadProof() {
    if (!draft) return
    const html = buildLabelDocument(resolveLabel(draft), {
      mode: 'proof',
      issuedAt: new Date().toLocaleDateString('en-ZA'),
    })
    const win = window.open('', '_blank', 'width=760,height=800')
    if (!win) { alert('Allow pop-ups to open the proof'); return }
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 700)
  }

  if (loading) return <div className="p-6 text-sm text-text-muted">Loading…</div>
  if (!row || !draft) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-text-muted">{error ?? 'Label not found'}</p>
        <button onClick={() => router.push('/pasteuriser/labels')} className="text-sm text-primary">
          Back to labels
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5">
      <button onClick={() => router.push('/pasteuriser/labels')}
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text">
        <ArrowLeft size={15} /> Labels
      </button>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display font-bold text-2xl text-text">{row.name}</h1>
            <StatusPill status={row.status} />
          </div>
          <p className="font-mono text-[11px] text-text-muted mt-0.5">
            {row.code} · version {row.version} · {row.market.toUpperCase()}
            {row.organic && ' · ORGANIC'}
          </p>
          {row.rejected_reason && (
            <p className="text-xs text-red-700 mt-1 max-w-lg">
              Rejected: {row.rejected_reason}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Btn onClick={downloadProof} icon={<Download size={15} />} label="Proof (PDF)" />

          {editable && (
            <Btn onClick={save} disabled={busy || !dirty} primary={dirty}
              icon={<Save size={15} />} label={dirty ? 'Save changes' : 'Saved'} />
          )}

          {row.status === 'draft' && can('can_design_labels') && (
            <Btn
              onClick={() => {
                if (dirty) { setError('Save your changes before sending the proof for approval.'); return }
                void transition('issue_proof', {
                  note: window.prompt('Who is this proof going to? (Control Union, the customer, both)') ?? undefined,
                })
              }}
              disabled={busy || !compliant}
              title={compliant ? undefined : 'Fix the compliance problems first'}
              primary icon={<Send size={15} />} label="Send for approval" />
          )}

          {row.status === 'pending_approval' && can('can_approve_labels') && (
            <>
              <Btn onClick={() => void transition('approve', {
                externalRef: window.prompt('Control Union reference (letter/email ref, optional)') ?? undefined,
                customerRef: window.prompt('Customer approval reference (optional)') ?? undefined,
              })} disabled={busy} primary icon={<ThumbsUp size={15} />} label="Mark approved" />
              <Btn onClick={() => {
                const note = window.prompt('What came back? (required)')
                if (note?.trim()) void transition('reject', { note })
              }} disabled={busy} icon={<ThumbsDown size={15} />} label="Reject" />
            </>
          )}

          {row.status === 'rejected' && can('can_design_labels') && (
            <Btn onClick={() => void transition('reopen')} disabled={busy} label="Reopen as draft" />
          )}

          {(row.status === 'approved' || row.status === 'superseded') && can('can_design_labels') && (
            <Btn onClick={newVersion} disabled={busy} icon={<Copy size={15} />} label="New version" />
          )}
        </div>
      </div>

      {error && (
        <div className="card p-3 border-l-4 border-l-red-500 text-sm text-text-muted whitespace-pre-line">
          {error}
        </div>
      )}

      {row.status === 'approved' && (
        <FeatureBoundary name="PO assignment">
          <ApprovedPanel row={row} template={draft} canAssign={can('can_assign_label_po')} onDone={load} />
        </FeatureBoundary>
      )}

      {/* A crash in the editor must not take the page down on top of it — the
          approval buttons and the history above stay usable, which is what lets
          someone still approve a label whose editor is misbehaving. */}
      <FeatureBoundary name="Label designer">
        <TemplateEditor
          template={draft}
          editable={editable}
          onChange={t => { setDraft(t); setDirty(true) }}
        />
      </FeatureBoundary>

      <HistoryPanel events={events} />
    </div>
  )
}

function Btn({ onClick, label, icon, disabled, primary, title }: {
  onClick: () => void
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  primary?: boolean
  title?: string
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
        primary ? 'bg-primary text-white' : 'border border-border text-text-muted hover:text-text'
      }`}>
      {icon} {label}
    </button>
  )
}

/**
 * Assigning a customer PO — the handover from sales to production.
 *
 * Only shown on an approved template, because a PO attached to unapproved
 * wording is a promise nobody can keep. The route re-checks that too.
 */
function ApprovedPanel({ row, template, canAssign, onDone }: {
  row: LabelTemplateRow
  template: LabelTemplate
  canAssign: boolean
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({
    customer: '', poNumber: '', product: '', itemNumber: '',
    netMass: '', grossMass: '', importer: '', orderedBags: '',
    plannedBatchNo: '', plannedDate: '', notes: '',
  })

  const input = 'w-full px-2.5 py-1.5 rounded-lg border border-border bg-surface text-sm text-text'

  async function submit() {
    setBusy(true)
    try {
      const res = await fetch('/api/pasteuriser/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: row.id, ...f }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not assign the PO')
      setOpen(false)
      setF({ customer: '', poNumber: '', product: '', itemNumber: '', netMass: '', grossMass: '',
             importer: '', orderedBags: '', plannedBatchNo: '', plannedDate: '', notes: '' })
      onDone()
    } catch (e) { setErr(errMessage(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="card p-4 border-l-4 border-l-emerald-500 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex gap-4 items-start">
          <div className="rounded-lg bg-white p-1.5 border border-border hidden sm:block">
            <LabelPreview template={template} scale={0.34} />
          </div>
          <div>
            <p className="font-display font-bold text-[15px] text-text">Approved and ready to sell</p>
            <p className="text-xs text-text-muted mt-0.5 max-w-md">
              {row.approved_at && `Approved ${new Date(row.approved_at).toLocaleDateString('en-ZA')}. `}
              {row.cu_approval_ref && `Control Union ref ${row.cu_approval_ref}. `}
              Assign a customer PO and the production manager can put it on a job card.
            </p>
          </div>
        </div>
        {canAssign && !open && (
          <button onClick={() => setOpen(true)}
            className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium">
            Assign a PO
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-2.5 pt-1">
          {err && <p className="text-xs text-red-700">{err}</p>}
          <div className="grid sm:grid-cols-2 gap-2">
            <Field label="Customer *"><input className={input} value={f.customer}
              onChange={e => setF({ ...f, customer: e.target.value })} /></Field>
            <Field label="Customer PO number *"><input className={input} value={f.poNumber}
              placeholder="KTR 4417" onChange={e => setF({ ...f, poNumber: e.target.value })} /></Field>
            <Field label="Product as printed"><input className={input} value={f.product}
              placeholder="Organic Rooibos" onChange={e => setF({ ...f, product: e.target.value })} /></Field>
            <Field label="Acumatica item"><input className={input} value={f.itemNumber}
              onChange={e => setF({ ...f, itemNumber: e.target.value })} /></Field>
            <Field label="Net mass"><input className={input} value={f.netMass}
              placeholder="18 kg" onChange={e => setF({ ...f, netMass: e.target.value })} /></Field>
            <Field label="Gross mass"><input className={input} value={f.grossMass}
              placeholder="18.3 kg" onChange={e => setF({ ...f, grossMass: e.target.value })} /></Field>
            <Field label="Importer"><input className={input} value={f.importer}
              onChange={e => setF({ ...f, importer: e.target.value })} /></Field>
            <Field label="Bags ordered"><input className={input} type="number" value={f.orderedBags}
              onChange={e => setF({ ...f, orderedBags: e.target.value })} /></Field>
          </div>

          <div className="pt-1">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-text-faint mb-1.5">
              Supply chain — optional
            </p>
            <p className="text-[11px] text-text-muted mb-2 max-w-lg leading-relaxed">
              The analyst fills these in when the plan is known. The production manager can assign
              a job card without them — the line does not wait on this.
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="Planned batch number"><input className={input} value={f.plannedBatchNo}
                onChange={e => setF({ ...f, plannedBatchNo: e.target.value })} /></Field>
              <Field label="Planned production date"><input className={input} type="date" value={f.plannedDate}
                onChange={e => setF({ ...f, plannedDate: e.target.value })} /></Field>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={submit} disabled={busy || !f.customer.trim() || !f.poNumber.trim()}
              className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50">
              Assign PO
            </button>
            <button onClick={() => setOpen(false)}
              className="px-3 py-2 rounded-lg border border-border text-sm text-text-muted">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wide font-semibold text-text-faint mb-0.5">{label}</span>
      {children}
    </label>
  )
}

function HistoryPanel({ events }: { events: TemplateEventRow[] }) {
  if (events.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide font-semibold text-text-faint">History</p>
      <div className="card divide-y divide-border">
        {events.map(e => (
          <div key={e.id} className="px-3 py-2 flex items-baseline gap-3">
            <span className="text-xs font-medium text-text capitalize w-32 flex-shrink-0">
              {e.event.replace(/_/g, ' ')}
            </span>
            <span className="text-[11px] text-text-muted flex-1 min-w-0">
              {e.note}
              {e.external_ref && <span className="font-mono"> · {e.external_ref}</span>}
            </span>
            <span className="text-[10px] font-mono text-text-faint flex-shrink-0">
              {new Date(e.created_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
