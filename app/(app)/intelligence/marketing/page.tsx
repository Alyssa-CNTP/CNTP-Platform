'use client'

import { useState, useEffect, useMemo } from 'react'
import { Hash, Palette, Leaf, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react'
import SignalCard from '@/components/intelligence/SignalCard'
import SignalDrawer from '@/components/intelligence/SignalDrawer'
import type { Signal } from '@/components/intelligence/types'

const MARKETING_GROUPS = new Set(['creative', 'wellness', 'core_product'])

// Common English stopwords + a few rooibos/tea-domain words we should not surface as "trending"
const STOPWORDS = new Set<string>([
  'the','and','for','with','from','that','this','have','has','are','was','were','will','what','when','where',
  'a','an','of','to','in','on','is','it','as','at','by','be','or','if','but','not','all','any','can','has',
  'than','then','they','them','their','its','our','your','you','we','i','one','two','new','also','more',
  'about','into','out','over','under','after','before','up','down','off','no','yes','his','her','him','she','he',
  'use','using','used','via','per','vs','etc','said','says','say','make','made','make','make','some','very',
  'rooibos','tea','south','africa','herbal','flavor','flavour',
])

export default function IntelligenceMarketingPage() {
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
          s => s.keyword_group && MARKETING_GROUPS.has(s.keyword_group)
        )
        setSignals(filtered)
      })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // ── Trending topics ────────────────────────────────────────────────────────
  const trending = useMemo(() => {
    const counts = new Map<string, number>()
    signals.forEach(s => {
      const words = s.title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
      const unique = new Set(words)
      unique.forEach(w => counts.set(w, (counts.get(w) ?? 0) + 1))
    })
    return Array.from(counts.entries())
      .filter(([, c]) => c >= 2)
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30)
  }, [signals])

  const maxTrendCount = trending[0]?.count ?? 1

  const creative = useMemo(() =>
    signals
      .filter(s => s.keyword_group === 'creative')
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, 12),
    [signals])

  const wellness = useMemo(() =>
    signals
      .filter(s => s.keyword_group === 'wellness')
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, 12),
    [signals])

  // ── Sentiment ──────────────────────────────────────────────────────────────
  const sentiment = useMemo(() => {
    const opp    = signals.filter(s => s.classification === 'opportunity').length
    const threat = signals.filter(s => s.classification === 'threat').length
    const total  = opp + threat
    return {
      opp,
      threat,
      total,
      oppPct:    total ? Math.round((opp / total) * 100)    : 0,
      threatPct: total ? Math.round((threat / total) * 100) : 0,
    }
  }, [signals])

  return (
    <div className="px-4 md:px-6 py-6 max-w-[1280px] mx-auto">
      <header className="flex flex-wrap items-baseline gap-3 mb-5">
        <h1 className="font-display font-bold text-[22px] text-text">Marketing Intelligence</h1>
        <p className="text-[12px] text-text-muted">
          Trending topics, creative signals, and wellness trends shaping the category.
        </p>
      </header>

      {error && (
        <div className="bg-surface-card rounded-xl border border-surface-rule p-6 text-center mb-5">
          <AlertCircle size={20} className="mx-auto mb-2" style={{ color: 'var(--color-err)' }} />
          <p className="text-[12px] text-text-muted">{error}</p>
        </div>
      )}

      {/* Sentiment + Tag cloud row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        {/* Sentiment */}
        <section className="bg-surface-card rounded-xl border border-surface-rule shadow-card p-4">
          <h2 className="font-display font-semibold text-[14px] text-text mb-1">Sentiment</h2>
          <p className="text-[11px] text-text-muted mb-3">Opportunity vs threat ratio</p>
          {sentiment.total === 0 ? (
            <p className="text-[12px] text-text-faint">No directional signals yet</p>
          ) : (
            <>
              <div className="flex h-2.5 rounded-full overflow-hidden border border-surface-rule">
                <div
                  className="transition-all"
                  style={{ width: `${sentiment.oppPct}%`, background: 'var(--color-ok)' }}
                />
                <div
                  className="transition-all"
                  style={{ width: `${sentiment.threatPct}%`, background: 'var(--color-err)' }}
                />
              </div>
              <div className="flex items-center justify-between mt-3 font-mono text-[11px]">
                <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--color-ok)' }}>
                  <TrendingUp size={12} />
                  {sentiment.opp} opportunity · {sentiment.oppPct}%
                </span>
                <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--color-err)' }}>
                  <TrendingDown size={12} />
                  {sentiment.threat} threat · {sentiment.threatPct}%
                </span>
              </div>
            </>
          )}
        </section>

        {/* Tag cloud */}
        <section className="bg-surface-card rounded-xl border border-surface-rule shadow-card p-4 lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Hash size={14} className="text-accent" />
            <h2 className="font-display font-semibold text-[14px] text-text">Trending topics</h2>
            <span className="font-mono text-[10px] text-text-muted ml-auto">From signal titles</span>
          </div>
          {loading ? (
            <p className="text-[12px] text-text-faint">Loading…</p>
          ) : trending.length === 0 ? (
            <p className="text-[12px] text-text-faint">Not enough signals to surface trends yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {trending.map(({ word, count }) => {
                const weight = count / maxTrendCount
                const size   = Math.round(11 + weight * 9)
                const opacity = 0.5 + weight * 0.5
                return (
                  <span
                    key={word}
                    className="font-mono inline-flex items-center gap-1 px-2 py-1 rounded-md border border-surface-rule bg-surface"
                    style={{
                      fontSize: size,
                      color:    'var(--color-text)',
                      opacity,
                    }}
                  >
                    {word}
                    <span className="text-text-faint text-[10px]">{count}</span>
                  </span>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* Creative feed */}
      <section className="mb-6">
        <SectionHeader
          icon={<Palette size={14} />}
          title="Creative signals"
          subtitle="Product innovation, packaging, new formats"
          count={creative.length}
          accent="var(--color-warn)"
        />
        {loading ? (
          <SkeletonGrid />
        ) : creative.length === 0 ? (
          <EmptyBlock label="No creative signals" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {creative.map(s => (
              <SignalCard key={s.id} signal={s} onClick={setSelected} />
            ))}
          </div>
        )}
      </section>

      {/* Wellness feed */}
      <section className="mb-6">
        <SectionHeader
          icon={<Leaf size={14} />}
          title="Health & wellness trends"
          subtitle="Health claims, research, functional benefits"
          count={wellness.length}
          accent="var(--color-ok)"
        />
        {loading ? (
          <SkeletonGrid />
        ) : wellness.length === 0 ? (
          <EmptyBlock label="No wellness signals" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {wellness.map(s => (
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
