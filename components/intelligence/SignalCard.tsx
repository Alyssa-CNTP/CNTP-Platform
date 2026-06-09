'use client'

import { ExternalLink } from 'lucide-react'
import clsx from 'clsx'
import type { Signal } from './types'
import {
  classificationStyle,
  relevanceStyle,
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

  const handleClick = () => onClick?.(signal)

  return (
    <div
      onClick={handleClick}
      className={clsx(
        'group relative bg-surface-card rounded-xl border border-surface-rule shadow-card transition-all',
        'hover:border-text-faint/40 hover:shadow-md',
        onClick && 'cursor-pointer',
        compact ? 'p-3' : 'p-4'
      )}
    >
      {/* Top row — badges */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <span
          className="font-mono text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-md border"
          style={{
            background:   cls.bg,
            color:        cls.fg,
            borderColor:  cls.border,
          }}
        >
          {signal.classification}
        </span>
        <span
          className="font-mono text-[10px] font-medium px-2 py-0.5 rounded-md border"
          style={{
            background:   rel.bg,
            color:        rel.fg,
            borderColor:  rel.border,
          }}
        >
          {signal.relevance_score}/10
        </span>
        {signal.keyword_group && (
          <span className="font-mono text-[10px] text-text-muted bg-surface px-2 py-0.5 rounded-md border border-surface-rule">
            {signal.keyword_group}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-text-faint">
          {timeAgo(signal.created_at)}
        </span>
      </div>

      {/* Title */}
      <h3
        className={clsx(
          'font-display font-semibold text-text leading-snug',
          compact ? 'text-[13px]' : 'text-[15px]'
        )}
      >
        {signal.title}
      </h3>

      {/* Summary */}
      {signal.summary_en && !compact && (
        <p
          className="text-[13px] text-text-muted mt-1.5 leading-relaxed"
          style={{
            display:           '-webkit-box',
            WebkitLineClamp:   2,
            WebkitBoxOrient:   'vertical',
            overflow:          'hidden',
          }}
        >
          {signal.summary_en}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2.5 mt-2.5 text-[11px] text-text-faint font-mono">
        {signal.region && (
          <span className="inline-flex items-center gap-1">
            <span className="text-[13px] leading-none">{regionFlag(signal.region)}</span>
            <span>{signal.region}</span>
          </span>
        )}
        {signal.source_domain && (
          <>
            <span className="text-text-faint/50">·</span>
            <span className="truncate max-w-[180px]">{signal.source_domain}</span>
          </>
        )}
        {signal.source_url && (
          <a
            href={signal.source_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="ml-auto text-text-muted hover:text-accent transition-colors"
            aria-label="Open source in new tab"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  )
}
