'use client'

// components/home/FactoryFloorPlan.tsx
// The smart factory floor plan for the home page. The layout is the REAL
// warehouse plan (auto-derived from the insurance spreadsheet — see
// lib/home/floorplan-data.ts), drawn to scale: Rooibos vs Rosehips storage
// bays with their kg capacities, doors and the Packaging area.
//
// Over the top sits a live "what's happening" layer from /api/home/overview:
// which sections are running today and any open breakdowns, marked on the map.
// This is a STORAGE plan, so production-line breakdowns can't be placed exactly
// — markers are positioned by zone (approx) and every item is also listed.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Activity, Wrench, Package, MapPin } from 'lucide-react'
import { BAYS, FLOOR_LABELS, FLOOR_W, FLOOR_H } from '@/lib/home/floorplan-data'

const ROOIBOS = '#cfd4c8'
const ROOIBOS_STROKE = '#9aa090'
const ROSEHIPS = '#e0a500'
const ROSEHIPS_STROKE = '#a87b00'
const WALL = '#8b95a3'
const DOWN = '#dc2626'

interface Section { id: string; name: string; code: string; color: string; status: string }
interface Breakdown { card: string; area: string; machine: string | null; status: string; raisedAt: string }
interface Overview { date: string; sections: Section[]; runningCount: number; breakdowns: Breakdown[] }

const STATUS_LABEL: Record<string, string> = { draft: 'Capturing', submitted: 'Submitted', approved: 'Signed off' }

// Place a breakdown roughly by zone keyword. This is a storage plan, so the
// production line isn't drawn on it — production breakdowns cluster near the
// main door. Returns approx=false only for areas actually on the plan.
function locate(area: string, machine: string | null, i: number): { x: number; y: number; approx: boolean } {
  const t = `${area} ${machine ?? ''}`.toLowerCase()
  const jitter = (i % 4) * 220 - 330
  if (t.includes('pack')) return { x: 3100 + jitter, y: 3550, approx: false }
  if (t.includes('rose')) return { x: 800, y: 1900 + jitter, approx: false }
  if (/(store|warehouse|forklift|racking|\bbay\b|pallet)/.test(t)) return { x: 4800 + jitter, y: 1750, approx: false }
  return { x: 7180 + jitter, y: 850, approx: true } // production line → near main door
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

  const cap = useMemo(() => {
    let total = 0, rose = 0, nRose = 0
    for (const b of BAYS) { total += b[4]; if (b[5]) { rose += b[4]; nRose++ } }
    return { total, rose, rooibos: total - rose, nRose, nRooibos: BAYS.length - nRose }
  }, [])

  const running = ov?.sections.filter(s => s.status === 'draft') ?? []
  const breakdowns = ov?.breakdowns ?? []
  const pins = breakdowns.map((b, i) => ({ ...b, ...locate(b.area, b.machine, i) }))

  const pad = 160

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-display font-bold text-[15px] text-text flex items-center gap-2"><MapPin size={15} className="text-brand" /> Factory floor</h3>
          <p className="text-[12px] text-text-muted mt-0.5">Live storage layout · what's happening right now</p>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <span className="inline-flex items-center gap-1.5 text-text-muted"><Activity size={13} className="text-ok" /> {running.length} running</span>
          <span className="inline-flex items-center gap-1.5 text-text-muted"><Wrench size={13} className={breakdowns.length ? 'text-err' : 'text-text-faint'} /> {breakdowns.length} breakdown{breakdowns.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {/* Capacity summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Stat label="Total capacity" value={`${fmt(cap.total)} kg`} />
        <Stat label="Rooibos" value={`${fmt(cap.rooibos)} kg`} dot={ROOIBOS} />
        <Stat label="Rosehips" value={`${fmt(cap.rose)} kg`} dot={ROSEHIPS} />
        <Stat label="Storage bays" value={String(BAYS.length)} />
      </div>

      {/* Map */}
      <div className="rounded-xl border border-surface-rule bg-surface-dim/40 p-2 overflow-hidden">
        <svg viewBox={`${-pad} ${-pad} ${FLOOR_W + pad * 2} ${FLOOR_H + pad * 2}`}
          preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto', display: 'block' }}
          role="img" aria-label="Factory storage floor plan with live activity">
          <rect x={0} y={0} width={FLOOR_W} height={FLOOR_H} fill="none" stroke={WALL} strokeWidth={30} rx={20} />
          {BAYS.map((b, i) => (
            <rect key={i} x={b[0]} y={b[1]} width={b[2]} height={b[3]} rx={8}
              fill={b[5] ? ROSEHIPS : ROOIBOS} stroke={b[5] ? ROSEHIPS_STROKE : ROOIBOS_STROKE}
              strokeWidth={hover && hover.cap === b[4] ? 24 : 6} style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover({ cap: b[4], rose: !!b[5] })}
              onMouseLeave={() => setHover(null)} />
          ))}
          {FLOOR_LABELS.map((l, i) => (
            <text key={i} x={l[0]} y={l[1] - 40} fontSize={150} fill={WALL}>{l[2]}</text>
          ))}
          {/* Breakdown markers */}
          {pins.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={120} fill={DOWN} />
              <circle cx={p.x} cy={p.y} r={120} fill="none" stroke={DOWN} strokeWidth={26}>
                <animate attributeName="r" values="120;380" dur="1.7s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.85;0" dur="1.7s" repeatCount="indefinite" />
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
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: ROOIBOS }} /> Rooibos</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: ROSEHIPS }} /> Rosehips</span>
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
