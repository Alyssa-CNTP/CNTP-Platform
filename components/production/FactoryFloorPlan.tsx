'use client'

// components/production/FactoryFloorPlan.tsx
// The accurate, dimensioned factory floor plan for the Production section — drawn
// as a clean facility map (building shell, tinted Rooibos/Rosehips zones, doors
// and the Packaging area, bays to scale with their kg capacities). Data comes
// from the real insurance plan (lib/home/floorplan-data). A live layer from
// /api/home/overview marks running sections + open breakdowns by zone.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Activity, Wrench, Package, MapPin, DoorOpen } from 'lucide-react'
import { BAYS, FLOOR_LABELS, FLOOR_W, FLOOR_H } from '@/lib/home/floorplan-data'

const ROOIBOS_STROKE = '#a3a988'
const ROSEHIPS_STROKE = '#c79320'
const ROSEHIPS_TINT = '#e0a500'
const ROOIBOS_TINT = '#cfd4c8'
const DOWN = '#dc2626'

interface Section { id: string; name: string; code: string; color: string; status: string }
interface Breakdown { card: string; area: string; machine: string | null; status: string; raisedAt: string }
interface Overview { date: string; sections: Section[]; runningCount: number; breakdowns: Breakdown[] }

const STATUS_LABEL: Record<string, string> = { draft: 'Capturing', submitted: 'Submitted', approved: 'Signed off' }

function locate(area: string, machine: string | null, i: number): { x: number; y: number } {
  const t = `${area} ${machine ?? ''}`.toLowerCase()
  const jitter = (i % 4) * 220 - 330
  if (t.includes('pack')) return { x: 3100 + jitter, y: 3650 }
  if (t.includes('rose')) return { x: 800, y: 1900 + jitter }
  if (/(store|warehouse|forklift|racking|\bbay\b|pallet)/.test(t)) return { x: 4800 + jitter, y: 1750 }
  return { x: 7180 + jitter, y: 850 }
}

const fmt = (n: number) => n.toLocaleString('en-ZA')

