'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Copy, Download, Save, Send, ThumbsDown } from 'lucide-react'
import {
  LabelPreview, SignOffChain, TemplateEditor,
  buildLabelDocument, fetchTemplate, fetchTemplateEvents, fetchKnownCustomers, saveDraft, toTemplate,
  type LabelTemplateRow, type TemplateEventRow,
  errMessage,
} from '@/features/pasteuriser-labels'
import { canRequestApproval, resolveLabel, type LabelTemplate, type SignOffRole } from '@/lib/core/labels'
import { SIGN_OFF_PERMISSION } from '@/lib/production/label-sign-offs'
import { useAuth } from '@/lib/auth/context'
import { customerOptions } from '@/lib/core/labels/library'
import { ActionDialog, type DialogField } from '@/features/pasteuriser-labels/components/ActionDialog'
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
/**
 * Field definitions live at module scope, not inline.
 *
 * ActionDialog resets its inputs whenever `fields` changes identity. A fresh
 * array literal on every render would clear what the user is typing on each
 * keystroke — the kind of bug that looks like a broken keyboard.
 */
const PROOF_FIELDS: DialogField[] = [
  { key: 'note', label: 'Who is this proof going to?',
    placeholder: 'Control Union, the customer, or both',
    hint: 'Recorded on the history so it is clear who was asked.' },
]

const REJECT_FIELDS: DialogField[] = [
  { key: 'note', label: 'What came back?', required: true, multiline: true,
    placeholder: 'What has to change before this can be approved' },
]

