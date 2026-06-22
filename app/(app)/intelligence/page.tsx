'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Search, RefreshCw, Radio, AlertCircle, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import SignalCard from '@/components/intelligence/SignalCard'
import SignalDrawer from '@/components/intelligence/SignalDrawer'
import type { Signal, Classification } from '@/components/intelligence/types'
import { timeAgo } from '@/components/intelligence/helpers'

// react-simple-maps needs the DOM — load client-side only.
const SignalMap = dynamic(() => import('@/components/intelligence/SignalMap'), {
  ssr: false,
  loading: () => (
    <div
      className="rounded-xl border border-surface-rule animate-pulse-soft"
      style={{ background: '#0D1F0D', height: 420 }}
    />
  ),
})

type RelevanceBucket = 'all' | 'high' | 'medium' | 'low'
type SortMode       = 'newest' | 'score' | 'oldest'

const CLASSIFICATIONS: Array<Classification | 'all'> = [
  'all', 'opportunity', 'threat', 'competitor', 'regulation', 'relationship', 'neutral',
]

const PAGE_SIZE = 50

export default function IntelligenceHubPage() {
  const [signals,      setSignals]      = useState<Signal[]>([])
  const [totalCount,   setTotalCount]   = useState<number | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [lastUpdated,  setLastUpdated]  = useState<Date | null>(null)
  const [selected,     setSelected]     = useState<Signal | null>(null)

  // Filters
  const [search,       setSearch]       = useState('')
  const [classFilter,  setClassFilter]  = useState<Classification | 'all'>('all')
  const [regionFilter, setRegionFilter] = useState<string>('all')
  const [groupFilter,  setGroupFilter]  = useState<string>('all')
  const [relevance,    setRelevance]    = useState<RelevanceBucket>('all')
  const [sort,         setSort]         = useState<SortMode>('newest')
  const [visible,      setVisible]      = useState(PAGE_SIZE)

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const loadSignals = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [signalsRes, countRes] = await Promise.all([
        fetch('/api/signals?limit=300'),
        fetch('/api/signals?count=true'),
      ])
      if (!signalsRes.ok) throw new Error(`Signals fetch failed (${signalsRes.status})`)
      const { signals: data } = await signalsRes.json()
      setSignals(data ?? [])
      if (countRes.ok) {
        const { count } = await countRes.json()
        setTotalCount(count ?? 0)
      }
      setLastUpdated(new Date())
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load signals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadSignals() }, [loadSignals])

  // ── Derived: unique regions / groups ────────────────────────────────────────
  const regions = useMemo(() => {
    const set = new Set<string>()
    signals.forEach(s => { if (s.region) set.add(s.region) })
    return Array.from(set).sort()
  }, [signals])

  const groups = useMemo(() => {
    const set = new Set<string>()
    signals.forEach(s => { if (s.keyword_group) set.add(s.keyword_group) })
    return Array.from(set).sort()
  }, [signals])

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const opps    = signals.filter(s => s.classification === 'opportunity').length
    const threats = signals.filter(s => s.classification === 'threat').length
    const avg     = signals.length
      ? signals.reduce((a, s) => a + (s.relevance_score ?? 0), 0) / signals.length
      : 0
    return { opps, threats, avg: Math.round(avg * 10) / 10 }
  }, [signals])

  // ── Filtered + sorted ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = signals.filter(s => {
      if (classFilter !== 'all' && s.classification !== classFilter) return false
      if (regionFilter !== 'all' && s.region !== regionFilter)        return false
      if (groupFilter  !== 'all' && s.keyword_group !== groupFilter)  return false
      if (relevance === 'high'   && s.relevance_score < 7)            return false
      if (relevance === 'medium' && (s.relevance_score < 4 || s.relevance_score > 6)) return false
      if (relevance === 'low'    && s.relevance_score > 3)            return false
      if (q && !s.title.toLowerCase().includes(q))                    return false
      return true
    })

    list = [...list].sort((a, b) => {
      if (sort === 'score')  return (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
      if (sort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    return list
  }, [signals, search, classFilter, regionFilter, groupFilter, relevance, sort])

  // Reset windowing when filters change
  useEffect(() => { setVisible(PAGE_SIZE) }, [search, classFilter, regionFilter, groupFilter, relevance, sort])

  const visibleSignals = filtered.slice(0, visible)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="px-4 md:px-6 py-6 max-w-[1280px] mx-auto">
      {/* Header row */}
      <header className="flex flex-wrap items-center gap-2 mb-5">
        <h1 className="font-display font-bold text-[24px] text-text">Signal Engine</h1>
        <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border border-surface-rule bg-surface text-text-muted">
          {totalCount !== null ? totalCount.toLocaleString() : '—'} total
        </span>
        <span
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border"
          style={{
            background: 'var(--color-ok-bg)',
            color:      'var(--color-ok)',
            borderColor:'rgba(21,128,61,0.22)',
          }}
        >
          <Radio size={10} className="animate-pulse-soft" />
          Live · 6am daily
        </span>
        {lastUpdated && (
          <span className="font-mono text-[10px] text-text-faint">
            Updated {timeAgo(lastUpdated.toISOString())}
          </span>
        )}
        <button
          onClick={loadSignals}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-text-muted hover:text-text disabled:opacity-50 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total signals" value={signals.length.toLocaleString()} />
        <StatCard label="Opportunities" value={stats.opps.toLocaleString()} accent="var(--color-ok)" />
        <StatCard label="Threats"       value={stats.threats.toLocaleString()} accent="var(--color-err)" />
        <StatCard label="Avg relevance" value={stats.avg.toFixed(1)} suffix="/10" />
      </div>

      {/* World map — region filter is two-way bound with the dropdown below */}
      <div className="mb-5">
        <SignalMap
          signals={signals}
          selectedRegion={regionFilter === 'all' ? null : regionFilter}
          onRegionSelect={code => setRegionFilter(code ?? 'all')}
        />
      </div>

      {/* Filter bar */}
      <div className="bg-surface-card border border-surface-rule rounded-xl shadow-card p-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search titles…"
              className="w-full pl-8 pr-3 py-2 text-[13px] bg-surface border border-surface-rule rounded-lg outline-none focus:border-accent text-text placeholder:text-text-faint"
            />
          </div>

          {/* Region */}
          <select
            value={regionFilter}
            onChange={e => setRegionFilter(e.target.value)}
            className="px-3 py-2 text-[12px] bg-surface border border-surface-rule rounded-lg outline-none focus:border-accent text-text font-mono"
          >
            <option value="all">All regions</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>

          {/* Group */}
          <select
            value={groupFilter}
            onChange={e => setGroupFilter(e.target.value)}
            className="px-3 py-2 text-[12px] bg-surface border border-surface-rule rounded-lg outline-none focus:border-accent text-text font-mono"
          >
            <option value="all">All groups</option>
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>

          {/* Sort */}
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortMode)}
            className="px-3 py-2 text-[12px] bg-surface border border-surface-rule rounded-lg outline-none focus:border-accent text-text font-mono"
          >
            <option value="newest">Newest</option>
            <option value="score">Highest score</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>

        {/* Classification pills */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {CLASSIFICATIONS.map(c => (
            <PillButton
              key={c}
              active={classFilter === c}
              onClick={() => setClassFilter(c)}
            >
              {c}
            </PillButton>
          ))}
        </div>

        {/* Relevance pills */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {(['all','high','medium','low'] as RelevanceBucket[]).map(r => (
            <PillButton
              key={r}
              active={relevance === r}
              onClick={() => setRelevance(r)}
            >
              {r === 'all'    ? 'All scores' :
               r === 'high'   ? 'High (7-10)' :
               r === 'medium' ? 'Medium (4-6)' : 'Low (1-3)'}
            </PillButton>
          ))}
        </div>
      </div>

      {/* Result count */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="font-mono text-[11px] text-text-muted">
          {filtered.length} {filtered.length === 1 ? 'signal' : 'signals'}
        </span>
        {filtered.length > visible && (
          <span className="font-mono text-[11px] text-text-faint">
            Showing {visible} of {filtered.length}
          </span>
        )}
      </div>

      {/* Feed */}
      {loading && signals.length === 0 ? (
        <SkeletonFeed />
      ) : error ? (
        <ErrorState message={error} onRetry={loadSignals} />
      ) : filtered.length === 0 ? (
        <EmptyState
          search={search}
          classFilter={classFilter}
          regionFilter={regionFilter}
          groupFilter={groupFilter}
          relevance={relevance}
          onReset={() => {
            setSearch('')
            setClassFilter('all')
            setRegionFilter('all')
            setGroupFilter('all')
            setRelevance('all')
          }}
        />
      ) : (
        <>
          <div className="grid gap-2.5">
            {visibleSignals.map(s => (
              <SignalCard key={s.id} signal={s} onClick={setSelected} />
            ))}
          </div>
          {filtered.length > visible && (
            <button
              onClick={() => setVisible(v => v + PAGE_SIZE)}
              className="mt-4 w-full py-3 rounded-xl border border-surface-rule bg-surface-card hover:bg-surface text-[13px] font-medium text-text-muted hover:text-text transition-colors"
            >
              Load {Math.min(PAGE_SIZE, filtered.length - visible)} more
            </button>
          )}
        </>
      )}

      {/* Drawer */}
      <SignalDrawer signal={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, suffix, accent,
}: {
  label:   string
  value:   string
  suffix?: string
  accent?: string
}) {
  return (
    <div className="bg-surface-card rounded-xl border border-surface-rule shadow-card p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
        {label}
      </div>
      <div className="font-display font-bold text-[24px] text-text leading-none" style={accent ? { color: accent } : undefined}>
        {value}
        {suffix && <span className="font-mono text-[12px] text-text-faint ml-1">{suffix}</span>}
      </div>
    </div>
  )
}

function PillButton({
  active, onClick, children,
}: {
  active:   boolean
  onClick:  () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-2.5 py-1 rounded-md font-mono text-[11px] uppercase tracking-wider border transition-colors',
        active
          ? 'bg-brand text-white border-brand'
          : 'bg-surface text-text-muted border-surface-rule hover:text-text hover:border-text-faint/40'
      )}
    >
      {children}
    </button>
  )
}

