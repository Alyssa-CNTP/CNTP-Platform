'use client'

// app/(app)/notebooks/page.tsx
// The shelf of GRN / Delivery Note books. You pick a site first and a book
// second — the same two decisions you make walking up to the physical shelf —
// and what you get back is that book's pages, newest number first.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, BookOpen, Search, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import NotesTable, { type NoteRow } from '@/components/notebooks/NotesTable'
import {
  type DocType, type DocStatus, type NotebookLocation,
  DOC_TYPE_LABELS, STATUS_LABELS,
} from '@/lib/notebooks/types'

export default function NoteBooksPage() {
  const { p } = useAuth()
  const canCreate = p('can_create_notebook_doc')

  const [locations, setLocations] = useState<NotebookLocation[]>([])
  const [rows, setRows]     = useState<NoteRow[]>([])
  const [total, setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  // Filter 1 = where the note was written. Filter 2 = which book.
  const [location, setLocation] = useState<string>('')
  const [docType, setDocType]   = useState<DocType | ''>('')
  const [status, setStatus]     = useState<DocStatus | ''>('')
  const [search, setSearch]     = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    fetch('/api/notebooks/locations')
      .then(r => r.json())
      .then(d => setLocations(d.locations ?? []))
      .catch(() => setLocations([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams()
      if (location) qs.set('location', location)
      if (docType)  qs.set('docType', docType)
      if (status)   qs.set('status', status)
      if (debounced.trim()) qs.set('q', debounced.trim())
      qs.set('limit', '100')

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
  }, [location, docType, status, debounced])

  useEffect(() => { void load() }, [load])

  const newHref = useMemo(() => {
    const qs = new URLSearchParams()
    if (location) qs.set('location', location)
    if (docType)  qs.set('docType', docType)
    const s = qs.toString()
    return s ? `/notebooks/new?${s}` : '/notebooks/new'
  }, [location, docType])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-text">All Sites</h1>
          <p className="text-sm text-text-muted mt-1">
            Every GRN and Delivery Note, across every site — for looking something up when you don&apos;t
            know which book it&apos;s in. To write a note, use its site&apos;s own tab under Warehousing to the left.
          </p>
        </div>
        {canCreate && (
          <Link
            href={newHref}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-brand text-white text-sm hover:opacity-90 transition"
          >
            <Plus className="w-4 h-4" /> New note
          </Link>
        )}
      </div>

      {/* ── Filter 1 — site ── */}
      <FilterRow label="Site">
        <Pill active={location === ''} onClick={() => setLocation('')}>All sites</Pill>
        {locations.map(l => (
          <Pill key={l.code} active={location === l.code} onClick={() => setLocation(l.code)}>
            <span className="font-mono text-[10px] opacity-70 mr-1.5">{l.code}</span>{l.name}
          </Pill>
        ))}
      </FilterRow>

      {/* ── Filter 2 — book ── */}
      <FilterRow label="Book">
        <Pill active={docType === ''} onClick={() => setDocType('')}>Both books</Pill>
        {(['GRN', 'DN'] as DocType[]).map(t => (
          <Pill key={t} active={docType === t} onClick={() => setDocType(t)}>
            {DOC_TYPE_LABELS[t]}
            <span className="font-mono text-[10px] opacity-70 ml-1.5">{t}</span>
          </Pill>
        ))}
      </FilterRow>

      {/* ── Narrowing ── */}
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
          <Pill key={s || 'all'} active={status === s} onClick={() => setStatus(s)} small>
            {s === '' ? 'Any status' : STATUS_LABELS[s]}
          </Pill>
        ))}
      </div>

      {error && (
        <div className="mb-4 text-[12px] text-err bg-err-bg border border-err/20 rounded-lg px-3 py-2">{error}</div>
      )}

      <div className="rounded-xl border border-surface-rule bg-white overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-text-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-text-muted">
            <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <div className="text-sm">
              No notes in {location || docType ? 'this book yet' : 'any book yet'}.
              {canCreate && <> Click <strong>New note</strong> to write the first one.</>}
            </div>
          </div>
        ) : (
          <NotesTable rows={rows} />
        )}
      </div>

      {!loading && rows.length > 0 && (
        <p className="text-[11px] text-text-faint mt-2">
          Showing {rows.length} of {total} note{total === 1 ? '' : 's'}.
          {total > rows.length && ' Narrow the filters to see the rest.'}
        </p>
      )}
    </div>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-[10px] uppercase tracking-wider text-text-faint w-9 shrink-0">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

function Pill({ active, onClick, children, small }: {
  active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`${small ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-sm'} rounded-md transition border
        ${active
          ? 'bg-brand text-white border-brand'
          : 'bg-white text-text-muted border-surface-rule hover:text-text hover:border-text-faint'}`}
    >
      {children}
    </button>
  )
}