export default function LabelTemplatePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { p: perm, isFullAdmin } = useAuth()
  const can = (k: Parameters<typeof perm>[0]) => isFullAdmin || perm(k)

  const [row, setRow] = useState<LabelTemplateRow | null>(null)
  const [draft, setDraft] = useState<LabelTemplate | null>(null)
  /**
   * Customer is NOT part of the core LabelTemplate, deliberately. That type is
   * the label's CONTENT — the thing Control Union approves. Who the label
   * belongs to is ownership metadata about the record, and folding it into the
   * approved content would mean reassigning a customer looked like editing an
   * approved label.
   */
  const [customer, setCustomer] = useState<string | null>(null)
  const [customerOpts, setCustomerOpts] = useState<string[]>([])

  /**
   * The approval steps used to ask via window.prompt(), one value at a time.
   * `pending` holds which step is open; the dialog collects every value for
   * that step at once so a reference can be reviewed before it is committed.
   */
  const [pending, setPending] = useState<null | 'issue_proof' | 'reject'>(null)
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
      setCustomer(r.customer ?? null)
      setDirty(false)
      setEvents(await fetchTemplateEvents(id))
      setError(null)
    } catch (e) { setError(errMessage(e)) }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { void load() }, [load])

  /**
   * Customer options, loaded once. Includes the name already on this label even
   * if quality has no spec for it, so opening an assigned label never silently
   * drops its own customer out of the dropdown.
   */
  useEffect(() => {
    let alive = true
    void (async () => {
      const known = await fetchKnownCustomers()
      if (alive) setCustomerOpts(customerOptions(known, [row?.customer ?? null]))
    })()
    return () => { alive = false }
  }, [row?.customer])

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
        // Empty select -> null, never ''. A '' customer would sort into its own
        // group next to the real generic one and read as a second "unassigned".
        customer: customer?.trim() ? customer.trim() : null,
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
        <button onClick={() => router.push('/pasteuriser/labels')} className="text-sm text-brand">
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

          {/* Customer. Editable only while the label is a DRAFT, like every
              other field — reassigning an approved label would put one
              customer's product under an approval another customer gave. To
              move an approved design to a different customer, copy it. */}
          <div className="mt-2">
            {editable ? (
              <label className="flex items-center gap-2 text-xs text-text-muted">
                Customer
                <select
                  value={customer ?? ''}
                  onChange={e => { setCustomer(e.target.value || null); setDirty(true) }}
                  className="border border-stone-200 rounded-lg px-2 py-1 text-xs text-text bg-white"
                >
                  {/* Generic is a real, common answer (LOCAL, plain EXPORT) and
                      not an empty state, so it is worded as a choice. */}
                  <option value="">Any customer (generic)</option>
                  {customerOpts.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            ) : (
              <p className="text-xs text-text-muted">
                Customer: <span className="text-text font-medium">
                  {row.customer?.trim() || 'Any customer (generic)'}
                </span>
              </p>
            )}
          </div>
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
                setPending('issue_proof')
              }}
              disabled={busy || !compliant}
              title={compliant ? undefined : 'Fix the compliance problems first'}
              primary icon={<Send size={15} />} label="Send for approval" />
          )}

          {/* There is no "Mark approved" button, and its absence is the point.
              A template approves itself when the fourth signature lands, in the
              sign-off panel below; the transition route refuses `approve` with
              a 410 for the same reason. One person pressing one button could
              approve artwork Quality never saw, which is the hole the chain
              closes — so it cannot stay open beside it. */}
          {row.status === 'pending_approval' && can('can_approve_labels') && (
            <Btn onClick={() => setPending('reject')} disabled={busy}
              icon={<ThumbsDown size={15} />} label="Reject" />
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

      {/* The approval questions, in-app. Rendered only while a step is open
          and KEYED by that step, so switching steps mounts a fresh dialog
          rather than syncing state in an effect (which is a cascading render,
          and what the hooks lint objects to). */}
      {pending === 'issue_proof' && (
        <ActionDialog
          key="issue_proof" open
          title="Send this proof for approval"
          message="The wording is frozen from here. Changing it later starts a new version rather than editing this one."
          confirmLabel="Send for approval"
          busy={busy}
          fields={PROOF_FIELDS}
          onCancel={() => setPending(null)}
          onConfirm={v => { setPending(null); void transition('issue_proof', { note: v.note || undefined }) }}
        />
      )}

      {pending === 'reject' && (
        <ActionDialog
          key="reject" open
          title="Reject this label"
          message="The reason is shown on the label and carried into the next version, so write what has to change."
          confirmLabel="Reject"
          busy={busy}
          fields={REJECT_FIELDS}
          onCancel={() => setPending(null)}
          onConfirm={v => { setPending(null); void transition('reject', { note: v.note }) }}
        />
      )}

      {/* The approval chain. Shown from the moment a proof goes out, and still
          shown once approved — a template approved before the chain existed
          carries only the old single approval, and Quality, the customer and
          the certifier have to be recordable against it without re-issuing the
          proof. The route allows exactly that (SIGNABLE includes 'approved').

          Its own boundary: a crash reading the register must not take down the
          designer or the PO panel underneath it. */}
      {(row.status === 'pending_approval' || row.status === 'approved') && (
        <FeatureBoundary name="Approval chain">
          <div className="card p-4">
            <SignOffChain
              scope="template"
              templateId={row.id}
              templateVersion={row.version}
              canSign={(role: SignOffRole) => can(SIGN_OFF_PERMISSION[role])}
              onSigned={load}
            />
          </div>
        </FeatureBoundary>
      )}

      {row.status === 'approved' && (
        <FeatureBoundary name="PO assignment">
          <ApprovedPanel row={row} template={draft} canAssign={can('can_assign_label_po')}
            customerOpts={customerOpts} onDone={load} />
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
        primary ? 'bg-brand text-white hover:bg-brand-mid transition-colors' : 'border border-surface-rule text-text-muted hover:text-text'
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
function ApprovedPanel({ row, template, canAssign, customerOpts, onDone }: {
  row: LabelTemplateRow
  template: LabelTemplate
  canAssign: boolean
  customerOpts: string[]
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /**
   * Customer defaults to the LABEL'S customer. A PO is being raised against
   * this specific approved label, so anything else is almost certainly a
   * mistake — and typing it free-hand was how a PO ended up under a spelling
   * that matched no customer at all.
   */
  const [f, setF] = useState({
    customer: row.customer ?? '', poNumber: '', product: '', itemNumber: '',
    netMass: '', grossMass: '', importer: '', orderedBags: '',
    plannedBatchNo: '', plannedDate: '', notes: '',
  })

  const input = 'w-full px-2.5 py-1.5 rounded-lg border border-surface-rule bg-surface text-sm text-text'

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
      setF({ customer: row.customer ?? '', poNumber: '', product: '', itemNumber: '', netMass: '', grossMass: '',
             importer: '', orderedBags: '', plannedBatchNo: '', plannedDate: '', notes: '' })
      onDone()
    } catch (e) { setErr(errMessage(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="card p-4 border-l-4 border-l-emerald-500 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex gap-4 items-start">
          <div className="rounded-lg bg-white p-1.5 border border-surface-rule hidden sm:block">
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
            className="px-3 py-2 rounded-lg bg-brand text-white hover:bg-brand-mid transition-colors text-sm font-medium">
            Assign a PO
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-2.5 pt-1">
          {err && <p className="text-xs text-red-700">{err}</p>}
          <div className="grid sm:grid-cols-2 gap-2">
            <Field label="Customer *">
              {customerOpts.length > 0 ? (
                <select className={input} value={f.customer}
                  onChange={e => setF({ ...f, customer: e.target.value })}>
                  <option value="">Select a customer…</option>
                  {customerOpts.map(c => <option key={c} value={c}>{c}</option>)}
                  {/* A label assigned to a customer that is no longer offered
                      must still be selectable, or reassigning it silently
                      blanks the field. */}
                  {f.customer && !customerOpts.includes(f.customer) && (
                    <option value={f.customer}>{f.customer}</option>
                  )}
                </select>
              ) : (
                <>
                  <input className={input} value={f.customer}
                    onChange={e => setF({ ...f, customer: e.target.value })} />
                  <p className="text-[10px] text-text-faint mt-1">
                    No customers found — add one in the sales customer list, or type the name.
                  </p>
                </>
              )}
            </Field>
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
              className="px-3 py-2 rounded-lg bg-brand text-white hover:bg-brand-mid transition-colors text-sm font-medium disabled:opacity-50">
              Assign PO
            </button>
            <button onClick={() => setOpen(false)}
              className="px-3 py-2 rounded-lg border border-surface-rule text-sm text-text-muted">Cancel</button>
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

/**
 * The approval trail.
 *
 * Under FSSC an approval is documented information, so it has to say WHO, WHEN
 * and carry their signature — not just "approved at 09:41". The name and
 * signature are snapshots taken when the event was written (20260907_003), not
 * a live join, so a rename or an offboarding cannot rewrite an approval after
 * the fact.
 */
const EVENT_STYLE: Record<string, { label: string; dot: string }> = {
  created:      { label: 'Created',            dot: 'bg-stone-300' },
  proof_issued: { label: 'Sent for approval',  dot: 'bg-amber-400' },
  approved:     { label: 'Approved',           dot: 'bg-emerald-500' },
  rejected:     { label: 'Rejected',           dot: 'bg-red-500' },
  superseded:   { label: 'Superseded',         dot: 'bg-stone-400' },
  reopened:     { label: 'Reopened as draft',  dot: 'bg-sky-400' },
}

function HistoryPanel({ events }: { events: TemplateEventRow[] }) {
  if (events.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide font-semibold text-text-faint">
        Approval history
      </p>
      <div className="card divide-y divide-surface-rule">
        {events.map(e => {
          const style = EVENT_STYLE[e.event] ?? { label: e.event.replace(/_/g, ' '), dot: 'bg-stone-300' }
          const when = new Date(e.created_at)
          return (
            <div key={e.id} className="px-4 py-3 flex gap-3">
              {/* A coloured dot rather than a coloured row: the history is
                  scanned for "when was it approved", and one mark per row
                  reads faster than five tinted bands. */}
              <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-text">{style.label}</span>
                  <span className="text-[11px] text-text-muted">
                    {e.actor_name
                      ? <>by <span className="text-text font-medium">{e.actor_name}</span></>
                      : <span className="text-text-faint">actor not recorded</span>}
                  </span>
                </div>

                <p className="text-[11px] font-mono text-text-faint mt-0.5">
                  {when.toLocaleString('en-ZA', {
                    timeZone: 'Africa/Johannesburg',
                    dateStyle: 'medium', timeStyle: 'short',
                  })} SAST
                </p>

                {e.note && <p className="text-[12px] text-text-muted mt-1">{e.note}</p>}
                {e.external_ref && (
                  <p className="text-[11px] mt-0.5">
                    <span className="text-text-faint">Ref </span>
                    <span className="font-mono text-text">{e.external_ref}</span>
                  </p>
                )}
              </div>

              {/* The signature. Absent is a real and legitimate state — the
                  person has not set one up — and it says so rather than
                  leaving a gap that reads like a missing record. */}
              <div className="flex-shrink-0 w-28 text-right">
                {e.actor_signature ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={e.actor_signature}
                    alt={`Signature of ${e.actor_name ?? 'the approver'}`}
                    className="h-10 ml-auto object-contain"
                  />
                ) : (
                  <span className="text-[10px] text-text-faint">
                    {e.actor_name ? 'no signature on file' : ''}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[10px] text-text-faint">
        Names and signatures are recorded as they were at the time of each event.
      </p>
    </div>
  )
}

