'use client'

// components/axis/IntelligenceHub.tsx
// The AXIS dashboard's "Intelligence Hub" — a radial diagram crossing 8
// business-function wedges with 6 capability-layer rings, auto-populated
// from LLM-categorized axis.change_logs entries (never hand-plotted). Wrapped
// by a manager ring and an outer Board/MD/FD ring, matching the board-deck
// reference. Deliberately uses a one-off navy palette, distinct from the
// rest of AXIS's green/white operational pages, to read as a separate
// "vision" zone.
//
// Presentational only — takes pre-fetched cell counts as a prop; the parent
// page owns fetching, collapse state, and re-fetching after a recategorize run.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { sector, curvedLabelPath, cellIntensity } from '@/lib/axis/hub-geometry'
import {
  BUSINESS_FUNCTIONS, CAPABILITY_LAYERS, FUNCTION_LABEL, FUNCTION_HUE,
  LAYER_LABEL, LAYER_DESCRIPTION, LAYER_ICON,
  type BusinessFunction, type CapabilityLayer,
} from '@/lib/axis/hub-taxonomy'

export interface HubCell {
  business_function: BusinessFunction
  capability_layer: CapabilityLayer
  count: number
}

interface Props {
  cells: HubCell[]
  categorizedCount: number
  totalCount: number
  lastRunAt: string | null
  onRecategorize: () => Promise<void>
  recategorizing: boolean
}

const CX = 450, CY = 450
const R_HUB = 65
const R_LAYERS_START = 70
const LAYER_BAND = 60           // 6 layers * 60 = 360, ends at 430
const R_MANAGER = [445, 490]
const R_BOARD   = [500, 540]
const WEDGE_ANGLE = 360 / BUSINESS_FUNCTIONS.length   // 45deg
const CELL_GAP = 1              // degrees carved inside each wedge boundary

function wedgeAngles(index: number): [number, number] {
  return [index * WEDGE_ANGLE + CELL_GAP, (index + 1) * WEDGE_ANGLE - CELL_GAP]
}

// Board / MD / FD — unequal segments per the deck's stated governance split.
const BOARD_SEGMENTS: { key: string; label: string; start: number; end: number }[] = [
  { key: 'board', label: 'BOARD OF DIRECTORS', start: 0,   end: 198 },
  { key: 'md',    label: 'MD',                 start: 198, end: 288 },
  { key: 'fd',    label: 'FD',                 start: 288, end: 360 },
]