function SkeletonFeed() {
  return (
    <div className="grid gap-2.5">
      {[1,2,3,4,5,6].map(i => (
        <div key={i} className="bg-surface-card rounded-xl border border-surface-rule p-4 animate-pulse-soft">
          <div className="flex gap-1.5 mb-3">
            <div className="h-4 w-20 bg-surface rounded-md" />
            <div className="h-4 w-12 bg-surface rounded-md" />
          </div>
          <div className="h-4 w-3/4 bg-surface rounded-md mb-2" />
          <div className="h-3 w-full bg-surface rounded-md" />
        </div>
      ))}
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bg-surface-card rounded-xl border border-surface-rule p-8 text-center">
      <AlertCircle size={28} className="mx-auto mb-3" style={{ color: 'var(--color-err)' }} />
      <h3 className="font-display font-semibold text-[15px] text-text mb-1">Couldn&apos;t load signals</h3>
      <p className="text-[12px] text-text-muted mb-4">{message}</p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-white text-[13px] font-medium hover:bg-brand-hover transition-colors"
      >
        <RefreshCw size={13} />
        Retry
      </button>
    </div>
  )
}

function EmptyState({
  search, classFilter, regionFilter, groupFilter, relevance, onReset,
}: {
  search:       string
  classFilter:  Classification | 'all'
  regionFilter: string
  groupFilter:  string
  relevance:    RelevanceBucket
  onReset:      () => void
}) {
  const parts: string[] = []
  if (search)                      parts.push(`matching "${search}"`)
  if (classFilter !== 'all')       parts.push(`classified as ${classFilter}`)
  if (regionFilter !== 'all')      parts.push(`from ${regionFilter}`)
  if (groupFilter !== 'all')       parts.push(`in ${groupFilter}`)
  if (relevance   !== 'all')       parts.push(`with ${relevance} relevance`)

  return (
    <div className="bg-surface-card rounded-xl border border-surface-rule p-8 text-center">
      <Sparkles size={28} className="mx-auto mb-3 text-text-faint" />
      <h3 className="font-display font-semibold text-[15px] text-text mb-1">No signals found</h3>
      <p className="text-[12px] text-text-muted max-w-[420px] mx-auto">
        {parts.length
          ? <>No signals {parts.join(', ')}.</>
          : <>The feed is currently empty.</>}
      </p>
      {parts.length > 0 && (
        <button
          onClick={onReset}
          className="mt-4 px-3 py-1.5 rounded-md text-[12px] font-medium bg-surface border border-surface-rule text-text-muted hover:text-text transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
