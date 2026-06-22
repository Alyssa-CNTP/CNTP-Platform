'use client'

import { useState, useEffect, useMemo } from 'react'
import { Swords, ShieldAlert, Sparkles, AlertTriangle, AlertCircle } from 'lucide-react'
import SignalCard from '@/components/intelligence/SignalCard'
import SignalDrawer from '@/components/intelligence/SignalDrawer'
import type { Signal, Classification } from '@/components/intelligence/types'
import { classificationStyle, regionFlag } from '@/components/intelligence/helpers'

export default function IntelligenceSouthAfricaPage() {
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
        const za = (signals as Signal[] ?? []).filter(s => s.region === 'ZA')
        setSignals(za)
      })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // ── Classification counts ──────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<Classification, number> = {
      opportunity: 0, threat: 0, competitor: 0, regulation: 0, relationship: 0, neutral: 0,
    }
    signals.forEach(s => { c[s.classification] = (c[s.classification] ?? 0) + 1 })
    return c
  }, [signals])

  const competitors  = useMemo(() => signals.filter(s => s.classification === 'competitor')  .sort((a, b) => b.relevance_score - a.relevance_score), [signals])
  const regulations  = useMemo(() => signals.filter(s => s.classification === 'regulation')  .sort((a, b) => b.relevance_score - a.relevance_score), [signals])
  const opportunities= useMemo(() => signals.filter(s => s.classification === 'opportunity') .sort((a, b) => b.relevance_score - a.relevance_score), [signals])
  const threats      = useMemo(() => signals.filter(s => s.classification === 'threat')      .sort((a, b) => b.relevance_score - a.relevance_score), [signals])

  return (
    <div className="px-4 md:px-6 py-6 max-w-[1280px] mx-auto">
      <header className="flex flex-wrap items-baseline gap-3 mb-5">
        <span className="text-[26px] leading-none">{regionFlag('ZA')}</span>
        <h1 className="font-display font-bold text-[22px] text-text">South Africa</h1>
        <p className="text-[12px] text-text-muted">
          Domestic market signals — competitor activity, regulation, and opportunity flow.
        </p>
      </header>

      {error && (
        <div className="bg-surface-card rounded-xl border border-surface-rule p-6 text-center mb-5">
          <AlertCircle size={20} className="mx-auto mb-2" style={{ color: 'var(--color-err)' }} />
          <p className="text-[12px] text-text-muted">{error}</p>
        </div>
      )}

      {/* Overview by classification */}
      <section className="bg-surface-card rounded-xl border border-surface-rule shadow-card p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-semibold text-[14px] text-text">Local market overview</h2>
          <span className="font-mono text-[11px] text-text-muted">
            {signals.length} total ZA signals
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {(Object.keys(counts) as Classification[]).map(c => {
            const style = classificationStyle(c)
            return (
              <div
                key={c}
                className="rounded-lg border p-3"
                style={{ borderColor: style.border, background: style.bg }}
              >
                <div className="font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: style.fg }}>
                  {c}
                </div>
                <div className="font-display font-bold text-[20px] leading-none" style={{ color: style.fg }}>
                  {counts[c]}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Two-column grid for the four sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionBlock
          icon={<Swords size={14} />}
          title="Local competitor activity"
          accent="var(--color-warn)"
          signals={competitors}
          loading={loading}
          emptyLabel="No competitor signals"
          onSelect={setSelected}
        />
        <SectionBlock
          icon={<ShieldAlert size={14} />}
          title="Regulatory & industry"
          accent="var(--color-info)"
          signals={regulations}
          loading={loading}
          emptyLabel="No regulatory signals"
          onSelect={setSelected}
        />
        <SectionBlock
          icon={<Sparkles size={14} />}
          title="Market opportunities"
          accent="var(--color-ok)"
          signals={opportunities}
          loading={loading}
          emptyLabel="No opportunity signals"
          onSelect={setSelected}
        />
        <SectionBlock
          icon={<AlertTriangle size={14} />}
          title="Negative signals"
          subtitle="The bad-news layer"
          accent="var(--color-err)"
          signals={threats}
          loading={loading}
          emptyLabel="No threat signals — good news"
          onSelect={setSelected}
        />
      </div>

      <SignalDrawer signal={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function SectionBlock({
  icon, title, subtitle, accent, signals, loading, emptyLabel, onSelect,
}: {
  icon:       React.ReactNode
  title:      string
  subtitle?:  string
  accent:     string
  signals:    Signal[]
  loading:    boolean
  emptyLabel: string
  onSelect:   (s: Signal) => void
}) {
  return (
    <section className="bg-surface-card rounded-xl border border-surface-rule shadow-card flex flex-col max-h-[640px]">
      <header className="flex items-center justify-between px-4 py-3 border-b border-surface-rule">
        <div className="flex items-center gap-2">
          <span style={{ color: accent }}>{icon}</span>
          <div>
            <h3 className="font-display font-semibold text-[13px] text-text">{title}</h3>
            {subtitle && <p className="text-[10px] text-text-muted leading-tight">{subtitle}</p>}
          </div>
        </div>
        <span
          className="font-mono text-[10px] font-medium px-2 py-0.5 rounded-md border"
          style={{ background: 'var(--color-surface)', color: accent, borderColor: 'var(--color-surface-rule)' }}
        >
          {signals.length}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto p-3 grid gap-2">
        {loading ? (
          <div className="text-center text-text-faint text-[12px] py-6">Loading…</div>
        ) : signals.length === 0 ? (
          <div className="text-center text-text-faint text-[12px] py-6">{emptyLabel}</div>
        ) : (
          signals.slice(0, 25).map(s => (
            <SignalCard key={s.id} signal={s} compact onClick={onSelect} />
          ))
        )}
      </div>
    </section>
  )
}
