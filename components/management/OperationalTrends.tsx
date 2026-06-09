'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { getDb } from '@/lib/supabase/db'
import { format, subMonths, startOfMonth, subDays, subWeeks, parseISO } from 'date-fns'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, Brush, Cell,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Minus, Sparkles, RefreshCw,
  Filter, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Info,
} from 'lucide-react'

// ── Colour palette (brand-aligned) ───────────────────────────────────────────
const SECTION_COLOURS: Record<string, string> = {
  sieving:      '#1A7A3C',
  refining1:    '#2A7CB8',
  refining2:    '#5A8A2A',
  granule:      '#B85C0A',
  blender:      '#7C3A8A',
  smallblender: '#2A8A7C',
  pasteuriser:  '#B81C1C',
  'rh-f':       '#3A6A9C',
  'rh-p':       '#9C6A3A',
  'rh-k':       '#6A9C3A',
  'rh-w':       '#9C3A6A',
}
const COLOUR_POOL = [
  '#1A7A3C','#2A7CB8','#5A8A2A','#B85C0A','#7C3A8A',
  '#2A8A7C','#B81C1C','#3A6A9C','#9C6A3A','#6A9C3A',
]
function sectionColour(id: string, index: number) {
  return SECTION_COLOURS[id] ?? COLOUR_POOL[index % COLOUR_POOL.length]
}

const SECTION_LABELS: Record<string, string> = {
  sieving:      'Sieving Tower',
  refining1:    'Refining 1',
  refining2:    'Refining 2',
  granule:      'Granule Line',
  blender:      'Blender',
  smallblender: 'Small Blender',
  pasteuriser:  'Pasteuriser',
  'rh-f':       'Rosehip Fine',
  'rh-p':       'Rosehip Powder',
  'rh-k':       'Rosehip K',
  'rh-w':       'Rosehip Whole',
}

function sLabel(id: string) { return SECTION_LABELS[id] ?? id }