export function FactoryFloorPlan() {
  const [ov, setOv] = useState<Overview | null>(null)
  const [hover, setHover] = useState<{ cap: number; rose: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => fetch('/api/home/overview').then(r => r.json()).then(j => { if (alive && !j.error) setOv(j) }).catch(() => {})
    load()
    timer.current = setInterval(load, 90_000)
    return () => { alive = false; if (timer.current) clearInterval(timer.current) }
  }, [])

  const { cap, roseBox } = useMemo(() => {
    let total = 0, rose = 0, nRose = 0
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const b of BAYS) {
      total += b[4]
      if (b[5]) {
        rose += b[4]; nRose++
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[0] + b[2]); y1 = Math.max(y1, b[1] + b[3])
      }
    }
    return {
      cap: { total, rose, rooibos: total - rose, nRose },
      roseBox: { x: x0 - 80, y: y0 - 80, w: x1 - x0 + 160, h: y1 - y0 + 160 },
    }
  }, [])

  const running = ov?.sections.filter(s => s.status === 'draft') ?? []
  const breakdowns = ov?.breakdowns ?? []
  const pins = breakdowns.map((b, i) => ({ ...b, ...locate(b.area, b.machine, i) }))
  const pad = 220

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-display font-bold text-[15px] text-text flex items-center gap-2"><MapPin size={15} className="text-brand" /> Factory floor plan</h3>
          <p className="text-[12px] text-text-muted mt-0.5">Accurate storage layout · {(FLOOR_W / 100).toFixed(0)} m × {(FLOOR_H / 100).toFixed(0)} m footprint · live activity</p>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <span className="inline-flex items-center gap-1.5 text-text-muted"><Activity size={13} className="text-ok" /> {running.length} running</span>
          <span className="inline-flex items-center gap-1.5 text-text-muted"><Wrench size={13} className={breakdowns.length ? 'text-err' : 'text-text-faint'} /> {breakdowns.length} breakdown{breakdowns.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {/* Capacity summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Stat label="Total capacity" value={`${fmt(cap.total)} kg`} />
        <Stat label="Rooibos" value={`${fmt(cap.rooibos)} kg`} dot={ROOIBOS_TINT} />
        <Stat label="Rosehips" value={`${fmt(cap.rose)} kg`} dot={ROSEHIPS_TINT} />
        <Stat label="Storage bays" value={String(BAYS.length)} />
      </div>

      {/* Map */}
      <div className="rounded-xl border border-surface-rule p-2 overflow-hidden" style={{ background: '#eceadf' }}>
        <svg viewBox={`${-pad} ${-pad} ${FLOOR_W + pad * 2} ${FLOOR_H + pad * 2}`}
          preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto', display: 'block' }}
          role="img" aria-label="Factory storage floor plan with live activity">
          <defs>
            <linearGradient id="ffRoo" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e6e8d9" /><stop offset="1" stopColor="#cbd1b6" />
            </linearGradient>
            <linearGradient id="ffRose" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f6d36c" /><stop offset="1" stopColor="#e6b13a" />
            </linearGradient>
            <filter id="ffShadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="34" stdDeviation="34" floodColor="#1a2415" floodOpacity="0.10" />
            </filter>
          </defs>

          {/* Building shell */}
          <rect x={0} y={0} width={FLOOR_W} height={FLOOR_H} rx={70} fill="#f7f6f0" stroke="#b8a988" strokeWidth={40} filter="url(#ffShadow)" />

          {/* Rosehips zone tint */}
          <rect x={roseBox.x} y={roseBox.y} width={roseBox.w} height={roseBox.h} rx={50}
            fill="#f9edca" stroke="#dcb854" strokeWidth={10} strokeDasharray="46 34" />
          <text x={roseBox.x + roseBox.w / 2} y={roseBox.y - 70} fontSize={150} fontWeight={600} fill="#9c7c1c" textAnchor="middle">Rosehips</text>
          <text x={9200} y={1320} fontSize={170} fontWeight={600} fill="#7d8568" textAnchor="middle" opacity={0.65}>Rooibos storage</text>

          {/* Bays */}
          {BAYS.map((b, i) => {
            const on = hover && hover.cap === b[4]
            return (
              <rect key={i} x={b[0]} y={b[1]} width={b[2]} height={b[3]} rx={12}
                fill={b[5] ? 'url(#ffRose)' : 'url(#ffRoo)'} stroke={b[5] ? ROSEHIPS_STROKE : ROOIBOS_STROKE}
                strokeWidth={on ? 28 : 5} style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover({ cap: b[4], rose: !!b[5] })} onMouseLeave={() => setHover(null)} />
            )
          })}

          {/* Doors + Packaging labels */}
          {FLOOR_LABELS.map((l, i) => {
            const door = /door/i.test(l[2])
            return (
              <g key={i}>
                {door && <rect x={l[0] - 20} y={l[1] - 150} width={170} height={50} rx={10} fill="#9aa6b3" />}
                <text x={l[0] - 20} y={l[1] - 200} fontSize={130} fill="#5d6b52" fontWeight={500}>{l[2]}</text>
              </g>
            )
          })}

          {/* Breakdown markers */}
          {pins.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={130} fill={DOWN} stroke="#fff" strokeWidth={20} />
              <circle cx={p.x} cy={p.y} r={130} fill="none" stroke={DOWN} strokeWidth={26}>
                <animate attributeName="r" values="130;400" dur="1.7s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8;0" dur="1.7s" repeatCount="indefinite" />
              </circle>
            </g>
          ))}
        </svg>
      </div>

      {/* Hover readout + legend */}
      <div className="flex items-center justify-between gap-3 flex-wrap mt-2 text-[12px]">
        <div className="text-text-muted min-h-[18px]">
          {hover
            ? <span className="inline-flex items-center gap-1.5"><Package size={13} /> {hover.rose ? 'Rosehips' : 'Rooibos'} bay · <strong className="text-text">{fmt(hover.cap)} kg</strong></span>
            : <span className="text-text-faint">Hover a bay for its capacity</span>}
        </div>
        <div className="flex items-center gap-3 text-text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: ROOIBOS_TINT }} /> Rooibos</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: ROSEHIPS_TINT }} /> Rosehips</span>
          <span className="inline-flex items-center gap-1.5"><DoorOpen size={13} /> Door</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: DOWN }} /> Breakdown</span>
        </div>
      </div>

      {/* Live activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 pt-4 border-t border-surface-rule">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-text-muted mb-2">Sections active today</div>
          {(!ov || ov.sections.length === 0)
            ? <div className="text-[12px] text-text-faint">{ov ? 'Nothing running yet today.' : 'Loading…'}</div>
            : (
              <div className="flex flex-wrap gap-2">
                {ov.sections.map(s => (
                  <span key={s.id} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-rule px-2.5 py-1 text-[12px]">
                    <span className="w-2 h-2 rounded-full" style={{ background: s.status === 'draft' ? '#1A7A3C' : s.color }} />
                    <span className="font-medium text-text">{s.name}</span>
                    <span className="text-text-faint">{STATUS_LABEL[s.status] ?? s.status}</span>
                  </span>
                ))}
              </div>
            )}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-text-muted mb-2">Open breakdowns</div>
          {breakdowns.length === 0
            ? <div className="text-[12px] text-text-faint">{ov ? 'All clear — no open breakdowns.' : 'Loading…'}</div>
            : (
              <div className="space-y-1.5">
                {breakdowns.slice(0, 5).map(b => (
                  <Link key={b.card} href="/maintenance/job-cards"
                    className="flex items-center justify-between rounded-lg border border-err/20 bg-err/5 px-2.5 py-1.5 hover:border-err/40 transition">
                    <span className="text-[12px] text-text font-medium truncate">{b.area}{b.machine ? ` · ${b.machine}` : ''}</span>
                    <span className="text-[10px] text-err capitalize ml-2 shrink-0">{b.status}</span>
                  </Link>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="bg-surface-dim/50 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5">
        {dot && <span className="w-2 h-2 rounded-sm inline-block" style={{ background: dot }} />}
        <span className="text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
      </div>
      <div className="text-[15px] font-semibold text-text mt-0.5 tabular-nums">{value}</div>
    </div>
  )
}
