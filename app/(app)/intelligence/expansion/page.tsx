'use client'

import { useState, useEffect, useMemo } from 'react'
import { Compass, Sparkles, ShieldAlert, AlertCircle } from 'lucide-react'
import SignalCard from '@/components/intelligence/SignalCard'
import SignalDrawer from '@/components/intelligence/SignalDrawer'
import type { Signal } from '@/components/intelligence/types'
import { regionFlag } from '@/components/intelligence/helpers'

const EXPANSION_GROUPS = new Set(['wellness', 'creative', 'trade'])

export default function IntelligenceExpansionPage() {
  const [signals,  setSignals]  = useState<Signal[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [selected, setSelected] = useState<Signal | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/signals?limit=300')
      .then(r => {
        if (!r.ok) throw new Error(`Fetch failed (${r.status})`)
        return r.json()
      })
      .then(({ signals }) => {
        if (cancelled) return
        const filtered = (signals as Signal[] ?? []).filter(
          s => s.keyword_group && EXPANSION_GROUPS.has(s.keyword_group)
        )
        setSignals(filtered)
      })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // ── Region grouping ────────────────────────────────────────────────────────
  const byRegion = useMemo(() => {
    const map = new Map<string, Signal[]>()
    signals.forEach(s => {
      if (!s.region) return
      const list = map.get(s.region) ?? []
      list.push(s)
      map.set(s.region, list)
    })
    return Array.from(map.entries())
      .map(([region, list]) => ({
        region,
        signals: list.sort((a, b) => b.relevance_score - a.relevance_score),
        topScore: Math.max(...list.map(s => s.relevance_score)),
      }))
      .sort((a, b) => b.signals.length - a.signals.length)
  }, [signals])

  const newOpportunities = useMemo(() =>
    signals
      .filter(s => s.classification === 'opportunity' && s.relevance_score >= 7)
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, 12),
    [signals])

  const regulatory = useMemo(() =>
    signals
      .filter(s => s.classification === 'regulation')
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, 10),
    [signals])

  return (
    <div className="px-4 md:px-6 py-6 max-w-[1280px] mx-auto">
      <header className="flex flex-wrap items-baseline gap-3 mb-5">
        <Compass size={20} className="text-accent self-center" />
        <h1 className="font-display font-bold text-[22px] text-text">Expansion Intelligence</h1>
        <p className="text-[12px] text-text-muted">
          New-market signals, regional opportunities, and regulatory watch across wellness, creative, and trade.
        </p>
      </header>

      {error && (
        <div className="bg-surface-card rounded-xl border border-surface-rule p-6 text-center mb-5">
          <AlertCircle size={20} className="mx-auto mb-2" style={{ color: 'var(--color-err)' }} />
          <p className="text-[12px] text-text-muted">{error}</p>
        </div>
      )}

      {/* New Market Opportunities */}
      <section className="mb-6">
        <SectionHeader
          icon={<Sparkles size={14} />}
          title="New market opportunities"
          subtitle="High-relevance opportunity signals (score 7+)"
          count={newOpportunities.length}
          accent="var(--color-ok)"
        />
        {loading ? (
          <SkeletonGrid />
        ) : newOpportunities.length === 0 ? (
          <EmptyBlock label="No high-relevance opportunity signals yet" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {newOpportunities.map(s => (
              <SignalCard key={s.id} signal={s} onClick={setSelected} />
            ))}
          </div>
        )}
      </section>

      {/* World regions layout */}
      <section className="mb-6">
        <SectionHeader
          icon={<Compass size={14} />}
          title="Signals by region"
          subtitle="Top 3 signals per region, sorted by relevance"
          count={byRegion.length}
          accent="var(--color-accent)"
        />
        {loading ? (
          <SkeletonGrid />
        ) : byRegion.length === 0 ? (
          <EmptyBlock label="No regional signals available" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {byRegion.map(({ region, signals: list }) => (
              <div key={region} className="bg-surface-card rounded-xl border border-surface-rule shadow-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[20px] leading-none">{regionFlag(region)}</span>
                    <h3 className="font-display font-semibold text-[14px] text-text">{region}</h3>
                  </div>
                  <span className="font-mono text-[10px] text-text-muted bg-surface border border-surface-rule px-2 py-0.5 rounded-md">
                    {list.length} signals
                  </span>
                </div>
                <div className="grid gap-2">
                  {list.slice(0, 3).map(s => (
                    <SignalCard key={s.id} signal={s} compact onClick={setSelected} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Regulatory watch */}
      <section className="mb-6">
        <SectionHeader
          icon={<ShieldAlert size={14} />}
          title="Regulatory watch"
          subtitle="Regulation signals that may affect expansion plans"
          count={regulatory.length}
          accent="var(--color-info)"
        />
        {loading ? (
          <SkeletonGrid />
        ) : regulatory.length === 0 ? (
          <EmptyBlock label="No regulatory signals" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {regulatory.map(s => (
              <SignalCard key={s.id} signal={s} onClick={setSelected} />
            ))}
          </div>
        )}
      </section>

      <SignalDrawer signal={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function SectionHeader({
  icon, title, subtitle, count, accent,
}: {
  icon:     React.ReactNode
  title:    string
  subtitle: string
  count:    number
  accent:   string
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <span style={{ color: accent }}>{icon}</span>
        <div>
          <h2 className="font-display font-semibold text-[14px] text-text leading-tight">{title}</h2>
          <p className="text-[11px] text-text-muted leading-tight">{subtitle}</p>
        </div>
      </div>
      <span
        className="font-mono text-[10px] font-medium px-2 py-0.5 rounded-md border"
        style={{ background: 'var(--color-surface)', color: accent, borderColor: 'var(--color-surface-rule)' }}
      >
        {count}
      </span>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {[1,2,3,4].map(i => (
        <div key={i} className="bg-surface-card rounded-xl border border-surface-rule p-4 animate-pulse-soft h-[120px]" />
      ))}
    </div>
  )
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="bg-surface-card rounded-xl border border-surface-rule p-6 text-center">
      <p className="text-[12px] text-text-faint">{label}</p>
    </div>
  )
}
