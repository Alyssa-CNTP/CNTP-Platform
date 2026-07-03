'use client'

import { useEffect, useState } from 'react'
import { X, ExternalLink, Calendar, Globe, Tag, Languages, Target, UserPlus, CheckCircle } from 'lucide-react'
import type { Signal } from './types'
import {
  classificationStyle,
  relevanceStyle,
  urgencyStyle,
  regionFlag,
  formatDateTime,
} from './helpers'

interface SignalDrawerProps {
  signal:  Signal | null
  onClose: () => void
}

export default function SignalDrawer({ signal, onClose }: SignalDrawerProps) {
  const [promoting, setPromoting] = useState(false)
  const [promoted,  setPromoted]  = useState(false)

  async function promoteToLead() {
    if (!signal || promoting || promoted) return
    setPromoting(true)
    try {
      const name = signal.source_domain
        ?? signal.title.split(' ').slice(0, 4).join(' ')
      const res = await fetch('/api/accounts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          country:          signal.region ?? undefined,
          region:           signal.region ?? undefined,
          account_type:     'prospect',
          stage:            'lead',
          sales_angle:      signal.sales_angle ?? undefined,
          signal_ids:       [signal.id],
          source_signal_id: signal.id,
          signal_title:     signal.title,
          tags:             ['signal-promoted'],
        }),
      })
      if (res.ok) setPromoted(true)
    } finally {
      setPromoting(false)
    }
  }

  // reset promoted state when a different signal opens
  useEffect(() => { setPromoted(false) }, [signal?.id])

  // Lock body scroll while open
  useEffect(() => {
    if (signal) document.body.style.overflow = 'hidden'
    else        document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [signal])

  // Close on Escape
  useEffect(() => {
    if (!signal) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [signal, onClose])

  if (!signal) return null

  const cls = classificationStyle(signal.classification)
  const rel = relevanceStyle(signal.relevance_score)
  const urg = signal.urgency ? urgencyStyle(signal.urgency) : null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end animate-in"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />

      {/* Panel */}
      <aside
        onClick={e => e.stopPropagation()}
        className="relative h-full w-full max-w-[560px] bg-surface-card border-l border-surface-rule shadow-menu flex flex-col slide-up"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-surface-rule sticky top-0 bg-surface-card z-10">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="font-mono text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-md border"
              style={{ background: cls.bg, color: cls.fg, borderColor: cls.border }}
            >
              {signal.classification}
            </span>
            <span
              className="font-mono text-[10px] font-medium px-2 py-0.5 rounded-md border"
              style={{ background: rel.bg, color: rel.fg, borderColor: rel.border }}
            >
              {signal.relevance_score}/10
            </span>
            {urg && (
              <span
                className="font-mono text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-md border"
                style={{ background: urg.bg, color: urg.fg, borderColor: urg.border }}
              >
                {signal.urgency} urgency
              </span>
            )}
            <span className="font-mono text-[10px] text-text-muted bg-surface px-2 py-0.5 rounded-md border border-surface-rule">
              {signal.source_type}
            </span>
            {signal.tier != null && (
              <span className="font-mono text-[10px] text-text-muted bg-surface px-2 py-0.5 rounded-md border border-surface-rule">
                Tier {signal.tier}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-surface text-text-muted hover:text-text transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <h2 className="font-display font-semibold text-[20px] text-text leading-snug">
            {signal.title}
          </h2>

          {/* Meta grid */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mt-5 text-[12px]">
            {signal.region && (
              <MetaRow icon={<Globe size={12} />} label="Region">
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-[15px] leading-none">{regionFlag(signal.region)}</span>
                  <span className="font-mono">{signal.region}</span>
                </span>
              </MetaRow>
            )}
            {signal.keyword_group && (
              <MetaRow icon={<Tag size={12} />} label="Group">
                <span className="font-mono text-text">{signal.keyword_group}</span>
              </MetaRow>
            )}
            {signal.language && (
              <MetaRow icon={<Languages size={12} />} label="Language">
                <span className="font-mono uppercase text-text">{signal.language}</span>
              </MetaRow>
            )}
            <MetaRow icon={<Calendar size={12} />} label="Date">
              <span className="font-mono text-text">{formatDateTime(signal.created_at)}</span>
            </MetaRow>
            {signal.source_domain && (
              <MetaRow icon={<ExternalLink size={12} />} label="Source">
                {signal.source_url ? (
                  <a
                    href={signal.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-accent hover:underline truncate inline-block max-w-full"
                  >
                    {signal.source_domain}
                  </a>
                ) : (
                  <span className="font-mono text-text">{signal.source_domain}</span>
                )}
              </MetaRow>
            )}
          </dl>

          {/* Summary */}
          {signal.summary_en && (
            <section className="mt-6">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-2">Summary</h3>
              <p className="text-[14px] text-text leading-relaxed whitespace-pre-wrap">
                {signal.summary_en}
              </p>
            </section>
          )}

          {/* Recommended action — the pipeline's concrete next step for CNTP */}
          {signal.sales_angle && (
            <section className="mt-6">
              <h3 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted mb-2">
                <Target size={12} />
                Recommended action
              </h3>
              <p
                className="text-[14px] text-text leading-relaxed whitespace-pre-wrap rounded-lg border border-surface-rule bg-surface p-3"
                style={{ borderLeft: '3px solid var(--color-accent)' }}
              >
                {signal.sales_angle}
              </p>
            </section>
          )}

          {/* Sections tags */}
          {signal.sections && signal.sections.length > 0 && (
            <section className="mt-6">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-2">Sections</h3>
              <div className="flex flex-wrap gap-1.5">
                {signal.sections.map(s => (
                  <span
                    key={s}
                    className="font-mono text-[10px] text-text-muted bg-surface px-2 py-0.5 rounded-md border border-surface-rule"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Raw content */}
          {signal.raw_content && (
            <section className="mt-6">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-2">Raw content</h3>
              <pre className="font-mono text-[11px] text-text-muted bg-surface border border-surface-rule rounded-lg p-3 whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto">
                {signal.raw_content}
              </pre>
            </section>
          )}

          {/* Actions */}
          <div className="mt-6 flex flex-wrap gap-2">
            {signal.source_url && (
              <a
                href={signal.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-[13px] font-medium hover:bg-brand-hover transition-colors"
              >
                <ExternalLink size={14} />
                Open source
              </a>
            )}
            <button
              onClick={promoteToLead}
              disabled={promoting || promoted}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-surface-rule text-[13px] font-medium transition-colors disabled:opacity-60"
              style={promoted
                ? { background: 'var(--color-ok-bg)', color: 'var(--color-ok)', borderColor: 'rgba(21,128,61,0.22)' }
                : { background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
            >
              {promoted
                ? <><CheckCircle size={14} /> Added to pipeline</>
                : <><UserPlus size={14} /> {promoting ? 'Adding…' : 'Promote to lead'}</>}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

function MetaRow({
  icon, label, children,
}: {
  icon:     React.ReactNode
  label:    string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-faint mb-0.5">
        {icon}
        {label}
      </dt>
      <dd className="text-[13px]">{children}</dd>
    </div>
  )
}
