'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

// ── Animated count-up hook ────────────────────────────────────────────────────
function useCountUp(target: number, duration = 1100, enabled = true) {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled || target === 0) { setValue(target); return }
    let start: number | null = null

    const step = (ts: number) => {
      if (!start) start = ts
      const progress = Math.min((ts - start) / duration, 1)
      const eased    = 1 - Math.pow(1 - progress, 3)          // ease-out cubic
      setValue(Math.round(eased * target))
      if (progress < 1) rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration, enabled])

  return value
}

// ── Types ─────────────────────────────────────────────────────────────────────
type KpiColor = 'ok' | 'warn' | 'info' | 'muted' | 'err'
type Trend    = 'up' | 'down' | 'flat' | undefined

export interface KpiItem {
  id:           string
  label:        string
  sublabel?:    string
  value:        string           // formatted display value
  numericValue: number           // raw number for count-up
  color?:       KpiColor
  trend?:       Trend
  href:         string
  icon:         React.ReactNode  // Lucide icon or any ReactNode
}

// ── Single card ───────────────────────────────────────────────────────────────
function KpiCard({ item }: { item: KpiItem }) {
  const num = useCountUp(item.numericValue, 1100, item.numericValue > 0)

  const colorMap: Record<KpiColor, { value: string; bg: string; border: string; badge: string }> = {
    ok:   { value: 'text-ok',       bg: 'bg-ok/5',       border: 'border-ok/15',       badge: 'bg-ok/10 text-ok'       },
    info: { value: 'text-info',     bg: 'bg-info/5',     border: 'border-info/15',     badge: 'bg-info/10 text-info'   },
    warn: { value: 'text-warn',     bg: 'bg-warn/5',     border: 'border-warn/15',     badge: 'bg-warn/10 text-warn'   },
    err:  { value: 'text-err',      bg: 'bg-err/5',      border: 'border-err/15',      badge: 'bg-err/10 text-err'     },
    muted:{ value: 'text-text',     bg: 'bg-surface-card', border: 'border-surface-rule', badge: 'bg-surface text-text-muted' },
  }

  const c = colorMap[item.color ?? 'muted']

  // Determine if the value is a simple integer we can animate
  const canAnimate = Number.isFinite(item.numericValue) && !item.value.includes('R ')
  // For currency/complex values keep the original formatted string
  const displayValue = canAnimate ? item.value.replace(/\d+/, String(num)) : item.value

  const TrendIcon = item.trend === 'up' ? TrendingUp
                  : item.trend === 'down' ? TrendingDown
                  : Minus

  return (
    <Link
      href={item.href}
      className={`
        shrink-0 w-[172px] rounded-2xl border p-4 flex flex-col gap-2
        hover:scale-[1.02] hover:shadow-md transition-all duration-200 group
        ${c.bg} ${c.border}
      `}
    >
      {/* Top row: icon + trend */}
      <div className="flex items-center justify-between">
        <span className="text-text-muted">{item.icon}</span>
        {item.trend && (
          <TrendIcon
            size={13}
            className={
              item.trend === 'up'   ? 'text-ok' :
              item.trend === 'down' ? 'text-warn' :
              'text-text-muted'
            }
          />
        )}
      </div>

      {/* Value */}
      <div className={`font-display font-bold text-[26px] leading-none ${c.value}`}>
        {displayValue}
      </div>

      {/* Label */}
      <div>
        <div className="font-body font-semibold text-[12px] text-text leading-tight">{item.label}</div>
        {item.sublabel && (
          <div className="font-mono text-[10px] text-text-muted mt-0.5 uppercase tracking-wide">
            {item.sublabel}
          </div>
        )}
      </div>
    </Link>
  )
}

// ── Ribbon ────────────────────────────────────────────────────────────────────
export default function KpiRibbon({ kpis }: { kpis: KpiItem[] }) {
  if (!kpis.length) return null

  return (
    <div className="relative">
      {/* Fade edges */}
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-surface to-transparent z-10" />

      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none stagger">
        {kpis.map(kpi => (
          <KpiCard key={kpi.id} item={kpi} />
        ))}
      </div>
    </div>
  )
}
