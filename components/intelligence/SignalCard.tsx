'use client'

import { ExternalLink, Target, Zap } from 'lucide-react'
import clsx from 'clsx'
import type { Signal } from './types'
import {
  classificationStyle,
  relevanceStyle,
  urgencyStyle,
  regionFlag,
  timeAgo,
} from './helpers'

interface SignalCardProps {
  signal:   Signal
  compact?: boolean
  onClick?: (signal: Signal) => void
}

export default function SignalCard({ signal, compact = false, onClick }: SignalCardProps) {
  const cls = classificationStyle(signal.classification)
  const rel = relevanceStyle(signal.relevance_score)
  const urg = signal.urgency ? urgencyStyle(signal.urgency) : null

  // Fine-grained pipeline type (loophole / market_gap / …) preserved in intel.
  const rawType =
    signal.intel && typeof signal.intel === 'object'
      ? ((signal.intel as Record<string, unknown>).intelligence_type as string | undefined)
      : undefined
  const showRawType = rawType && rawType !== signal.classification

  // Title fallback chain: title → summary_en → intel.title → keyword_group + source
  const intelTitle = signal.intel && typeof signal.intel === 'object'
    ? ((signal.intel as Record<string, unknown>).title as string | undefined)
    : undefined
  const displayTitle =
    signal.title?.trim() ||
    signal.summary_en?.trim() ||
    intelTitle?.trim() ||
    (signal.keyword_group ? `${signal.keyword_group} · ${signal.classification}` : null) ||
    signal.source_domain?.replace(/^https?:\/\/(www\.)?/, '') ||
    null

  const handleClick = () => onClick?.(signal)

  return (
    <article
      onClick={handleClick}
      className={clsx(
        'group relative bg-surface-card rounded-xl border border-surface-rule shadow-card transition-all overflow-hidden',
        'hover:border-text-faint/40 hover:shadow-md',
        onClick && 'cursor-pointer',
        compact ? 'p-3 pl-4' : 'p-4 pl-5'
      )}
    >
      {/* Classification accent rail */}
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: cls.fg }}
      />

      {/* Badge row */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
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
            className="inline-flex items-center gap-0.5 font-mono text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-md border"
            style={{ background: urg.bg, color: urg.fg, borderColor: urg.border }}
          >
            {signal.urgency === 'high' && <Zap size={9} />}
            {signal.urgency}
          </span>
        )}
        {showRawType && (
          <span className="font-mono text-[10px] text-text-muted bg-surface px-2 py-0.5 rounded-md border border-surface-rule">
            {rawType!.replace(/_/g, ' ')}
          </span>
        )}
        {signal.tier === 2 && (
          <span className="font-mono text-[10px] text-text-faint px-1.5 py-0.5 rounded-md border border-surface-rule">
            deep
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-text-faint">
          {timeAgo(signal.created_at)}
        </span>
      </div>

      {/* Title */}
      {displayTitle && (
        <h3
          className={clsx(
            'font-display font-semibold text-text leading-snug',
            compact ? 'text-[13px]' : 'text-[15px]'
          )}
        >
          {displayTitle}
        </h3>
      )}

      {/* Summary — only if distinct from the title we're already showing */}
      {signal.summary_en?.trim() && signal.summary_en.trim() !== displayTitle && !compact && (
        <p className="text-[13px] text-text-muted mt-1.5 leading-relaxed line-clamp-2">
          {signal.summary_en}
        </p>
      )}

      {/* Recommended action — the hero of the card */}
      {signal.sales_angle && !compact && (
        <div
          className="mt-2.5 flex items-start gap-2 rounded-lg px-3 py-2"
          style={{ background: 'rgba(90,138,42,0.10)' }}
        >
          <Target size={13} className="mt-[3px] shrink-0" style={{ color: 'var(--color-accent)' }} />
          <p className="text-[12px] leading-relaxed text-text line-clamp-2">
            {signal.sales_angle}
          </p>
        </div>
      )}

      {/* Footer meta */}
      <div className="flex items-center gap-2.5 mt-3 text-[11px] text-text-faint font-mono">
        {signal.region && (
          <span className="inline-flex items-center gap-1">
            <span className="text-[13px] leading-none">{regionFlag(signal.region)}</span>
            <span>{signal.region}</span>
          </span>
        )}
        {signal.source_domain && (
          <>
            <span className="text-text-faint/50">·</span>
            <span className="truncate max-w-[160px]">
              {signal.source_domain.replace(/^https?:\/\/(www\.)?/, '')}
            </span>
          </>
        )}
        {signal.keyword_group && (
          <>
            <span className="text-text-faint/50">·</span>
            <span className="truncate">{signal.keyword_group}</span>
          </>
        )}
        {signal.source_url && (
          <a
            href={signal.source_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="ml-auto inline-flex items-center text-text-muted hover:text-accent transition-colors"
            aria-label="Open source in new tab"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>
    </article>
  )
}
