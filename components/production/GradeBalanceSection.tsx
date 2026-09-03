'use client'

// components/production/GradeBalanceSection.tsx
//
// The "Grade flow & balance" tab of the production dashboard — reconciles what
// the floor produces against what Acumatica holds in stock, grade by grade:
//   raw material → produced (floor output) → stock on hand (Acumatica) → sold.
//
// Data:
//   • /api/production/grade-balance — SOH by grade family + ageing (from
//     acumatica.lot_details, BHW). The Acumatica "book" side.
//   • outputMix (passed in) — floor output by product this window
//     (v_output_stream, via /api/production/yield-analytics). The floor side.
//
// The Balance Index uses a PROVISIONAL default target mix (clearly labelled)
// until the real yield split from the costing / WaardeModel is wired in.

import { useEffect, useMemo, useState, type ReactElement } from 'react'

const C = { brand: '#1A3A0E', accent: '#5A8A2A', azure: '#2A7CB8', warn: '#B85C0A', err: '#B81C1C', ok: '#1A7A3C', gray: '#96A88A' }

// Provisional target share (%) per grade family — PLACEHOLDER until the costing
// yield model is available. Normalised over the families actually in stock.
const TARGET_MIX: Record<string, number> = {
  Leaf: 30, Dust: 12, Granules: 10, Blend: 15, Finished: 18, 'Raw Dry': 12, 'Raw Wet': 3,
}

interface Grade { group: string; sohKg: number; lots: number; sharePct: number; oldestYear: number | null }
interface Ageing { year: string; kg: number }
interface BalanceData {
  warehouse: string; totalSoh: number; agedKg: number; agedPct: number
  grades: Grade[]; ageing: Ageing[]; lotCount: number; syncedAt: string | null
}
interface OutputMixRow { productType: string; kg: number; sharePct: number | null }

const kg0 = (v: number) => Math.round(v).toLocaleString()
const pct0 = (v: number) => `${Math.round(v * 100)}%`

function Tile({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub?: string; tone?: 'warn' | 'ok' }) {
  const color = tone === 'warn' ? C.warn : tone === 'ok' ? C.ok : undefined
  return (
    <div className="rounded-xl border border-surface-rule bg-surface-card p-3.5">
      <div className="text-[11.5px] text-text-muted mb-1.5">{label}</div>
      <div className="text-[22px] font-semibold tracking-tight" style={{ color: color ?? 'var(--text)' }}>
        {value}{unit && <span className="text-[13px] font-normal text-text-muted"> {unit}</span>}
      </div>
      {sub && <div className="text-[11.5px] text-text-faint mt-0.5">{sub}</div>}
    </div>
  )
}

