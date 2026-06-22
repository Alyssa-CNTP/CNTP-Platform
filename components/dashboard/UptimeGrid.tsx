'use client'

import Link from 'next/link'
import { CheckCircle2, Clock, Pen, CircleDashed, Activity } from 'lucide-react'
import type { SectionStatus } from './WarehouseMap'

interface Props {
  sections: SectionStatus[]
  loading:  boolean
}

const SECTION_COLORS: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  sieving:     { bg: 'bg-blue-500',    text: 'text-blue-500',    border: 'border-blue-200',   glow: 'shadow-blue-200'    },
  refining1:   { bg: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-200',glow: 'shadow-emerald-200' },
  refining2:   { bg: 'bg-emerald-500', text: 'text-emerald-500', border: 'border-emerald-200',glow: 'shadow-emerald-200' },
  granule:     { bg: 'bg-amber-500',   text: 'text-amber-500',   border: 'border-amber-200',  glow: 'shadow-amber-200'   },
  blender:     { bg: 'bg-purple-500',  text: 'text-purple-500',  border: 'border-purple-200', glow: 'shadow-purple-200'  },
  pasteuriser: { bg: 'bg-red-500',     text: 'text-red-500',     border: 'border-red-200',    glow: 'shadow-red-200'     },
}

function StatusChip({ status }: { status: SectionStatus['status'] }) {
  if (status === 'approved') return (
    <span className="inline-flex items-center gap-1 font-mono text-[9px] px-1.5 py-0.5 rounded-md bg-ok/10 text-ok border border-ok/20">
      <CheckCircle2 size={9} /> Approved
    </span>
  )
  if (status === 'submitted') return (
    <span className="inline-flex items-center gap-1 font-mono text-[9px] px-1.5 py-0.5 rounded-md bg-info/10 text-info border border-info/20">
      <Clock size={9} /> Submitted
    </span>
  )
  if (status === 'draft') return (
    <span className="inline-flex items-center gap-1 font-mono text-[9px] px-1.5 py-0.5 rounded-md bg-warn/10 text-warn border border-warn/20">
      <Pen size={9} /> In progress
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[9px] px-1.5 py-0.5 rounded-md bg-surface text-text-faint border border-surface-rule">
      <CircleDashed size={9} /> No session
    </span>
  )
}

export default function UptimeGrid({ sections, loading }: Props) {
  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-surface-rule flex items-center gap-3">
        <Activity size={14} className="text-text-muted" />
        <span className="font-display font-bold text-[14px] text-text">Section Uptime</span>
        <span className="font-mono text-[11px] text-text-muted">· today&apos;s sessions</span>
      </div>

      {/* Grid */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[120px] rounded-xl bg-surface animate-pulse" />
            ))
          : sections.map(sec => {
              const c       = SECTION_COLORS[sec.sectionId] ?? SECTION_COLORS.blender
              const isActive = sec.status !== 'idle'

              return (
                <Link
                  key={sec.sectionId}
                  href="/production"
                  className={`
                    relative flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border text-center
                    hover:scale-[1.03] transition-all duration-200
                    ${isActive
                      ? `border-current/20 ${c.border} bg-surface`
                      : 'border-surface-rule bg-surface'
                    }
                  `}
                >
                  {/* Active pulse ring */}
                  {sec.status === 'approved' && (
                    <span
                      className={`absolute inset-0 rounded-xl border-2 ${c.border} animate-ping opacity-20`}
                    />
                  )}

                  {/* Code badge */}
                  <div className={`
                    w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                    ${isActive ? c.bg : 'bg-surface-rule'}
                  `}>
                    <span className="font-mono font-bold text-[13px] text-white">{sec.code}</span>
                  </div>

                  {/* Name */}
                  <div className="font-body font-semibold text-[11px] text-text leading-tight text-center">
                    {sec.name}
                  </div>

                  {/* Status chip */}
                  <StatusChip status={sec.status} />

                  {/* KG + yield */}
                  {sec.totalKg > 0 && (
                    <div className={`font-mono text-[10px] ${c.text}`}>
                      {sec.totalKg.toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg
                    </div>
                  )}
                  {sec.avgYield != null && (
                    <div className="font-mono text-[10px] text-text-faint">
                      {sec.avgYield.toFixed(1)}% yield
                    </div>
                  )}
                </Link>
              )
            })}
      </div>

      {/* Footer */}
      <div className="px-5 pb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] text-text-faint">
          Separate maintenance tab coming soon
        </span>
        <Link href="/production/history"
          className="font-mono text-[11px] text-brand hover:underline">
          Full history →
        </Link>
      </div>
    </div>
  )
}