function timeAgo(iso: string | null) {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function IntelligenceHub({
  cells, categorizedCount, totalCount, lastRunAt, onRecategorize, recategorizing,
}: Props) {
  const router = useRouter()
  const [hover, setHover] = useState<{ fn: BusinessFunction; layer: CapabilityLayer } | null>(null)

  const countMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cells) m.set(`${c.business_function}|${c.capability_layer}`, c.count)
    return m
  }, [cells])

  const maxCount = useMemo(
    () => Math.max(0, ...cells.map(c => c.count)),
    [cells],
  )

  const hoverCount = hover ? (countMap.get(`${hover.fn}|${hover.layer}`) ?? 0) : 0

  return (
    <div
      className="intelligence-hub rounded-2xl border overflow-hidden"
      style={{ background: 'var(--hub-navy-bg, #10203A)', borderColor: 'rgba(126,200,227,0.18)' }}
    >
      <div className="px-5 py-4 flex items-start justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid rgba(126,200,227,0.15)' }}>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#7EC8E3' }}>AXIS · Vision</p>
          <h2 className="font-display font-bold text-[18px]" style={{ color: '#fff' }}>Intelligence Hub</h2>
          <p className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {categorizedCount} of {totalCount} change-log entries classified · updated {timeAgo(lastRunAt)}
          </p>
        </div>
        <button
          onClick={onRecategorize}
          disabled={recategorizing}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50"
          style={{ background: 'rgba(126,200,227,0.12)', color: '#7EC8E3', border: '1px solid rgba(126,200,227,0.3)' }}
        >
          {recategorizing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Recategorize now
        </button>
      </div>

      <div className="p-5 flex flex-col lg:flex-row gap-6 items-center lg:items-start">
        <div className="relative w-full max-w-[520px] flex-shrink-0">
          <svg viewBox="0 0 900 900" className="w-full h-auto">
            <defs>
              <radialGradient id="hub-core" cx="38%" cy="32%" r="80%">
                <stop offset="0%" stopColor="#3a82c4" />
                <stop offset="55%" stopColor="#2E75B6" />
                <stop offset="100%" stopColor="#1F3864" />
              </radialGradient>
            </defs>

            {/* Board / MD / FD outer ring */}
            {BOARD_SEGMENTS.map(seg => (
              <path
                key={seg.key}
                d={sector(CX, CY, R_BOARD[0], R_BOARD[1], seg.start + 1, seg.end - 1)}
                fill="#1F3864"
                stroke="#E8A020"
                strokeOpacity={0.4}
                strokeWidth={1}
              />
            ))}
            {BOARD_SEGMENTS.map(seg => {
              const pathId = `board-label-${seg.key}`
              return (
                <g key={pathId}>
                  <path id={pathId} d={curvedLabelPath(CX, CY, (R_BOARD[0] + R_BOARD[1]) / 2, seg.start + 2, seg.end - 2)} fill="none" />
                  <text fontFamily="var(--font-mono, monospace)" fontWeight={700} fontSize={13} letterSpacing={1.5} fill="#cdd8ea">
                    <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">{seg.label}</textPath>
                  </text>
                </g>
              )
            })}

            {/* Manager ring — one segment per business function, label-only (no data source) */}
            {BUSINESS_FUNCTIONS.map((fn, i) => {
              const [a0, a1] = wedgeAngles(i)
              return (
                <path
                  key={`mgr-${fn}`}
                  d={sector(CX, CY, R_MANAGER[0], R_MANAGER[1], a0, a1)}
                  fill={FUNCTION_HUE[fn]}
                  fillOpacity={0.18}
                  stroke="#ffffff"
                  strokeOpacity={0.15}
                  strokeWidth={1.5}
                />
              )
            })}
            {BUSINESS_FUNCTIONS.map((fn, i) => {
              const [a0, a1] = wedgeAngles(i)
              const pathId = `mgr-label-${fn}`
              return (
                <g key={pathId}>
                  <path id={pathId} d={curvedLabelPath(CX, CY, (R_MANAGER[0] + R_MANAGER[1]) / 2, a0, a1)} fill="none" />
                  <text fontFamily="var(--font-mono, monospace)" fontWeight={700} fontSize={11} letterSpacing={1} fill="#e8f0fa">
                    <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">{FUNCTION_LABEL[fn].toUpperCase()}</textPath>
                  </text>
                </g>
              )
            })}

            {/* 6 capability-layer rings x 8 business-function wedges = 48 cells */}
            {CAPABILITY_LAYERS.map((layer, layerIdx) => {
              const rInner = R_LAYERS_START + layerIdx * LAYER_BAND
              const rOuter = rInner + LAYER_BAND
              return BUSINESS_FUNCTIONS.map((fn, fnIdx) => {
                const [a0, a1] = wedgeAngles(fnIdx)
                const count = countMap.get(`${fn}|${layer}`) ?? 0
                const intensity = cellIntensity(count, maxCount)
                const isHovered = hover?.fn === fn && hover?.layer === layer
                return (
                  <path
                    key={`${layer}-${fn}`}
                    d={sector(CX, CY, rInner, rOuter, a0, a1)}
                    fill={FUNCTION_HUE[fn]}
                    fillOpacity={intensity}
                    stroke={isHovered ? '#ffffff' : 'rgba(126,200,227,0.18)'}
                    strokeWidth={isHovered ? 2 : 1}
                    style={{ cursor: 'pointer', transition: 'fill-opacity 200ms, stroke 120ms' }}
                    onMouseEnter={() => setHover({ fn, layer })}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => router.push(`/axis/changelog?business_function=${fn}&capability_layer=${layer}`)}
                  />
                )
              })
            })}

            {/* Center hub */}
            <circle cx={CX} cy={CY} r={R_HUB} fill="url(#hub-core)" stroke="#E8A020" strokeWidth={2} />
            <text x={CX} y={CY - 8} textAnchor="middle" fontFamily="var(--font-display, sans-serif)" fontWeight={900} fontSize={15} letterSpacing={0.5} fill="#fff">
              INTELLIGENCE
            </text>
            <text x={CX} y={CY + 12} textAnchor="middle" fontFamily="var(--font-display, sans-serif)" fontWeight={900} fontSize={15} letterSpacing={3} fill="#7EC8E3">
              HUB
            </text>
            <text x={CX} y={CY + 30} textAnchor="middle" fontFamily="var(--font-mono, monospace)" fontSize={9} fill="rgba(255,255,255,0.7)">
              {categorizedCount} classified
            </text>
          </svg>

          {hover && (
            <div
              className="absolute top-2 left-2 px-3 py-2 rounded-lg text-[11px] pointer-events-none"
              style={{ background: 'rgba(16,32,58,0.95)', border: '1px solid rgba(126,200,227,0.3)', color: '#e8f0fa' }}
            >
              <p className="font-semibold">{FUNCTION_LABEL[hover.fn]} · {LAYER_LABEL[hover.layer]}</p>
              <p style={{ color: 'rgba(255,255,255,0.65)' }}>{hoverCount} {hoverCount === 1 ? 'entry' : 'entries'}</p>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex-1 min-w-0 space-y-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: '#7EC8E3' }}>Capability layers · inner → outer</p>
            <div className="space-y-1.5">
              {CAPABILITY_LAYERS.map(layer => {
                const Icon = LAYER_ICON[layer]
                return (
                  <div key={layer} className="flex items-center gap-2">
                    <Icon size={13} style={{ color: '#7EC8E3', flexShrink: 0 }} />
                    <span className="text-[12px] font-semibold" style={{ color: '#fff' }}>{LAYER_LABEL[layer]}</span>
                    <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>— {LAYER_DESCRIPTION[layer]}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: '#7EC8E3' }}>Business functions</p>
            <div className="grid grid-cols-2 gap-1.5">
              {BUSINESS_FUNCTIONS.map(fn => (
                <div key={fn} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: FUNCTION_HUE[fn] }} />
                  <span className="text-[12px]" style={{ color: '#fff' }}>{FUNCTION_LABEL[fn]}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Click a cell to see the underlying change-log entries. Every entry is classified automatically — nothing here is hand-tagged.
          </p>
        </div>
      </div>
    </div>
  )
}