export default function GradeBalanceSection({ outputMix }: { outputMix: OutputMixRow[] }) {
  const [data, setData] = useState<BalanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch('/api/production/grade-balance')
      .then(r => r.json())
      .then(d => { if (cancelled) return; if (d.error) setError(d.error); else setData(d) })
      .catch(() => { if (!cancelled) setError('Could not load stock data.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Balance index + per-grade target/divergence (provisional target).
  const balance = useMemo(() => {
    if (!data || data.totalSoh <= 0) return null
    const present = data.grades
    const rawTargets = present.map(g => TARGET_MIX[g.group] ?? 5)
    const targetSum = rawTargets.reduce((a, b) => a + b, 0) || 1
    const rows = present.map((g, i) => {
      const target = rawTargets[i] / targetSum      // 0–1
      const actual = g.sharePct                      // 0–1
      return { ...g, target, actual, diff: actual - target }   // diff>0 = over-stocked (accumulating)
    })
    const tvd = rows.reduce((a, r) => a + Math.abs(r.actual - r.target), 0) / 2
    const index = Math.max(0, Math.min(1, 1 - tvd))
    return { rows, index }
  }, [data])

  const floorTotal = useMemo(() => outputMix.reduce((a, m) => a + m.kg, 0), [outputMix])

  if (loading) return <div className="card p-8 text-center text-[12px] text-text-muted">Loading stock &amp; balance…</div>
  if (error) return (
    <div className="card p-6 text-center">
      <p className="text-[13px] text-text">Stock data unavailable — {error}</p>
      <p className="text-[11.5px] text-text-faint mt-1">Run migration <code>20260902_002</code> and trigger <code>/api/acumatica/sync-lots</code> to populate <code>acumatica.lot_details</code>.</p>
    </div>
  )
  if (!data || data.totalSoh <= 0) return (
    <div className="card p-6 text-center">
      <p className="text-[13px] text-text">No stock on hand yet for {data?.warehouse ?? 'BHW'}.</p>
      <p className="text-[11.5px] text-text-faint mt-1">Trigger <code>/api/acumatica/sync-lots</code> to pull lot details from Acumatica.</p>
    </div>
  )

  const maxGrade = Math.max(...data.grades.map(g => g.sohKg), 1)

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Stock on hand" value={kg0(data.totalSoh)} unit="kg" sub={`${data.lotCount} lots · ${data.warehouse}`} />
        <Tile label="Aged stock" value={kg0(data.agedKg)} unit="kg" sub={`${pct0(data.agedPct)} older than last year`} tone={data.agedPct > 0.15 ? 'warn' : undefined} />
        <Tile label="Grade balance index" value={balance ? pct0(balance.index) : '—'} sub="vs provisional target mix" tone={balance && balance.index < 0.7 ? 'warn' : 'ok'} />
        <Tile label="Floor output" value={kg0(floorTotal)} unit="kg" sub="produced this window" />
      </div>

      {/* Balance vs target */}
      {balance && (
        <div className="card p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <h3 className="text-[14.5px] font-semibold text-text">Grade balance — stock mix vs target</h3>
            <span className="text-[11px] text-warn bg-warn/5 border border-warn/20 rounded-md px-2 py-0.5">Target = provisional default — swap for the costing yield model</span>
          </div>
          <p className="text-[11.5px] text-text-muted mb-3">Index {pct0(balance.index)} — how closely stock-on-hand tracks the target mix. Grades <span className="text-warn font-medium">over target</span> are accumulating; <span className="text-ok font-medium">under</span> are depleting.</p>
          <div className="space-y-2">
            {balance.rows.map(r => (
              <div key={r.group} className="flex items-center gap-3">
                <span className="w-[110px] text-[12.5px] text-text truncate">{r.group}</span>
                <div className="flex-1 h-4 bg-surface-dim rounded-full overflow-hidden relative">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.actual * 100)}%`, background: r.diff > 0.03 ? C.warn : r.diff < -0.03 ? C.azure : C.accent }} />
                  {/* target marker */}
                  <div className="absolute top-0 bottom-0 w-[2px] bg-text/50" style={{ left: `${Math.min(100, r.target * 100)}%` }} title={`Target ${pct0(r.target)}`} />
                </div>
                <span className="w-14 text-right text-[11.5px] font-mono text-text">{pct0(r.actual)}</span>
                <span className="w-16 text-right text-[11px] font-mono" style={{ color: r.diff > 0.03 ? C.warn : r.diff < -0.03 ? C.azure : C.gray }}>
                  {r.diff > 0 ? '+' : ''}{Math.round(r.diff * 100)}pp
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* SOH by grade */}
        <div className="card p-4">
          <h3 className="text-[14.5px] font-semibold text-text mb-3">Stock on hand, by grade</h3>
          <div className="space-y-1.5">
            {data.grades.map(g => (
              <div key={g.group} className="flex items-center gap-3 py-0.5">
                <span className="w-[110px] text-[12.5px] text-text truncate">{g.group}</span>
                <div className="flex-1 h-3.5 bg-surface-dim rounded-full overflow-hidden"><div className="h-full rounded-full bg-brand" style={{ width: `${g.sohKg / maxGrade * 100}%` }} /></div>
                <span className="w-16 text-right text-[11px] text-text-faint font-mono">{kg0(g.sohKg)} kg</span>
                <span className="w-10 text-right text-[11px] text-text-faint font-mono">{pct0(g.sharePct)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Floor output mix */}
        <div className="card p-4">
          <h3 className="text-[14.5px] font-semibold text-text mb-3">Floor output mix, this window</h3>
          {outputMix.length === 0 ? <div className="text-[12px] text-text-muted py-4">No output captured for this window.</div> : (
            <div className="space-y-1.5">
              {outputMix.slice(0, 10).map(m => (
                <div key={m.productType} className="flex items-center gap-3 py-0.5">
                  <span className="w-[130px] text-[12.5px] text-text truncate">{m.productType}</span>
                  <div className="flex-1 h-3.5 bg-surface-dim rounded-full overflow-hidden"><div className="h-full rounded-full bg-accent" style={{ width: `${m.sharePct ?? 0}%` }} /></div>
                  <span className="w-16 text-right text-[11px] text-text-faint font-mono">{kg0(m.kg)} kg</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stock ageing — the locked-capital view */}
      <div className="card p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <h3 className="text-[14.5px] font-semibold text-text">Stock ageing, by harvest year</h3>
          <span className="ml-auto text-[11.5px] text-text-faint">Older stock locks up working capital &amp; space</span>
        </div>
        <AgeingChart ageing={data.ageing} />
      </div>
    </div>
  )
}

// ── Ageing bar chart — matches the house SVG chart style ───────────────────────
function AgeingChart({ ageing }: { ageing: Ageing[] }) {
  if (!ageing.length) return <div className="text-center text-[12px] text-text-muted py-8">No ageing data.</div>
  const W = 1180, H = 280, padL = 54, padB = 30, padT = 16, padR = 16
  const innerW = W - padL - padR, innerH = H - padT - padB
  const maxV = Math.max(...ageing.map(a => a.kg)) * 1.15 || 1
  const groupW = innerW / ageing.length, barW = Math.max(14, groupW * 0.5)
  const thisYear = new Date().getFullYear()
  const marks: ReactElement[] = []
  ageing.forEach((a, i) => {
    const gx = padL + groupW * i + (groupW - barW) / 2
    const h = a.kg / maxV * innerH, y = padT + innerH - h
    const yr = Number(a.year)
    const aged = Number.isFinite(yr) && yr < thisYear - 1
    marks.push(
      <g key={a.year}>
        <rect x={gx} y={y} width={barW} height={h} fill={aged ? C.warn : C.accent} rx={2}>
          <title>{`${a.year}: ${kg0(a.kg)} kg`}</title>
        </rect>
        <text x={gx + barW / 2} y={y - 6} textAnchor="middle" fontSize={10.5} fill="var(--text-muted)">{kg0(a.kg)}</text>
        <text x={gx + barW / 2} y={H - 8} textAnchor="middle" fontSize={12} fill={aged ? C.warn : 'var(--text-faint)'} fontWeight={aged ? 600 : 400}>{a.year}</text>
      </g>
    )
  })
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {[0, 1, 2, 3, 4].map(g => { const y = padT + innerH - innerH * g / 4; return <g key={g}><line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--surface-rule)" /><text x={padL - 10} y={y + 4} textAnchor="end" fontSize={12} fill="var(--text-faint)">{kg0(maxV * g / 4)}</text></g> })}
      {marks}
    </svg>
  )
}