// ── Helpers ───────────────────────────────────────────────────────────────────
function pct(a: number, b: number) {
  if (b === 0) return null
  return ((a - b) / b) * 100
}
function fmtKg(v: number) {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}t`
  return `${Math.round(v).toLocaleString()}kg`
}
function calcTrend(values: number[]): 'up' | 'down' | 'stable' {
  if (values.length < 2) return 'stable'
  const last = values[values.length - 1], prev = values[values.length - 2]
  const d = prev > 0 ? (last - prev) / prev * 100 : 0
  return d > 5 ? 'up' : d < -5 ? 'down' : 'stable'
}
function rollingAvg(values: number[], window: number) {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1)
    return slice.reduce((s, v) => s + v, 0) / slice.length
  })
}

// ── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, trend, colour,
}: {
  label: string; value: string; sub?: string; trend?: 'up'|'down'|'stable'|null; colour?: string
}) {
  const trendIcon = trend === 'up'
    ? <TrendingUp size={13} style={{ color: '#1A7A3C' }} />
    : trend === 'down'
    ? <TrendingDown size={13} style={{ color: '#B81C1C' }} />
    : trend === 'stable'
    ? <Minus size={13} style={{ color: '#637056' }} />
    : null

  return (
    <div style={{
      background: '#FFFFFF',
      border: '1px solid #E4E7EC',
      borderRadius: 12,
      padding: '16px 20px',
      flex: 1,
      minWidth: 0,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      <div style={{ fontSize: 11, color: '#637056', fontWeight: 500, marginBottom: 4, letterSpacing: '0.02em' }}>
        {label}
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 700,
        color: colour ?? '#1A2415',
        lineHeight: 1.2,
        letterSpacing: '-0.02em',
      }}>
        {value}
      </div>
      {(sub || trendIcon) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          {trendIcon}
          {sub && <span style={{ fontSize: 11, color: '#637056' }}>{sub}</span>}
        </div>
      )}
    </div>
  )
}

// ── Trend badge ───────────────────────────────────────────────────────────────
function Delta({ v }: { v: number | null }) {
  if (v === null) return <span style={{ color: '#96A88A', fontSize: 11 }}>—</span>
  const pos = v >= 0
  return (
    <span style={{
      fontSize: 11, fontWeight: 600,
      color: pos ? '#1A7A3C' : '#B81C1C',
      background: pos ? '#EDFAF3' : '#FEF2F2',
      padding: '2px 6px', borderRadius: 4,
    }}>
      {pos ? '+' : ''}{v.toFixed(1)}%
    </span>
  )
}

// ── Custom Recharts tooltip ───────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, unit = 'kg' }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #E4E7EC',
      borderRadius: 10,
      padding: '10px 14px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      fontSize: 12,
      minWidth: 140,
    }}>
      <div style={{ fontWeight: 600, color: '#1A2415', marginBottom: 6, fontSize: 12 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
          <span style={{ color: p.color ?? '#637056' }}>{p.name}</span>
          <span style={{ fontWeight: 600, color: '#1A2415' }}>
            {unit === 'kg' ? fmtKg(p.value ?? 0) : `${(p.value ?? 0).toFixed(1)}${unit}`}
          </span>
        </div>
      ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// YIELD ANALYTICS TAB
// ══════════════════════════════════════════════════════════════════════════════
function YieldAnalytics({ dateFrom }: { dateFrom: string }) {
  const db = getDb()
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart')
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set())

  useEffect(() => { load() }, [dateFrom])

  async function load() {
    setLoading(true)
    const { data } = await db
      .schema('production')
      .from('bag_tags')
      .select('section_id, weight_kg, tag_date')
      .gte('tag_date', dateFrom)
      .not('weight_kg', 'is', null)
    setRows(data ?? [])
    setLoading(false)
  }

  const { months, sections, chartData, kpis } = useMemo(() => {
    const months: string[] = []
    for (let i = 5; i >= 0; i--)
      months.push(format(startOfMonth(subMonths(new Date(), i)), 'yyyy-MM'))

    const agg: Record<string, Record<string, number>> = {}
    for (const r of rows) {
      const month = (r.tag_date as string).slice(0, 7)
      const sid = r.section_id as string
      if (!agg[sid]) agg[sid] = {}
      agg[sid][month] = (agg[sid][month] ?? 0) + (r.weight_kg ?? 0)
    }

    const sections = Object.entries(agg).map(([id, mm]) => {
      const values = months.map(m => mm[m] ?? 0)
      const total = values.reduce((s, v) => s + v, 0)
      const trend = calcTrend(values.filter(v => v > 0))
      const thisMo = values[values.length - 1]
      const prevMo = values[values.length - 2]
      return { id, label: sLabel(id), values, total, trend, thisMo, prevMo }
    }).sort((a, b) => b.total - a.total)

    const chartData = months.map((m, mi) => {
      const entry: Record<string, any> = { month: format(parseISO(m + '-01'), 'MMM yy') }
      for (const s of sections) entry[s.id] = s.values[mi]
      return entry
    })

    const totalThisMo = sections.reduce((s, x) => s + x.thisMo, 0)
    const totalPrevMo = sections.reduce((s, x) => s + x.prevMo, 0)
    const bestSection = [...sections].sort((a, b) => b.thisMo - a.thisMo)[0]
    const worstTrend  = sections.find(s => s.trend === 'down')

    return { months, sections, chartData, kpis: { totalThisMo, totalPrevMo, bestSection, worstTrend } }
  }, [rows])

  if (loading) return <Skeleton label="Calculating yield analytics…" />

  if (!sections.length) return <Empty label="No bag-tag data for this period." />

  const visible = selectedSections.size ? sections.filter(s => selectedSections.has(s.id)) : sections
  const momDelta = pct(kpis.totalThisMo, kpis.totalPrevMo)

  function toggleSection(id: string) {
    setSelectedSections(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 12 }}>
        <KpiCard label="This Month Output" value={fmtKg(kpis.totalThisMo)} sub={`vs ${fmtKg(kpis.totalPrevMo)} prev`} trend={momDelta !== null ? (momDelta > 0 ? 'up' : momDelta < 0 ? 'down' : 'stable') : null} />
        <KpiCard label="Month-on-Month" value={momDelta !== null ? `${momDelta >= 0 ? '+' : ''}${momDelta.toFixed(1)}%` : '—'} colour={momDelta !== null && momDelta >= 0 ? '#1A7A3C' : '#B81C1C'} />
        <KpiCard label="Top Section" value={kpis.bestSection?.label ?? '—'} sub={kpis.bestSection ? fmtKg(kpis.bestSection.thisMo) + ' this month' : undefined} />
        <KpiCard label="Declining Sections" value={String(sections.filter(s => s.trend === 'down').length)} colour={sections.filter(s => s.trend === 'down').length > 0 ? '#B85C0A' : '#1A7A3C'} sub="vs previous month" />
      </div>

      {/* Section filter pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#637056', marginRight: 4 }}>Filter:</span>
        {sections.map((s, i) => {
          const active = selectedSections.has(s.id)
          const col = sectionColour(s.id, i)
          return (
            <button
              key={s.id}
              onClick={() => toggleSection(s.id)}
              style={{
                padding: '3px 10px',
                borderRadius: 20,
                border: `1px solid ${active ? col : '#E4E7EC'}`,
                background: active ? col : 'transparent',
                color: active ? '#fff' : '#4B5563',
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 120ms',
              }}
            >
              {s.label}
            </button>
          )
        })}
        {selectedSections.size > 0 && (
          <button
            onClick={() => setSelectedSections(new Set())}
            style={{ fontSize: 11, color: '#637056', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Clear
          </button>
        )}
      </div>

      {/* View toggle */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['chart', 'table'] as const).map(v => (
          <button
            key={v}
            onClick={() => setViewMode(v)}
            style={{
              padding: '5px 14px',
              borderRadius: 8,
              border: '1px solid #E4E7EC',
              background: viewMode === v ? '#1A2415' : '#fff',
              color: viewMode === v ? '#fff' : '#4B5563',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {v === 'chart' ? 'Chart' : 'Comparison Table'}
          </button>
        ))}
      </div>

      {viewMode === 'chart' ? (
        <div style={{ background: '#fff', border: '1px solid #E4E7EC', borderRadius: 12, padding: '20px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1A2415', marginBottom: 4 }}>Monthly Output by Section (kg)</div>
          <div style={{ fontSize: 11, color: '#637056', marginBottom: 16 }}>Stacked area · last 6 months</div>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
              <defs>
                {visible.map((s, i) => (
                  <linearGradient key={s.id} id={`grad-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={sectionColour(s.id, i)} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={sectionColour(s.id, i)} stopOpacity={0.04} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#637056' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: '#637056' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}t` : `${v}kg`}
                width={48}
              />
              <Tooltip content={<ChartTooltip unit="kg" />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              {visible.map((s, i) => (
                <Area
                  key={s.id}
                  type="monotone"
                  dataKey={s.id}
                  name={s.label}
                  stroke={sectionColour(s.id, i)}
                  strokeWidth={2}
                  fill={`url(#grad-${s.id})`}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E4E7EC', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E4E7EC', background: '#F9FAFB' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#637056', fontSize: 11 }}>Section</th>
                {months.map(m => (
                  <th key={m} style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#637056', fontSize: 11 }}>
                    {format(parseISO(m + '-01'), 'MMM yy')}
                  </th>
                ))}
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#637056', fontSize: 11 }}>MoM Δ</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#637056', fontSize: 11 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s, i) => {
                const mom = pct(s.thisMo, s.prevMo)
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #F0F2F5' }}>
                    <td style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: sectionColour(s.id, i), flexShrink: 0 }} />
                      <span style={{ fontWeight: 500, color: '#1A2415' }}>{s.label}</span>
                    </td>
                    {s.values.map((v, mi) => (
                      <td key={mi} style={{ padding: '10px 12px', textAlign: 'right', color: v > 0 ? '#1A2415' : '#96A88A', fontWeight: mi === s.values.length - 1 ? 700 : 400 }}>
                        {v > 0 ? fmtKg(v) : '—'}
                      </td>
                    ))}
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}><Delta v={mom} /></td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#1A2415' }}>{fmtKg(s.total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ padding: '8px 16px', fontSize: 10, color: '#96A88A', borderTop: '1px solid #F0F2F5' }}>
            MoM Δ = month-on-month % change from previous to current month · kg output from bag tags
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// COUNT RELIABILITY TAB
// ══════════════════════════════════════════════════════════════════════════════
function CountReliabilityAnalytics({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const db = getDb()
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => { load() }, [dateFrom, dateTo])

  async function load() {
    setLoading(true)
    const { data } = await db
      .from('sc_sessions')
      .select('id,count_date,sup_name,adm_name,match_rate_pct')
      .gte('count_date', dateFrom)
      .lte('count_date', dateTo)
      .not('match_rate_pct', 'is', null)
    setSessions(data ?? [])
    setLoading(false)
  }

  const { ranked, timelineData, avgRate } = useMemo(() => {
    const people: Record<string, { name: string; role: string; rates: { date: string; rate: number }[] }> = {}
    for (const s of sessions) {
      const rate = s.match_rate_pct as number
      const date = s.count_date as string
      if (s.sup_name) {
        people[s.sup_name] ??= { name: s.sup_name, role: 'Supervisor', rates: [] }
        people[s.sup_name].rates.push({ date, rate })
      }
      if (s.adm_name && s.adm_name !== s.sup_name) {
        people[s.adm_name] ??= { name: s.adm_name, role: 'Admin', rates: [] }
        people[s.adm_name].rates.push({ date, rate })
      }
    }

    const ranked = Object.values(people).map(p => {
      const sorted    = [...p.rates].sort((a, b) => a.date.localeCompare(b.date))
      const rateVals  = sorted.map(r => r.rate)
      const avg       = rateVals.reduce((s, r) => s + r, 0) / rateVals.length
      const half      = Math.floor(rateVals.length / 2)
      const firstAvg  = half > 0 ? rateVals.slice(0, half).reduce((s, r) => s + r, 0) / half : avg
      const lastAvg   = rateVals.slice(half).reduce((s, r) => s + r, 0) / (rateVals.length - half)
      const trend     = lastAvg > firstAvg + 2 ? 'up' : lastAvg < firstAvg - 2 ? 'down' : 'stable'
      const rolling   = rollingAvg(rateVals, 3)
      return { ...p, avg, trend, count: rateVals.length, rateVals, rolling, sorted }
    }).sort((a, b) => b.avg - a.avg)

    const avgRate = ranked.length ? ranked.reduce((s, p) => s + p.avg, 0) / ranked.length : 0

    // Build timeline (sessions sorted by date for the chart)
    const sortedSessions = [...sessions].sort((a, b) => a.count_date.localeCompare(b.count_date))
    const timelineData = sortedSessions.map(s => ({
      date: format(parseISO(s.count_date), 'dd MMM'),
      rate: s.match_rate_pct,
      name: s.sup_name ?? s.adm_name ?? 'Unknown',
    }))

    return { ranked, timelineData, avgRate }
  }, [sessions])

  if (loading) return <Skeleton label="Calculating reliability scores…" />
  if (!sessions.length) return <Empty label="No completed count sessions in this period." />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 12 }}>
        <KpiCard label="Fleet Average" value={`${avgRate.toFixed(1)}%`} colour={avgRate >= 95 ? '#1A7A3C' : avgRate >= 85 ? '#B85C0A' : '#B81C1C'} />
        <KpiCard label="At or Above 95%" value={String(ranked.filter(p => p.avg >= 95).length)} sub={`of ${ranked.length} counters`} colour="#1A7A3C" />
        <KpiCard label="Below 85%" value={String(ranked.filter(p => p.avg < 85).length)} colour={ranked.filter(p => p.avg < 85).length > 0 ? '#B81C1C' : '#1A7A3C'} sub="need attention" />
        <KpiCard label="Total Sessions" value={String(sessions.length)} sub={`${dateFrom} → ${dateTo}`} />
      </div>

      {/* Timeline chart */}
      <div style={{ background: '#fff', border: '1px solid #E4E7EC', borderRadius: 12, padding: '20px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1A2415', marginBottom: 4 }}>Session Match Rate Over Time</div>
        <div style={{ fontSize: 11, color: '#637056', marginBottom: 16 }}>Each dot = one count session · Reference lines at 95% (target) and 85% (minimum)</div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={timelineData} margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#637056' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis domain={[70, 100]} tick={{ fontSize: 11, fill: '#637056' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={40} />
            <Tooltip content={<ChartTooltip unit="%" />} />
            <ReferenceLine y={95} stroke="#1A7A3C" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: '95% target', position: 'insideTopRight', fontSize: 10, fill: '#1A7A3C' }} />
            <ReferenceLine y={85} stroke="#B85C0A" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: '85% min', position: 'insideTopRight', fontSize: 10, fill: '#B85C0A' }} />
            <Line type="monotone" dataKey="rate" name="Match rate" stroke="#2A7CB8" strokeWidth={1.5} dot={{ r: 3, fill: '#2A7CB8' }} activeDot={{ r: 5 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Per-person bar chart */}
      <div style={{ background: '#fff', border: '1px solid #E4E7EC', borderRadius: 12, padding: '20px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1A2415', marginBottom: 4 }}>Average Match Rate by Counter</div>
        <div style={{ fontSize: 11, color: '#637056', marginBottom: 16 }}>Sorted by accuracy · colour = performance band</div>
        <ResponsiveContainer width="100%" height={Math.max(220, ranked.length * 40)}>
          <BarChart data={ranked.map(p => ({ name: p.name, avg: parseFloat(p.avg.toFixed(1)), sessions: p.count }))} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#637056' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#1A2415' }} axisLine={false} tickLine={false} width={76} />
            <Tooltip content={<ChartTooltip unit="%" />} />
            <ReferenceLine x={95} stroke="#1A7A3C" strokeDasharray="4 3" />
            <ReferenceLine x={85} stroke="#B85C0A" strokeDasharray="4 3" />
            <Bar dataKey="avg" name="Avg match %" radius={[0, 6, 6, 0]} maxBarSize={28}>
              {ranked.map(p => (
                <Cell key={p.name} fill={p.avg >= 95 ? '#1A7A3C' : p.avg >= 85 ? '#B85C0A' : '#B81C1C'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Comparison table */}
      <div style={{ background: '#fff', border: '1px solid #E4E7EC', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E4E7EC', background: '#F9FAFB' }}>
              {['#','Counter','Role','Sessions','Avg Match','Trend','Status'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#637056', fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((p, i) => {
              const scoreCol = p.avg >= 95 ? '#1A7A3C' : p.avg >= 85 ? '#B85C0A' : '#B81C1C'
              const status   = p.avg >= 95 ? 'Excellent' : p.avg >= 85 ? 'Acceptable' : 'Needs review'
              return (
                <tr key={p.name} style={{ borderBottom: '1px solid #F0F2F5' }}>
                  <td style={{ padding: '10px 14px', color: '#96A88A', fontWeight: 600 }}>{i + 1}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1A2415' }}>{p.name}</td>
                  <td style={{ padding: '10px 14px', color: '#637056' }}>{p.role}</td>
                  <td style={{ padding: '10px 14px', color: '#637056' }}>{p.count}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 700, color: scoreCol }}>{p.avg.toFixed(1)}%</td>
                  <td style={{ padding: '10px 14px' }}>
                    {p.trend === 'up' ? <TrendingUp size={13} style={{ color: '#1A7A3C' }} /> : p.trend === 'down' ? <TrendingDown size={13} style={{ color: '#B81C1C' }} /> : <Minus size={13} style={{ color: '#637056' }} />}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: scoreCol + '18', color: scoreCol }}>
                      {status}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// VELOCITY TAB
// ══════════════════════════════════════════════════════════════════════════════
function InventoryVelocityAnalytics() {
  const db = getDb()
  const [bags, setBags]     = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const cutoff = format(subDays(new Date(), 120), 'yyyy-MM-dd')
    const { data } = await db
      .schema('production')
      .from('bag_tags')
      .select('section_id,section_name,lot_number,weight_kg,tag_date,consumed_at_section')
      .gte('tag_date', cutoff)
      .not('weight_kg', 'is', null)
      .limit(1000)
    setBags(data ?? [])
    setLoading(false)
  }

  const { sections, chartData, globalAvg } = useMemo(() => {
    const today = new Date()
    const tagged = bags.map(b => ({
      section: b.section_id as string,
      label:   sLabel(b.section_id as string),
      kg:      (b.weight_kg as number) ?? 0,
      days:    Math.floor((today.getTime() - new Date((b.tag_date as string) + 'T12:00:00').getTime()) / 86_400_000),
      consumed: !!b.consumed_at_section,
    }))

    const unconsumed = tagged.filter(b => !b.consumed)
    const globalAvg  = unconsumed.length
      ? unconsumed.reduce((s, b) => s + b.days, 0) / unconsumed.length
      : 30

    const sids = Array.from(new Set(tagged.map(b => b.section)))
    const sections = sids.map((sid, i) => {
      const items    = tagged.filter(b => b.section === sid)
      const sitting  = items.filter(b => !b.consumed)
      const avgDays  = sitting.length ? sitting.reduce((s, b) => s + b.days, 0) / sitting.length : 0
      const totalKg  = sitting.reduce((s, b) => s + b.kg, 0)
      const ratio    = globalAvg > 0 ? avgDays / globalAvg : 0
      const heat     = ratio < 0.6 ? 'ok' : ratio < 1.2 ? 'neutral' : ratio < 2 ? 'warn' : 'err'
      return { sid, label: sLabel(sid), avgDays, totalKg, count: sitting.length, heat, colour: sectionColour(sid, i) }
    }).filter(s => s.count > 0).sort((a, b) => b.avgDays - a.avgDays)

    const chartData = sections.map(s => ({ name: s.label, days: parseFloat(s.avgDays.toFixed(1)), kg: Math.round(s.totalKg) }))
    return { sections, chartData, globalAvg }
  }, [bags])

  if (loading) return <Skeleton label="Analysing inventory velocity…" />
  if (!sections.length) return <Empty label="No bag data for velocity analysis." />

  const heatColour = { ok: '#1A7A3C', neutral: '#637056', warn: '#B85C0A', err: '#B81C1C' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <KpiCard label="Fleet Average Age" value={`${Math.round(globalAvg)}d`} sub="unconsumed bags" />
        <KpiCard label="Stale Sections" value={String(sections.filter(s => s.heat === 'err').length)} colour={sections.filter(s => s.heat === 'err').length > 0 ? '#B81C1C' : '#1A7A3C'} sub=">200% of average age" />
        <KpiCard label="Fast-Moving" value={String(sections.filter(s => s.heat === 'ok').length)} colour="#1A7A3C" sub="<60% of average age" />
        <KpiCard label="Total Sitting" value={fmtKg(sections.reduce((s, x) => s + x.totalKg, 0))} sub={`${sections.reduce((s, x) => s + x.count, 0)} bags unconsumed`} />
      </div>

      <div style={{ background: '#fff', border: '1px solid #E4E7EC', borderRadius: 12, padding: '20px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1A2415', marginBottom: 4 }}>Average Days Sitting by Section</div>
        <div style={{ fontSize: 11, color: '#637056', marginBottom: 16 }}>Horizontal bar · reference = fleet average ({Math.round(globalAvg)} days)</div>
        <ResponsiveContainer width="100%" height={Math.max(220, sections.length * 44)}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 100 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: '#637056' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}d`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#1A2415' }} axisLine={false} tickLine={false} width={96} />
            <Tooltip content={<ChartTooltip unit="d" />} />
            <ReferenceLine x={globalAvg} stroke="#2A7CB8" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: 'avg', position: 'insideTopRight', fontSize: 10, fill: '#2A7CB8' }} />
            <Bar dataKey="days" name="Avg days" radius={[0, 6, 6, 0]} maxBarSize={28}>
              {sections.map(s => <Cell key={s.sid} fill={heatColour[s.heat as keyof typeof heatColour]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid #E4E7EC', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E4E7EC', background: '#F9FAFB' }}>
              {['Section','Bags Sitting','Total kg','Avg Age','vs Average','Status'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#637056', fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map(s => {
              const col = heatColour[s.heat as keyof typeof heatColour]
              const statusLabel = { ok: 'Fast-moving', neutral: 'Normal', warn: 'Slow', err: 'Stale' }[s.heat]
              const ratio = globalAvg > 0 ? (s.avgDays / globalAvg - 1) * 100 : 0
              return (
                <tr key={s.sid} style={{ borderBottom: '1px solid #F0F2F5' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1A2415' }}>{s.label}</td>
                  <td style={{ padding: '10px 14px', color: '#637056' }}>{s.count}</td>
                  <td style={{ padding: '10px 14px', color: '#637056' }}>{fmtKg(s.totalKg)}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 700, color: col }}>{Math.round(s.avgDays)}d</td>
                  <td style={{ padding: '10px 14px' }}><Delta v={ratio} /></td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: col + '18', color: col }}>
                      {statusLabel}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// GEMINI INSIGHTS PANEL
// ══════════════════════════════════════════════════════════════════════════════
interface InsightData {
  summary: string
  highlights: { type: string; title: string; detail: string }[]
  recommendations: { priority: string; action: string; rationale: string }[]
  yieldInsight: string
  reliabilityInsight: string
  velocityInsight: string
}

function GeminiInsightsPanel({
  yieldData, reliabilityData, velocityData, period,
}: {
  yieldData: any; reliabilityData: any; velocityData: any; period: string
}) {
  const [state, setState]     = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [insights, setInsights] = useState<InsightData | null>(null)
  const [error, setError]     = useState('')
  const [model, setModel]     = useState('')

  async function fetchInsights() {
    setState('loading')
    setError('')
    try {
      const res = await fetch('/api/production/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yieldData, reliabilityData, velocityData, period }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setError(data.error ?? 'Unknown error'); setState('error'); return }
      setInsights(data.insights)
      setModel(data.model ?? '')
      setState('done')
    } catch (e: any) {
      setError(e.message)
      setState('error')
    }
  }

  const highlightIcon = (type: string) =>
    type === 'positive' ? <CheckCircle size={13} style={{ color: '#1A7A3C', flexShrink: 0 }} />
    : type === 'warning' ? <AlertTriangle size={13} style={{ color: '#B85C0A', flexShrink: 0 }} />
    : <AlertTriangle size={13} style={{ color: '#B81C1C', flexShrink: 0 }} />

  const priorityBadge = (p: string) => ({
    high:   { bg: '#FEF2F2', color: '#B81C1C', label: 'High' },
    medium: { bg: '#FEF5ED', color: '#B85C0A', label: 'Medium' },
    low:    { bg: '#EDFAF3', color: '#1A7A3C', label: 'Low' },
  }[p] ?? { bg: '#F0F2F5', color: '#637056', label: p })

  return (
    <div style={{
      background: 'linear-gradient(135deg, #F8F5FF 0%, #F0F7FF 100%)',
      border: '1px solid #DDD5F5',
      borderRadius: 14,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #DDD5F5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sparkles size={16} style={{ color: '#7C3ABB' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#3D1A8A' }}>Gemini AI Analysis</div>
            <div style={{ fontSize: 11, color: '#7C6AAA', marginTop: 1 }}>Operational trend intelligence · {period}</div>
          </div>
        </div>
        <button
          onClick={fetchInsights}
          disabled={state === 'loading'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px',
            borderRadius: 8,
            border: '1px solid #C4AFF0',
            background: state === 'loading' ? '#F0E8FF' : '#7C3ABB',
            color: state === 'loading' ? '#7C3ABB' : '#fff',
            fontSize: 12, fontWeight: 600,
            cursor: state === 'loading' ? 'not-allowed' : 'pointer',
            transition: 'all 120ms',
          }}
        >
          <RefreshCw size={12} style={{ animation: state === 'loading' ? 'spin 1s linear infinite' : 'none' }} />
          {state === 'loading' ? 'Analysing…' : state === 'done' ? 'Refresh Analysis' : 'Get AI Analysis'}
        </button>
      </div>

      {state === 'idle' && (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: '#7C6AAA', fontSize: 12 }}>
          Click <strong>Get AI Analysis</strong> to surface Gemini-powered insights from your current production data.
        </div>
      )}

      {state === 'error' && (
        <div style={{ padding: '16px 20px', color: '#B81C1C', fontSize: 12 }}>
          Failed to load insights: {error}
        </div>
      )}

      {state === 'loading' && (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: '#7C6AAA', fontSize: 12 }}>
          <div style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>Gemini is reading your production data…</div>
        </div>
      )}

      {state === 'done' && insights && (
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Summary */}
          <p style={{ fontSize: 13, color: '#3D1A8A', lineHeight: 1.6, margin: 0 }}>{insights.summary}</p>

          {/* Highlights */}
          {insights.highlights?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#7C6AAA', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Key Findings</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {insights.highlights.map((h, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 14px', background: 'rgba(255,255,255,0.7)', borderRadius: 8, border: '1px solid #E8E0F8' }}>
                    {highlightIcon(h.type)}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1A2415' }}>{h.title}</div>
                      <div style={{ fontSize: 12, color: '#4B5563', marginTop: 2, lineHeight: 1.5 }}>{h.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {insights.recommendations?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#7C6AAA', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recommendations</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {insights.recommendations.map((r, i) => {
                  const badge = priorityBadge(r.priority)
                  return (
                    <div key={i} style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.7)', borderRadius: 8, border: '1px solid #E8E0F8' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: badge.bg, color: badge.color }}>
                          {badge.label}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#1A2415' }}>{r.action}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#4B5563', lineHeight: 1.5 }}>{r.rationale}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {model && (
            <div style={{ fontSize: 10, color: '#9C8ABB', textAlign: 'right' }}>
              Served by {model}
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
    </div>
  )
}

// ── Shared loading / empty states ─────────────────────────────────────────────
function Skeleton({ label }: { label: string }) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: '#637056', fontSize: 12 }}>
      <div style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>{label}</div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  )
}
function Empty({ label }: { label: string }) {
  return <div style={{ padding: 40, textAlign: 'center', color: '#96A88A', fontSize: 12 }}>{label}</div>
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════════════════════
interface Props {
  dateFrom?: string
  dateTo?:   string
}

type SubTab = 'yield' | 'reliability' | 'velocity'

export default function OperationalTrends({ dateFrom, dateTo }: Props) {
  const [tab, setTab] = useState<SubTab>('yield')

  const from = dateFrom ?? format(subMonths(new Date(), 6), 'yyyy-MM-dd')
  const to   = dateTo   ?? format(new Date(), 'yyyy-MM-dd')
  const period = `${format(parseISO(from), 'dd MMM yy')} – ${format(parseISO(to), 'dd MMM yy')}`

  const TABS: { key: SubTab; label: string }[] = [
    { key: 'yield',       label: 'Yield Analytics'     },
    { key: 'reliability', label: 'Count Reliability'    },
    { key: 'velocity',    label: 'Inventory Velocity'   },
  ]

  // Placeholder summary data for Gemini (the individual components hold full data;
  // this passes lightweight summaries so the AI panel can load independently)
  const geminiPayload = useMemo(() => ({
    yieldData:       { note: 'See yield analytics tab for kg-per-section-per-month breakdown' },
    reliabilityData: { note: 'See count reliability tab for per-counter match rates' },
    velocityData:    { note: 'See inventory velocity tab for average days sitting per section' },
  }), [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Sub-tab switcher */}
      <div style={{ display: 'flex', gap: 2, padding: 4, background: '#F0F2F5', borderRadius: 10, width: 'fit-content' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '7px 18px',
              borderRadius: 7,
              border: 'none',
              background: tab === t.key ? '#fff' : 'transparent',
              color: tab === t.key ? '#1A2415' : '#637056',
              fontSize: 13,
              fontWeight: tab === t.key ? 600 : 400,
              cursor: 'pointer',
              boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
              transition: 'all 120ms',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'yield'       && <YieldAnalytics dateFrom={from} />}
      {tab === 'reliability' && <CountReliabilityAnalytics dateFrom={from} dateTo={to} />}
      {tab === 'velocity'    && <InventoryVelocityAnalytics />}

      {/* Gemini panel — always visible below */}
      <GeminiInsightsPanel
        yieldData={geminiPayload.yieldData}
        reliabilityData={geminiPayload.reliabilityData}
        velocityData={geminiPayload.velocityData}
        period={period}
      />
    </div>
  )
}
