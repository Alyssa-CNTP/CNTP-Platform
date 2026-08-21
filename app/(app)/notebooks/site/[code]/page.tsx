'use client'

// app/(app)/notebooks/site/[code]/page.tsx
// One site's shelf — its GRN book and its DN book as two tabs, under the
// Warehousing group in the sidebar. This is where a note actually gets
// written: "which site" is already decided by which tab you clicked to get
// here, so writing one is just "which book" (GRN or DN) and then the form.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import * as Tabs from '@radix-ui/react-tabs'
import { ArrowLeft, Plus, BookOpen, Search, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import NotesTable, { type NoteRow } from '@/components/notebooks/NotesTable'
import {
  type DocType, type DocStatus, type NotebookLocation,
  DOC_TYPES, DOC_TYPE_LABELS, STATUS_LABELS,
} from '@/lib/notebooks/types'

export default function SiteNotebooksPage() {
  const { code: rawCode } = useParams<{ code: string }>()
  const code = rawCode.toUpperCase()
  const { p } = useAuth()
  const canCreate = p('can_create_notebook_doc')

  const [locations, setLocations] = useState<NotebookLocation[] | null>(null)
  const [docType, setDocType] = useState<DocType>('GRN')
  const [status, setStatus]   = useState<DocStatus | ''>('')
  const [search, setSearch]   = useState('')
  const [debounced, setDebounced] = useState('')

  const [rows, setRows]       = useState<NoteRow[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/notebooks/locations')
      .then(r => r.json())
      .then(d => setLocations(d.locations ?? []))
      .catch(() => setLocations([]))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ location: code, docType, limit: '100' })
      if (status) qs.set('status', status)
      if (debounced.trim()) qs.set('q', debounced.trim())

      const res = await fetch(`/api/notebooks/documents?${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not load the book')
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load the book')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [code, docType, status, debounced])

  useEffect(() => { void load() }, [load])

  const site = locations?.find(l => l.code === code)

  if (locations && !site) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link href="/notebooks" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text mb-3">
          <ArrowLeft className="w-3.5 h-3.5" /> Note Books
        </Link>
        <p className="text-sm text-text-muted">There is no site with the code &ldquo;{code}&rdquo;.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Link href="/notebooks" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> All Sites
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-text">{site?.name ?? code}</h1>
          <p className="text-sm text-text-muted mt-1">
            Numbered <span className="font-mono">{code}-{docType}-…</span> — this site&apos;s own {DOC_TYPE_LABELS[docType].toLowerCase()} book.
          </p>
        </div>
        {canCreate && (
          <Link
            href={`/notebooks/new?location=${code}&docType=${docType}`}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-brand text-white text-sm hover:opacity-90 transition"
          >
            <Plus className="w-4 h-4" /> New {docType === 'GRN' ? 'GRN' : 'Delivery Note'}
          </Link>
        )}
      </div>

      <Tabs.Root value={docType} onValueChange={v => setDocType(v as DocType)}>
        <Tabs.List className="flex gap-1.5 mb-4" aria-label="Book">
          {DOC_TYPES.map(t => (
            <Tabs.Trigger
              key={t}
              value={t}
              className="px-3.5 py-1.5 rounded-md text-sm font-medium transition border
                text-text-muted border-surface-rule bg-white hover:text-text hover:border-text-faint
                data-[state=active]:bg-brand data-[state=active]:text-white data-[state=active]:border-brand"
            >
              {DOC_TYPE_LABELS[t]} <span className="font-mono text-[10px] opacity-70 ml-1">{t}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Note no., supplier, PO or weighbridge no."
              className="pl-8 pr-3 py-1.5 w-[300px] rounded-md border border-surface-rule bg-white text-sm text-text placeholder:text-text-faint outline-none focus:border-brand"
            />
          </div>
          {(['', 'draft', 'issued', 'void'] as const).map(s => (
            <button
              key={s || 'all'}
              onClick={() => setStatus(s)}
              className={`px-2.5 py-1 rounded-md text-[12px] transition border
                ${status === s ? 'bg-brand text-white border-brand' : 'bg-white text-text-muted border-surface-rule hover:text-text'}`}
            >
              {s === '' ? 'Any status' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 text-[12px] text-err bg-err-bg border border-err/20 rounded-lg px-3 py-2">{error}</div>
        )}

        {DOC_TYPES.map(t => (
          <Tabs.Content key={t} value={t} className="focus:outline-none">
            <div className="rounded-xl border border-surface-rule bg-white overflow-hidden">
              {loading ? (
                <div className="p-12 text-center text-text-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
              ) : rows.length === 0 ? (
                <div className="p-12 text-center text-text-muted">
                  <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <div className="text-sm">
                    No notes in this book yet.
                    {canCreate && <> Click <strong>New {t === 'GRN' ? 'GRN' : 'Delivery Note'}</strong> to write the first one.</>}
                  </div>
                </div>
              ) : (
                <NotesTable rows={rows} showBookColumn={false} />
              )}
            </div>
          </Tabs.Content>
        ))}
      </Tabs.Root>

      {!loading && rows.length > 0 && (
        <p className="text-[11px] text-text-faint mt-2">
          Showing {rows.length} of {total} note{total === 1 ? '' : 's'}.
          {total > rows.length && ' Narrow the filters to see the rest.'}
        </p>
      )}
    </div>
  )
}
