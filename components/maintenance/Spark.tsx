'use client'

// components/maintenance/Spark.tsx
// Tiny SVG line chart for trends — no chart library needed. Each point is
// clickable (transparent overlay buttons): tapping one reveals that week's date
// and value below the chart, so the raw numbers live on the graph itself rather
// than in a separate table. Shared by the maintenance trends panel and the
// scheduled-maintenance readings.

import { useState } from 'react'
import { fmtD } from '@/lib/maintenance/helpers'

export function Spark({ pts, color = '#2563eb', h = 44, labels, dates, unit = '', digits = 1 }: { pts: number[]; color?: string; h?: number; labels?: [string, string]; dates?: (string | null)[]; unit?: string; digits?: number }) {
  const [sel, setSel] = useState<number | null>(null)
  if (pts.length < 2) return <div className="text-[11px] text-text-faint py-2">Not enough data yet — tap points once there are ≥2 readings.</div>
  const min = Math.min(...pts), max = Math.max(...pts), w = 200, n = pts.length
  const xAt = (i: number) => (i / (n - 1)) * w
  const yAt = (v: number) => (max === min ? h / 2 : h - ((v - min) / (max - min)) * (h - 8) - 4)
  const xy = pts.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ')
  const fmtV = (v: number) => v.toFixed(digits) + (unit ? ' ' + unit : '')
  return (
    <div>
      <div className="relative" style={{ height: h }}>
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: h, display: 'block' }} preserveAspectRatio="none">
          <polyline points={xy} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {sel != null && <line x1={xAt(sel)} y1={0} x2={xAt(sel)} y2={h} stroke={color} strokeWidth={1} strokeDasharray="2 2" opacity={0.55} vectorEffect="non-scaling-stroke" />}
          {sel != null && <circle cx={xAt(sel)} cy={yAt(pts[sel])} r={3} fill={color} vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* Transparent per-point hit targets — click to read the value. */}
        <div className="absolute inset-0 flex">
          {pts.map((v, i) => (
            <button key={i} onClick={() => setSel(s => (s === i ? null : i))}
              title={`${dates?.[i] ? fmtD(dates[i]) + ' · ' : ''}${fmtV(v)}`}
              className={`flex-1 transition ${sel === i ? 'bg-current/5' : 'hover:bg-current/5'}`} style={{ color }} />
          ))}
        </div>
      </div>
      {labels && <div className="flex justify-between text-[10px] text-text-faint"><span>{labels[0]}</span><span>{labels[1]}</span></div>}
      <div className="text-[11px] mt-1 min-h-[16px]">
        {sel != null
          ? <span className="text-text">{dates?.[sel] ? fmtD(dates[sel]) + ' · ' : `Point ${sel + 1} · `}<strong>{fmtV(pts[sel])}</strong></span>
          : <span className="text-text-faint">Tap a point to see its value</span>}
      </div>
    </div>
  )
}
