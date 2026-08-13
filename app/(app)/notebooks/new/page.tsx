'use client'

// app/(app)/notebooks/new/page.tsx
// Open a fresh page in a book. Site first, book second — then fill it in.
//
// The number is NOT shown before saving, because it does not exist yet: it is
// taken at the moment the note is written, so two people opening this form at
// the same time can never be looking at the same number.

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Loader2, BookOpen } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import NoteFields, { emptyLine } from '@/components/notebooks/NoteFields'
import {
  emptyHeader, toHeaderPayload, toLinesPayload,
  type NoteHeaderDraft, type LineDraft,
} from '@/components/notebooks/note-draft'
import {
  type DocType, type NotebookLocation, DOC_TYPE_LABELS, DOC_TYPES,
} from '@/lib/notebooks/types'

export default function NewNotePage() {
  return (
    <Suspense fallback={<div className="p-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-text-muted" /></div>}>
      <NewNoteForm />
    </Suspense>
  )
}

function NewNoteForm() {
  const router = useRouter()
  const params = useSearchParams()
  const { p } = useAuth()
  const canCreate = p('can_create_notebook_doc')

  const [locations, setLocations] = useState<NotebookLocation[]>([])
  // Prefilled from the list page's filters, so "I'm standing at Graafwater
  // Depot writing GRNs" survives the jump into this form.
  const [locationCode, setLocationCode] = useState(params.get('location') ?? '')
  const [docType, setDocType] = useState<DocType>(
    DOC_TYPES.includes(params.get('docType') as DocType) ? (params.get('docType') as DocType) : 'GRN'
  )

  const [header, setHeader] = useState<NoteHeaderDraft>(emptyHeader())
  const [lines, setLines]   = useState<LineDraft[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/notebooks/locations')
      .then(r => r.json())
      .then(d => setLocations(d.locations ?? []))
      .catch(() => setLocations([]))
  }, [])

  async function save() {
    if (!locationCode) { setError('Pick the site this note is being written at.'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/notebooks/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationCode,
          docType,
          header: toHeaderPayload(header),
          lines:  toLinesPayload(lines),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not write the note')
      router.push(`/notebooks/${data.document.id}`)
    } catch (e: any) {
      setError(e?.message ?? 'Could not write the note')
      setSaving(false)
    }
  }

  if (!canCreate) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-text-muted">You do not have permission to write notes.</p>
        <Link href="/notebooks" className="text-sm text-brand hover:underline">Back to the books</Link>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/notebooks" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Note Books
      </Link>

      <h1 className="text-2xl font-semibold text-text mb-1">New note</h1>
      <p className="text-sm text-text-muted mb-5">
        The next number in the chosen book is taken when you save, and stays with this note for good.
      </p>

      {/* ── Which book ── */}
      <section className="rounded-xl border border-surface-rule bg-white p-4 mb-5">
        <h2 className="text-[13px] font-semibold text-text mb-3 flex items-center gap-1.5">
          <BookOpen className="w-4 h-4 text-text-muted" /> Which book
        </h2>

        <div className="mb-3">
          <span className="block text-[11px] uppercase tracking-wider text-text-muted mb-1.5">Site</span>
          <div className="flex flex-wrap gap-1.5">
            {locations.map(l => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLocationCode(l.code)}
                className={`px-3 py-1.5 rounded-md text-sm border transition
                  ${locationCode === l.code
                    ? 'bg-brand text-white border-brand'
                    : 'bg-white text-text-muted border-surface-rule hover:text-text hover:border-text-faint'}`}
              >
                <span className="font-mono text-[10px] opacity-70 mr-1.5">{l.code}</span>{l.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="block text-[11px] uppercase tracking-wider text-text-muted mb-1.5">Book</span>
          <div className="flex flex-wrap gap-1.5">
            {DOC_TYPES.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setDocType(t)}
                className={`px-3 py-1.5 rounded-md text-sm border transition
                  ${docType === t
                    ? 'bg-brand text-white border-brand'
                    : 'bg-white text-text-muted border-surface-rule hover:text-text hover:border-text-faint'}`}
              >
                {DOC_TYPE_LABELS[t]}
                <span className="font-mono text-[10px] opacity-70 ml-1.5">{t}</span>
              </button>
            ))}
          </div>
        </div>

        {locationCode && (
          <p className="text-[11px] text-text-faint mt-3">
            This note will be numbered <span className="font-mono text-text-muted">{locationCode}-{docType}-…</span> —
            the next free number in {locations.find(l => l.code === locationCode)?.name ?? 'that site'}&apos;s {docType} book.
          </p>
        )}
      </section>

      <NoteFields
        docType={docType}
        header={header}
        lines={lines}
        onHeader={patch => setHeader(h => ({ ...h, ...patch }))}
        onLines={setLines}
        disabled={saving}
      />

      {error && (
        <div className="mt-4 text-[12px] text-err bg-err-bg border border-err/20 rounded-lg px-3 py-2">{error}</div>
      )}

      <div className="flex items-center gap-2 mt-5">
        <button
          onClick={save}
          disabled={saving || !locationCode}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? 'Taking the next number…' : 'Write the note'}
        </button>
        <Link href="/notebooks" className="px-4 py-2 rounded-lg border border-surface-rule bg-white text-sm text-text-muted hover:text-text transition">
          Cancel
        </Link>
      </div>
    </div>
  )
}
