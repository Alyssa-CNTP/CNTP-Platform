'use client'
// components/search/CommandSearch.tsx
// Global Cmd+K / Ctrl+K batch search — queries across qms, production, sales.
// Drop this once into the app layout; the Sidebar search button fires the same event.

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Beaker, Factory, Package, TrendingUp,
  X, Loader2, ChevronRight,
} from 'lucide-react'

interface QualityRecord {
  id: string; lot_number: string; product_type: string
  grade: string; created_at: string; section_id: string
}
interface ProdSession {
  id: string; lot_number: string; date: string
  shift: string; section_name: string; status: string; supervisor_name: string
}
interface BagTag {
  serial_number: string; lot_number: string; product_type: string
  weight_kg: number; status: string; destination: string; created_at: string
}
interface Signal {
  id: string; title: string; summary_en: string
  classification: string; relevance_score: number; source_type: string; created_at: string
}
interface SearchResults {
  quality: QualityRecord[]
  production: ProdSession[]
  bags: BagTag[]
  sales: Signal[]
}

const EMPTY: SearchResults = { quality: [], production: [], bags: [], sales: [] }

const STATUS_COLOR: Record<string, string> = {
  draft:       'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-100 text-amber-700',
  complete:    'bg-green-100 text-green-700',
  on_floor:    'bg-blue-100 text-blue-700',
  dispatched:  'bg-teal-100 text-teal-700',
  consumed:    'bg-stone-100 text-stone-500',
}

function Badge({ label }: { label: string }) {
  const cls = STATUS_COLOR[label?.toLowerCase()] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cls}`}>
      {label}
    </span>
  )
}

function SectionHeader({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100">
      <span className="text-gray-400">{icon}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</span>
      <span className="ml-auto text-[10px] text-gray-400">{count} result{count !== 1 ? 's' : ''}</span>
    </div>
  )
}

export default function CommandSearch() {
  const [open,    setOpen]    = useState(false)
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<SearchResults>(EMPTY)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router   = useRouter()

  // Open on Cmd+K / Ctrl+K, or custom event from sidebar button
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    const onEvent = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-search', onEvent)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-command-search', onEvent)
    }
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
    else { setQuery(''); setResults(EMPTY) }
  }, [open])

  // Debounced search
  const doSearch = useCallback((q: string) => {
    if (q.length < 2) { setResults(EMPTY); return }
    setLoading(true)
    fetch(`/api/search/batch?q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(data => { setResults(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(query), 300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [query, doSearch])

  const total = results.quality.length + results.production.length + results.bags.length + results.sales.length

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div
        className="w-full max-w-xl mx-4 rounded-xl overflow-hidden shadow-2xl"
        style={{ background: '#fff', border: '1px solid #e5e7eb' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          {loading
            ? <Loader2 size={16} className="text-gray-400 animate-spin shrink-0" />
            : <Search size={16} className="text-gray-400 shrink-0" />
          }
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by lot number, batch, product..."
            className="flex-1 text-sm outline-none placeholder:text-gray-400"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-300 hover:text-gray-500">
              <X size={14} />
            </button>
          )}
          <kbd className="text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5 font-mono">esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {query.length >= 2 && !loading && total === 0 && (
            <div className="py-10 text-center text-sm text-gray-400">
              No results for <span className="font-mono text-gray-600">"{query}"</span>
            </div>
          )}

          {/* Quality */}
          {results.quality.length > 0 && (
            <div>
              <SectionHeader icon={<Beaker size={12} />} label="Quality Records" count={results.quality.length} />
              {results.quality.map(r => (
                <button
                  key={r.id}
                  onClick={() => { router.push('/quality/sieving'); setOpen(false) }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 font-mono">{r.lot_number}</span>
                      {r.grade && <Badge label={r.grade} />}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {r.product_type} · {r.section_id} · {new Date(r.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-gray-300 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {/* Production Sessions */}
          {results.production.length > 0 && (
            <div>
              <SectionHeader icon={<Factory size={12} />} label="Production Sessions" count={results.production.length} />
              {results.production.map(s => (
                <button
                  key={s.id}
                  onClick={() => { router.push('/production/live'); setOpen(false) }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 font-mono">{s.lot_number || s.id}</span>
                      {s.status && <Badge label={s.status} />}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {s.section_name} · {s.shift} shift · {s.date}
                      {s.supervisor_name ? ` · ${s.supervisor_name}` : ''}
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-gray-300 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {/* Bag Tags */}
          {results.bags.length > 0 && (
            <div>
              <SectionHeader icon={<Package size={12} />} label="Bag Tags" count={results.bags.length} />
              {results.bags.map(b => (
                <button
                  key={b.serial_number}
                  onClick={() => { router.push('/tags'); setOpen(false) }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 font-mono">{b.serial_number}</span>
                      {b.status && <Badge label={b.status} />}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {b.lot_number} · {b.product_type}{b.weight_kg ? ` · ${b.weight_kg}kg` : ''}
                      {b.destination ? ` → ${b.destination}` : ''}
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-gray-300 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {/* Sales Signals */}
          {results.sales.length > 0 && (
            <div>
              <SectionHeader icon={<TrendingUp size={12} />} label="Sales Signals" count={results.sales.length} />
              {results.sales.map(s => (
                <button
                  key={s.id}
                  onClick={() => { router.push('/sales'); setOpen(false) }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-800 truncate">{s.title}</span>
                      {s.classification && <Badge label={s.classification} />}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 line-clamp-1">
                      {s.source_type} · {new Date(s.created_at).toLocaleDateString()}
                      {s.relevance_score ? ` · score ${s.relevance_score}` : ''}
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-gray-300 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {/* Empty state hint */}
          {!query && (
            <div className="py-8 px-4 text-center">
              <p className="text-sm text-gray-400">Type a lot number, batch ID, or product name</p>
              <p className="text-xs text-gray-300 mt-1">
                e.g. <span className="font-mono">GS-2026-001</span> or <span className="font-mono">RSFG/RA-02726</span>
              </p>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 bg-gray-50">
          <span className="text-[10px] text-gray-400">
            <kbd className="font-mono border border-gray-200 rounded px-1">esc</kbd> close
          </span>
          <span className="text-[10px] text-gray-400 ml-auto">
            Searches Quality · Production · Sales
          </span>
        </div>
      </div>
    </div>
  )
}
