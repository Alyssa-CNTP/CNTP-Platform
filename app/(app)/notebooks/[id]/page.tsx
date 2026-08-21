'use client'

// app/(app)/notebooks/[id]/page.tsx
// One page of a book. While it is a draft you can still change what is written
// on it; once issued it is the record — printable, signable, and correctable
// only by voiding it and writing a new one.
//
// The note itself is rendered by NotePaper, which is also exactly what prints:
// the app chrome and every control on this page is .no-print, so Ctrl-P gives
// the document and nothing else (see the @media print block in globals.css).

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, Printer, Pencil, Check, X, Ban, Send, Link2, CheckCircle2,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import NotePaper, { type SignatureOnPaper } from '@/components/notebooks/NotePaper'
import NoteFields from '@/components/notebooks/NoteFields'
import StatusBadge from '@/components/notebooks/StatusBadge'
import SignatureCapture, { type SignatureAudit } from '@/components/esign/SignatureCapture'
import {
  headerFromDoc, linesFromDoc, toHeaderPayload, toLinesPayload, validateNote,
  type NoteHeaderDraft, type LineDraft,
} from '@/components/notebooks/note-draft'
import {
  type NotebookDocWithLines, type SignBlock,
  ESIGN_SUBJECT, SIGN_BLOCKS, SIGN_BLOCK_LABELS, SIGN_BLOCK_DECLARATION,
  DOC_TYPE_LABELS, esignSubjectId,
} from '@/lib/notebooks/types'

interface BlockSigning {
  signedAudit?:     SignatureAudit
  pendingExternal?: { requestId: string; signerName: string | null }
}

