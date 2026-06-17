'use client'

// components/dashboard/editable/widgets.tsx
// The concrete widget components placed on editable dashboards. Each one reads
// from the shared DashboardDataProvider so it can be added/removed/reordered
// freely without owning its own data fetch. Presentational pieces (floor map,
// uptime grid, activity feed, notepad, calendar) are reused from the existing
// dashboard rather than reimplemented.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  TrendingUp, TrendingDown, Minus,
  Target, Settings2, BarChart2, Tag, Scale, ClipboardList, AlertTriangle,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

import { useDashboardData } from '@/lib/dashboard/data'
import { useAuth } from '@/lib/auth/context'

import WarehouseMap from '../WarehouseMap'
import UptimeGrid from '../UptimeGrid'
import ActivityFeed from '../ActivityFeed'
import Notepad from '../Notepad'
import MiniCalendar from '../MiniCalendar'

// ── Animated count-up ────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 1100, enabled = true) {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    if (!enabled || target === 0) { setValue(target); return }
    let start: number | null = null
    const step = (ts: number) => {
      if (!start) start = ts
      const progress = Math.min((ts - start) / duration, 1)
      const eased    = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(eased * target))
      if (progress < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration, enabled])
  return value
}

// ── KPI tile (grid-friendly; mirrors KpiRibbon's card styling) ───────────────
type KpiColor = 'ok' | 'warn' | 'info' | 'muted' | 'err'

const COLOR_MAP: Record<KpiColor, { value: string; bg: string; border: string }> = {
  ok:   { value: 'text-ok',   bg: 'bg-ok/5',         border: 'border-ok/15' },
  info: { value: 'text-info', bg: 'bg-info/5',       border: 'border-info/15' },
  warn: { value: 'text-warn', bg: 'bg-warn/5',       border: 'border-warn/15' },
  err:  { value: 'text-err',  bg: 'bg-err/5',        border: 'border-err/15' },
  muted:{ value: 'text-text', bg: 'bg-surface-card', border: 'border-surface-rule' },
}

interface StatTileProps {
  label:    string
  sublabel?:string
  value:    string
  numericValue: number
  color?:   KpiColor
  trend?:   'up' | 'down' | 'flat'
  href:     string
  icon:     React.ReactNode
}

function StatTile({ label, sublabel, value, numericValue, color = 'muted', trend, href, icon }: StatTileProps) {
  const num = useCountUp(numericValue, 1100, numericValue > 0)
  const c   = COLOR_MAP[color]
  const canAnimate = Number.isFinite(numericValue) && !value.includes('R ')
  const display = canAnimate ? value.replace(/\d+/, String(num)) : value
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus

  return (
    <Link
      href={href}
      className={`flex h-full flex-col gap-2 rounded-2xl border p-4 transition-all duration-200 hover:shadow-md ${c.bg} ${c.border}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-text-muted">{icon}</span>
        {trend && (
          <TrendIcon size={13} className={trend === 'up' ? 'text-ok' : trend === 'down' ? 'text-warn' : 'text-text-muted'} />
        )}
      </div>
      <div className={`font-display font-bold text-[26px] leading-none ${c.value}`}>{display}</div>
      <div>
        <div className="font-body font-semibold text-[12px] text-text leading-tight">{label}</div>
        {sublabel && (
          <div className="font-mono text-[10px] text-text-muted mt-0.5 uppercase tracking-wide">{sublabel}</div>
        )}
      </div>
    </Link>
  )
}

// ── KPI widgets ──────────────────────────────────────────────────────────────
function KpiAccuracy() {
  const { avgAccuracy } = useDashboardData()
  return (
    <StatTile
      label="Count Accuracy" sublabel="30-day avg"
      value={avgAccuracy != null ? `${avgAccuracy}%` : '—'}
      numericValue={avgAccuracy ?? 0}
      color={avgAccuracy == null ? 'muted' : avgAccuracy >= 99 ? 'ok' : avgAccuracy >= 95 ? 'info' : 'warn'}
      trend={avgAccuracy != null && avgAccuracy >= 95 ? 'up' : 'down'}
      href="/management" icon={<Target size={18} />}
    />
  )
}

function KpiSections() {
  const { activeSections } = useDashboardData()
  return (
    <StatTile
      label="Active Sections" sublabel="today"
      value={`${activeSections}/6`} numericValue={activeSections}
      color={activeSections >= 4 ? 'ok' : activeSections >= 2 ? 'info' : 'muted'}
      href="/production" icon={<Settings2 size={18} />}
    />
  )
}

function KpiYield() {
  const { avgYield } = useDashboardData()
  return (
    <StatTile
      label="Avg Yield" sublabel="today"
      value={avgYield != null ? `${avgYield}%` : '—'} numericValue={avgYield ?? 0}
      color={avgYield == null ? 'muted' : avgYield >= 95 ? 'ok' : avgYield >= 90 ? 'info' : 'warn'}
      href="/production/history" icon={<BarChart2 size={18} />}
    />
  )
}

function KpiTags() {
  const { tagCount } = useDashboardData()
  return (
    <StatTile
      label="Bag Tags" sublabel="today"
      value={String(tagCount)} numericValue={tagCount}
      color={tagCount > 0 ? 'ok' : 'muted'}
      href="/tags" icon={<Tag size={18} />}
    />
  )
}

function KpiTagKg() {
  const { tagKg } = useDashboardData()
  return (
    <StatTile
      label="Tagged Weight" sublabel="today"
      value={`${(tagKg / 1000).toFixed(1)} t`} numericValue={tagKg}
      color={tagKg > 0 ? 'info' : 'muted'}
      href="/tags" icon={<Scale size={18} />}
    />
  )
}

function KpiSessions() {
  const { completedCount } = useDashboardData()
  return (
    <StatTile
      label="Count Sessions" sublabel="30 days"
      value={String(completedCount)} numericValue={completedCount}
      color="muted" href="/management" icon={<ClipboardList size={18} />}
    />
  )
}

function KpiVariances() {
  const { variances } = useDashboardData()
  return (
    <StatTile
      label="Variances" sublabel="30 days"
      value={String(variances)} numericValue={variances}
      color={variances > 0 ? 'warn' : 'ok'}
      href="/management" icon={<AlertTriangle size={18} />}
    />
  )
}

// ── Panel widgets (reuse existing components) ────────────────────────────────
function FloorMap() {
  const { sectionStatuses, loading } = useDashboardData()
  return <WarehouseMap sections={sectionStatuses} loading={loading} />
}

function Uptime() {
  const { sectionStatuses, loading } = useDashboardData()
  return <UptimeGrid sections={sectionStatuses} loading={loading} />
}

function Activity() {
  const { recentSessions, todayProd, loading } = useDashboardData()
  return (
    <div className="min-h-[320px] h-full">
      <ActivityFeed recentSessions={recentSessions} todayProd={todayProd} loading={loading} />
    </div>
  )
}

function PersonalNotepad() {
  const { userId } = useAuth()
  return <Notepad userId={userId ?? 'guest'} />
}

function Calendar() {
  const { recentSessions } = useDashboardData()
  return <MiniCalendar sessions={recentSessions} />
}

// ── Yield-by-section chart (Recharts) ────────────────────────────────────────
const YIELD_COLOR = (v: number) => (v >= 95 ? '#15803D' : v >= 90 ? '#1D4ED8' : '#B45309')

function YieldChart() {
  const { sectionStatuses, loading } = useDashboardData()
  const rows = sectionStatuses
    .filter(s => s.avgYield != null)
    .map(s => ({ name: s.code, yield: Math.round((s.avgYield ?? 0) * 10) / 10 }))

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden flex flex-col">
      <div className="px-5 py-3.5 border-b border-surface-rule flex items-center gap-3">
        <BarChart2 size={14} className="text-brand" />
        <span className="font-display font-bold text-[14px] text-text">Yield by Section</span>
        <span className="font-mono text-[11px] text-text-muted">· today</span>
      </div>
      <div className="p-4" style={{ height: 240 }}>
        {loading ? (
          <div className="w-full h-full bg-surface rounded-xl animate-pulse" />
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center font-mono text-[11px] text-text-faint">
            No yield data today
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                contentStyle={{ borderRadius: 10, border: '1px solid #E5E7EB', fontSize: 12 }}
                formatter={(v) => [`${v}%`, 'Yield']}
              />
              <Bar dataKey="yield" radius={[6, 6, 0, 0]} maxBarSize={48}>
                {rows.map((r, i) => <Cell key={i} fill={YIELD_COLOR(r.yield)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

// ── Export map: widget type → component ──────────────────────────────────────
export const WIDGET_COMPONENTS: Record<string, React.ComponentType> = {
  'kpi-accuracy':  KpiAccuracy,
  'kpi-sections':  KpiSections,
  'kpi-yield':     KpiYield,
  'kpi-tags':      KpiTags,
  'kpi-tagkg':     KpiTagKg,
  'kpi-sessions':  KpiSessions,
  'kpi-variances': KpiVariances,
  'floor-map':     FloorMap,
  'uptime-grid':   Uptime,
  'activity-feed': Activity,
  'yield-chart':   YieldChart,
  'notepad':       PersonalNotepad,
  'mini-calendar': Calendar,
}