export default function NotePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { p } = useAuth()

  const canEdit = p('can_create_notebook_doc')
  const canSign = p('can_sign_notebook_doc')
  const canSendLink = p('can_request_external_signature')
  const canVoid = p('can_void_notebook_doc')

  const [doc, setDoc] = useState<NotebookDocWithLines | null>(null)
  const [signing, setSigning] = useState<Record<SignBlock, BlockSigning>>({ received: {}, transporter: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [busy, setBusy]       = useState(false)

  const [editing, setEditing] = useState(false)
  const [header, setHeader]   = useState<NoteHeaderDraft | null>(null)
  const [lines, setLines]     = useState<LineDraft[]>([])
  // Absent until the first save attempt inside this editing session — reset
  // whenever editing (re)starts, so a previous attempt's red state doesn't
  // carry into a later edit.
  const [submitted, setSubmitted] = useState(false)

  const validation = header ? validateNote(header, lines, doc?.doc_type ?? 'GRN') : null

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/notebooks/documents/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not load the note')
      setDoc(data.document)
      setSigning(foldSigning(data.signing))
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load the note')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  function startEditing() {
    if (!doc) return
    setHeader(headerFromDoc(doc))
    setLines(linesFromDoc(doc.lines))
    setEditing(true)
    setSubmitted(false)
  }

  async function saveDraft() {
    if (!header) return
    setSubmitted(true)
    if (!validation?.isValid) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/notebooks/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ header: toHeaderPayload(header), lines: toLinesPayload(lines) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not save')
      setEditing(false)
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  async function issue() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/notebooks/documents/${id}/issue`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not issue the note')
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Could not issue the note')
    } finally {
      setBusy(false)
    }
  }

  async function voidNote() {
    const reason = prompt('Why is this note being voided? The number stays used either way.')
    if (!reason?.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/notebooks/documents/${id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not void the note')
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Could not void the note')
    } finally {
      setBusy(false)
    }
  }

  // ─── Signing ───────────────────────────────────────────────────────────────

  function blockTitle(block: SignBlock) {
    if (!doc) return ''
    return `${DOC_TYPE_LABELS[doc.doc_type]} ${doc.doc_no} — ${SIGN_BLOCK_LABELS[doc.doc_type][block]}`
  }

  async function signInApp(block: SignBlock): Promise<{ ok: boolean; error?: string }> {
    if (!doc) return { ok: false, error: 'Note not loaded' }
    const createRes = await fetch('/api/esign/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subjectType: ESIGN_SUBJECT,
        subjectId:   esignSubjectId(doc.id, block),
        title:       blockTitle(block),
        signerKind:  'internal',
      }),
    })
    const created = await createRes.json().catch(() => ({}))
    if (!createRes.ok) return { ok: false, error: created.error }

    const signRes = await fetch('/api/esign/staff-sign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: created.id }),
    })
    const signed = await signRes.json().catch(() => ({}))
    if (!signRes.ok) return { ok: false, error: signed.error }

    await load()
    return { ok: true }
  }

  async function sendForSignature(block: SignBlock) {
    if (!doc) return
    setError(null)
    const name = prompt(`Who is signing the "${SIGN_BLOCK_LABELS[doc.doc_type][block]}" block? (driver / recipient name)`)
    if (!name?.trim()) return
    const contact = prompt('Email or phone (optional — for your own reference)') ?? ''

    setBusy(true)
    try {
      const res = await fetch('/api/esign/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectType:   ESIGN_SUBJECT,
          subjectId:     esignSubjectId(doc.id, block),
          title:         blockTitle(block),
          signerKind:    'external',
          signerName:    name.trim(),
          signerContact: contact.trim() || null,
        }),
      })
      const created = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(created.error ?? 'Could not create a signing link')

      const fullUrl = `${window.location.origin}${created.signUrl}`
      try { await navigator.clipboard.writeText(fullUrl) } catch { /* clipboard may be blocked */ }
      alert(`Signing link created and copied to your clipboard — send it to ${name.trim()}:\n\n${fullUrl}\n\nIt expires in 72 hours and can only sign this one block.`)
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Could not create a signing link')
    } finally {
      setBusy(false)
    }
  }

  async function cancelRequest(requestId: string) {
    if (!confirm('Cancel this pending signing request?')) return
    setBusy(true)
    await fetch(`/api/esign/requests/${requestId}/void`, { method: 'POST' })
    await load()
    setBusy(false)
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="p-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-text-muted" /></div>
  }

  if (!doc) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-err mb-2">{error ?? 'Note not found.'}</p>
        <Link href="/notebooks" className="text-sm text-brand hover:underline">Back to the books</Link>
      </div>
    )
  }

  const isDraft = doc.status === 'draft'
  const paperSignatures: Partial<Record<SignBlock, SignatureOnPaper | null>> = {
    received: signing.received.signedAudit
      ? { signerName: signing.received.signedAudit.signerName, signedAt: signing.received.signedAudit.signedAt, image: signing.received.signedAudit.signatureImage ?? null }
      : null,
    transporter: signing.transporter.signedAudit
      ? { signerName: signing.transporter.signedAudit.signerName, signedAt: signing.transporter.signedAudit.signedAt, image: signing.transporter.signedAudit.signatureImage ?? null }
      : null,
  }

  return (
    <div className="p-6 max-w-5xl mx-auto print-full-width">
      {/* ── Toolbar ── */}
      <div className="no-print">
        <Link href="/notebooks" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text mb-3">
          <ArrowLeft className="w-3.5 h-3.5" /> Note Books
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-text font-mono">{doc.doc_no}</h1>
            <StatusBadge status={doc.status} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isDraft && canEdit && !editing && (
              <button onClick={startEditing} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-surface-rule bg-white text-[13px] text-text hover:bg-surface transition disabled:opacity-50">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            {isDraft && canEdit && editing && (
              <>
                <button onClick={saveDraft} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white text-[13px] hover:opacity-90 transition disabled:opacity-50">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
                </button>
                <button onClick={() => { setEditing(false); setSubmitted(false) }} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-surface-rule bg-white text-[13px] text-text-muted hover:text-text transition">
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </>
            )}
            {isDraft && canEdit && !editing && (
              <button onClick={issue} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white text-[13px] hover:opacity-90 transition disabled:opacity-50">
                <CheckCircle2 className="w-3.5 h-3.5" /> Issue note
              </button>
            )}
            {!editing && (
              <button onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-surface-rule bg-white text-[13px] text-text hover:bg-surface transition">
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
            )}
            {doc.status !== 'void' && canVoid && !editing && (
              <button onClick={voidNote} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-err/30 bg-white text-[13px] text-err hover:bg-err-bg transition disabled:opacity-50">
                <Ban className="w-3.5 h-3.5" /> Void
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 text-[12px] text-err bg-err-bg border border-err/20 rounded-lg px-3 py-2">{error}</div>
        )}

        {isDraft && !editing && (
          <p className="mb-4 text-[12px] text-warn bg-warn-bg border border-warn/20 rounded-lg px-3 py-2">
            This note is still a draft. Issue it once the goods and weights are confirmed — after that it can only be
            corrected by voiding it and writing a new one, and {doc.doc_no} stays used either way.
          </p>
        )}
      </div>

      {/* ── Editing the draft ── */}
      {editing && header ? (
        <div className="no-print">
          <NoteFields
            docType={doc.doc_type}
            header={header}
            lines={lines}
            onHeader={patch => setHeader(h => (h ? { ...h, ...patch } : h))}
            onLines={setLines}
            disabled={busy}
            headerErrors={submitted ? validation?.headerErrors : undefined}
            lineErrors={submitted ? validation?.lineErrors : undefined}
            tabErrorCount={submitted ? validation?.tabErrorCount : undefined}
          />
          {submitted && validation && !validation.isValid && (
            <div className="mt-4 text-[12px] text-err bg-err-bg border border-err/20 rounded-lg px-3 py-2">
              <p className="font-medium mb-1">
                This note can&apos;t be saved yet — {validation.summary.length} field{validation.summary.length === 1 ? '' : 's'} still need{validation.summary.length === 1 ? 's' : ''} filling in
                (type N/A where something genuinely doesn&apos;t apply):
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                {validation.summary.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ── The note ── */}
          <NotePaper doc={doc} signatures={paperSignatures} />

          {/* ── Signing ── */}
          {doc.status === 'issued' && (
            <div className="no-print grid gap-3 sm:grid-cols-2 mt-5">
              {SIGN_BLOCKS.map(block => (
                <SignPanel
                  key={block}
                  label={SIGN_BLOCK_LABELS[doc.doc_type][block]}
                  declaration={SIGN_BLOCK_DECLARATION[doc.doc_type][block]}
                  state={signing[block]}
                  canSign={canSign}
                  canSendLink={canSendLink}
                  busy={busy}
                  onSignInApp={() => signInApp(block)}
                  onSendLink={() => sendForSignature(block)}
                  onCancelRequest={cancelRequest}
                />
              ))}
            </div>
          )}

          {doc.status === 'draft' && (
            <p className="no-print text-[12px] text-text-muted mt-4">
              Signatures open up once the note is issued — there is no point signing for goods whose weights can still change.
            </p>
          )}

          {doc.status === 'void' && (
            <div className="no-print mt-5 rounded-xl border border-surface-rule bg-white p-4">
              <h2 className="text-[13px] font-semibold text-text mb-1">Voided</h2>
              <p className="text-[12px] text-text-muted">
                {doc.void_reason || 'No reason recorded.'} — {doc.doc_no} remains used and will never be issued again.
              </p>
              <button
                onClick={() => router.push(`/notebooks/new?location=${doc.location_code}&docType=${doc.doc_type}`)}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white text-[13px] hover:opacity-90 transition"
              >
                Write a replacement note
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── One acknowledgement block's signing state ───────────────────────────────

function SignPanel({ label, declaration, state, canSign, canSendLink, busy, onSignInApp, onSendLink, onCancelRequest }: {
  label: string
  declaration: string
  state: BlockSigning
  canSign: boolean
  canSendLink: boolean
  busy: boolean
  onSignInApp: () => Promise<{ ok: boolean; error?: string }>
  onSendLink: () => void
  onCancelRequest: (requestId: string) => void
}) {
  return (
    <div className="rounded-xl border border-surface-rule bg-white p-4">
      <h2 className="text-[13px] font-semibold text-text">{label}</h2>
      <p className="text-[11px] text-text-muted mt-0.5 mb-3">{declaration}</p>

      {state.signedAudit ? (
        <SignatureCapture mode="internal" documentLabel={label} audit={state.signedAudit} />
      ) : state.pendingExternal ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[12px] text-warn">
            <Link2 size={13} />
            <span>Link sent to {state.pendingExternal.signerName ?? 'recipient'} — awaiting signature</span>
          </div>
          {canSendLink && (
            <button
              onClick={() => onCancelRequest(state.pendingExternal!.requestId)}
              disabled={busy}
              className="text-[11px] text-text-muted hover:text-err underline disabled:opacity-50"
            >
              Cancel this request
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {canSign && <SignatureCapture mode="internal" documentLabel={label} onSignInternal={onSignInApp} />}
          {canSendLink && (
            <button
              onClick={onSendLink}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-[12px] text-brand font-medium hover:underline disabled:opacity-50"
            >
              <Send size={12} /> Send to the recipient to sign
            </button>
          )}
          {!canSign && !canSendLink && (
            <p className="text-[11px] text-text-faint">You do not have permission to sign or send this note.</p>
          )}
        </div>
      )}
    </div>
  )
}

// The API hands back esign's raw request history per block; the page only cares
// about the latest one and whether it is signed, pending or neither.
function foldSigning(raw: Record<string, any[]> | undefined): Record<SignBlock, BlockSigning> {
  const out: Record<SignBlock, BlockSigning> = { received: {}, transporter: {} }
  for (const block of SIGN_BLOCKS) {
    const latest = raw?.[block]?.[0]
    if (!latest) continue
    if (latest.status === 'signed' && latest.signature) {
      out[block] = {
        signedAudit: {
          signerName:     latest.signature.signer_name,
          signedAt:       latest.signature.signed_at,
          signatureImage: latest.signature.signature_image,
          ipAddress:      latest.signature.ip_address,
          userAgent:      latest.signature.user_agent,
        },
      }
    } else if (latest.status === 'pending' && latest.signer_kind === 'external') {
      out[block] = { pendingExternal: { requestId: latest.id, signerName: latest.signer_name } }
    }
  }
  return out
}
