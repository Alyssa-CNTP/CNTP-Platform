'use client'

// app/(app)/axis/page.tsx — AXIS Dashboard

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import {
  Plus, Loader2, AlertTriangle, Inbox, Send,
  ArrowUpRight, ArrowDownRight, ChevronUp, ChevronDown,
  Code2, Cpu, Package, Server, Shield, Activity, Layers,
  FolderKanban, GitPullRequest, Clock, CheckCircle2, Lock,
  CalendarClock, Bell,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
} from 'recharts'

// ─── Category taxonomy (mirrors /axis/changelog) ──────────────────────────────

const CATEGORIES = {
  'applications-code':       { num: '01', label: 'Apps & Code',     short: 'Apps',    icon: Code2,    fill: '#1D4ED8' },
  'ai-ml':                   { num: '02', label: 'AI & ML',         short: 'AI/ML',   icon: Cpu,      fill: '#7E22CE' },
  'software-saas':           { num: '03', label: 'Software & SaaS', short: 'SaaS',    icon: Package,  fill: '#0D1F0D' },
  'infrastructure-hardware': { num: '04', label: 'Infrastructure',  short: 'Infra',   icon: Server,   fill: '#C2410C' },
  'security-governance':     { num: '05', label: 'Security',        short: 'Sec',     icon: Shield,   fill: '#B91C1C' },
  'operations-continuity':   { num: '06', label: 'Operations',      short: 'Ops',     icon: Activity, fill: '#15803D' },
  'projects-portfolios':     { num: '07', label: 'Projects',        short: 'Proj',    icon: Layers,   fill: '#78716C' },
} as const

type CatKey = keyof typeof CATEGORIES

const LEGACY_MAP: Record<string, CatKey> = {
  code:          'applications-code',
  system:        'infrastructure-hardware',
  documentation: 'projects-portfolios',
}

function catFor(sector: string): CatKey {
  return ((sector in CATEGORIES) ? sector : (LEGACY_MAP[sector] ?? 'applications-code')) as CatKey
}

const ENV_BADGE: Record<string, string> = {
  development: 'bg-surface text-text-muted border-surface-rule',
  staging:     'bg-info/10 text-info border-info/20',
  production:  'bg-err/10 text-err border-err/20',
  all:         'bg-warn/10 text-warn border-warn/20',
}

const RISK_BADGE: Record<string, string> = {
  low:      'bg-ok/10 text-ok border-ok/20',
  medium:   'bg-info/10 text-info border-info/20',
  high:     'bg-warn/10 text-warn border-warn/20',
  critical: 'bg-err/10 text-err border-err/20',
}

const RISK_FILL: Record<string, string> = {
  low: '#15803D', medium: '#1D4ED8', high: '#C2410C', critical: '#B91C1C',
}

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-err/10 text-err border-err/20',
  mid:  'bg-warn/10 text-warn border-warn/20',
  low:  'bg-ok/10 text-ok border-ok/20',
}
const PRIORITY_HEX: Record<string, string> = {
  high: '#B91C1C', mid: '#C2410C', low: '#15803D',
}

const URGENCY_BADGE: Record<string, string> = {
  critical: 'bg-err/10 text-err border-err/20',
  high:     'bg-warn/10 text-warn border-warn/20',
  medium:   'bg-info/10 text-info border-info/20',
  low:      'bg-surface text-text-muted border-surface-rule',
}

const REVIEW_FILL: Record<string, string> = {
  not_required: '#A8A29E',
  pending:      '#C2410C',
  approved:     '#15803D',
  rejected:     '#B91C1C',
}
const REVIEW_LABEL: Record<string, string> = {
  not_required: 'No review',
  pending:      'Pending',
  approved:     'Approved',
  rejected:     'Rejected',
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string; name: string; priority: string
  status: string; term: string; effort_size: string
  target_end: string | null; hard_deadline: boolean
  approved_at: string
}
interface Track {
  project_id: string; progress_pct: number
}
interface ChangeLog {
  id: string; sector: string; sub_folder: string | null
  change_type: string; description: string; created_at: string
  is_locked: boolean; review_status: string
  environment: string | null; risk_level: string
}
interface ProjectRequest {
  id: string; title: string
  requesting_dept: string; urgency: string; created_at: string
  status: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY = 86400_000

function timeAgo(s: string) {
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000)
  if (m < 60)   return `${m}m`
  if (m < 1440) return `${Math.floor(m / 60)}h`
  return `${Math.floor(m / 1440)}d`
}

function daysUntil(d: string | null) {
  if (!d) return null
  return Math.floor((new Date(d).getTime() - Date.now()) / DAY)
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KPICard({ label, value, deltaValue, deltaText, deltaDir, sub, onClick }: {
  label: string
  value: string | number
  deltaValue?: string
  deltaText?: string
  deltaDir?: 'up' | 'down' | 'flat'
  sub?: string
  onClick?: () => void
}) {
  const isPositive = deltaDir === 'up'
  const isNegative = deltaDir === 'down'
  return (
    <div
      onClick={onClick}
      className={`bg-surface-card border border-surface-rule rounded-xl p-4 ${onClick ? 'cursor-pointer hover:border-text-faint transition-colors' : ''}`}
    >
      <div className="font-mono text-[10px] tracking-widest text-text-muted uppercase mb-2">{label}</div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-display font-bold text-[26px] leading-none text-text">{value}</div>
        {deltaValue && (
          <span className={`inline-flex items-center gap-0.5 font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            isPositive ? 'bg-ok/10 text-ok' :
            isNegative ? 'bg-err/10 text-err' :
                         'bg-surface text-text-muted'
          }`}>
            {isPositive ? <ArrowUpRight size={10}/> : isNegative ? <ArrowDownRight size={10}/> : null}
            {deltaValue}
          </span>
        )}
      </div>
      {(deltaText || sub) && (
        <div className="mt-1.5 text-[11px] text-text-muted truncate">{deltaText ?? sub}</div>
      )}
    </div>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ text, right }: { text: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <div className="w-1 h-3.5 bg-brand rounded-full" />
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-text-muted font-semibold">{text}</span>
      </div>
      {right}
    </div>
  )
}

// ─── Sortable column header ───────────────────────────────────────────────────

function SortHeader<T extends string>({ label, k, sortKey, dir, onClick, align }: {
  label: string; k: T; sortKey: T; dir: 'asc' | 'desc'
  onClick: (k: T) => void; align?: 'left' | 'right' | 'center'
}) {
  const active = sortKey === k
  return (
    <th
      onClick={() => onClick(k)}
      className={`px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-text-muted cursor-pointer select-none hover:text-text transition-colors ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (dir === 'asc' ? <ChevronUp size={10}/> : <ChevronDown size={10}/>)}
      </span>
    </th>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Main page
// ═════════════════════════════════════════════════════════════════════════════

export default function AxisDashboard() {
  const { isIT, loading: al } = useAuth()
  const router = useRouter()
  const [projects,       setProjects]       = useState<Project[]>([])
  const [tracks,         setTracks]         = useState<Track[]>([])
  const [changes,        setChanges]        = useState<ChangeLog[]>([])
  const [allReqs,        setAllReqs]        = useState<ProjectRequest[]>([])
  const [loading,        setLoading]        = useState(true)

  // Project grid sorting
  type ProjectSortKey = 'name' | 'priority' | 'progress' | 'due'
  const [pSortKey, setPSortKey] = useState<ProjectSortKey>('progress')
  const [pSortDir, setPSortDir] = useState<'asc' | 'desc'>('desc')

  // Change grid sorting
  type ChangeSortKey = 'created_at' | 'category' | 'risk' | 'env'
  const [cSortKey, setCSortKey] = useState<ChangeSortKey>('created_at')
  const [cSortDir, setCSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => { if (!al && !isIT) router.replace('/dashboard') }, [isIT, al, router])

  useEffect(() => {
    if (al || !isIT) return
    // All axis.* tables are RLS-locked for the anon client.
    // The /api/axis/dashboard route fetches everything via admin client behind an IT check.
    fetch('/api/axis/dashboard')
      .then(r => r.ok ? r.json() : { projects: [], tracks: [], changes: [], requests: [] })
      .catch(() => ({ projects: [], tracks: [], changes: [], requests: [] }))
      .then((d: { projects: Project[]; tracks: Track[]; changes: ChangeLog[]; requests: ProjectRequest[] }) => {
        setProjects(d.projects ?? [])
        setTracks(d.tracks ?? [])
        setChanges(d.changes ?? [])
        setAllReqs(d.requests ?? [])
        setLoading(false)
      })
  }, [al, isIT])

  // ─── Derived data ─────────────────────────────────────────────────────────

  const projectProgress = useMemo(() => {
    const m = new Map<string, { sum: number; count: number }>()
    for (const t of tracks) {
      const acc = m.get(t.project_id) ?? { sum: 0, count: 0 }
      acc.sum += t.progress_pct; acc.count += 1
      m.set(t.project_id, acc)
    }
    return (id: string) => {
      const a = m.get(id)
      return a && a.count > 0 ? Math.round(a.sum / a.count) : 0
    }
  }, [tracks])

  // KPI values + deltas. Each delta is chosen so it matches the KPI's semantics:
  // — snapshot counts get a count delta ("+N this week")
  // — rolling-window counts get a % delta vs the prior window
  const kpis = useMemo(() => {
    const now = Date.now()
    const w1Start = now - 7 * DAY
    const w2Start = now - 14 * DAY

    const inW1 = (s: string) => new Date(s).getTime() >= w1Start
    const inW2 = (s: string) => {
      const t = new Date(s).getTime()
      return t >= w2Start && t < w1Start
    }

    const changesW1 = changes.filter(c => inW1(c.created_at)).length
    const changesW2 = changes.filter(c => inW2(c.created_at)).length
    const prodW1    = changes.filter(c => c.environment === 'production' && inW1(c.created_at)).length

    const pendingRequests = allReqs.filter(r => r.status === 'pending')
    const reqsThisWeek    = pendingRequests.filter(r => inW1(r.created_at)).length

    const projectsW1 = projects.filter(p => inW1(p.approved_at)).length

    const pendingReview = changes.filter(c => c.review_status === 'pending').length
    const reviewW1 = changes.filter(c => c.review_status === 'pending' && inW1(c.created_at)).length

    const urgentReqs = pendingRequests.filter(r => r.urgency === 'critical' || r.urgency === 'high').length

    const avgProgress = projects.length > 0
      ? Math.round(projects.reduce((s, p) => s + projectProgress(p.id), 0) / projects.length)
      : 0

    const overdue = projects.filter(p => {
      const d = daysUntil(p.target_end)
      return d !== null && d < 0
    }).length
    const dueSoon = projects.filter(p => {
      const d = daysUntil(p.target_end)
      return d !== null && d >= 0 && d <= 14
    }).length

    // % delta — for two comparable windowed counts only
    function pctDelta(curr: number, prev: number) {
      if (prev === 0 && curr === 0) return null
      if (prev === 0) return { value: 'new', dir: 'up' as const }
      const pct = Math.round(((curr - prev) / prev) * 100)
      return {
        value: `${pct >= 0 ? '+' : ''}${pct}%`,
        dir: pct > 0 ? 'up' as const : pct < 0 ? 'down' as const : 'flat' as const,
      }
    }
    // count delta — for snapshot KPIs ("+N this week")
    function countDelta(n: number, positiveIsUp = true) {
      if (n === 0) return null
      return { value: `+${n}`, dir: (positiveIsUp ? 'up' : 'down') as 'up' | 'down' }
    }

    return {
      projects: { value: projects.length, delta: countDelta(projectsW1), avgProgress, overdue, dueSoon },
      requests: { value: pendingRequests.length, delta: countDelta(reqsThisWeek, false), urgent: urgentReqs },
      changes:  { value: changesW1, delta: pctDelta(changesW1, changesW2), prod: prodW1 },
      review:   { value: pendingReview, delta: countDelta(reviewW1, false) },
      progress: { value: avgProgress },
    }
  }, [changes, allReqs, projects, projectProgress])

  // 30-day activity bucketed by day
  const activityData = useMemo(() => {
    const now = Date.now()
    const startMs = now - 30 * DAY
    const startDay = new Date(startMs)
    startDay.setHours(0, 0, 0, 0)

    const days: { date: Date; key: string; label: string; total: number } & Record<CatKey, number> = {} as any
    const out: any[] = []
    for (let i = 0; i < 30; i++) {
      const d = new Date(startDay.getTime() + i * DAY)
      const row: any = {
        key: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }),
        total: 0,
      }
      for (const k of Object.keys(CATEGORIES)) row[k] = 0
      out.push(row)
    }

    for (const c of changes) {
      const t = new Date(c.created_at).getTime()
      if (t < startDay.getTime()) continue
      const idx = Math.floor((t - startDay.getTime()) / DAY)
      if (idx < 0 || idx >= out.length) continue
      const cat = catFor(c.sector)
      out[idx][cat] += 1
      out[idx].total += 1
    }
    return out
  }, [changes])

  // Review status distribution (last 30d)
  const reviewDist = useMemo(() => {
    const since = Date.now() - 30 * DAY
    const counts: Record<string, number> = { not_required: 0, pending: 0, approved: 0, rejected: 0 }
    for (const c of changes) {
      if (new Date(c.created_at).getTime() < since) continue
      const k = (c.review_status in counts) ? c.review_status : 'not_required'
      counts[k] += 1
    }
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: REVIEW_LABEL[k], value: v, fill: REVIEW_FILL[k] }))
  }, [changes])

  // Risk distribution (last 30d)
  const riskDist = useMemo(() => {
    const since = Date.now() - 30 * DAY
    const counts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 }
    for (const c of changes) {
      if (new Date(c.created_at).getTime() < since) continue
      if (c.risk_level in counts) counts[c.risk_level] += 1
    }
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: k.charAt(0).toUpperCase() + k.slice(1), value: v, fill: RISK_FILL[k] }))
  }, [changes])

  // Sorted active projects
  const sortedProjects = useMemo(() => {
    const arr = [...projects]
    const prioRank: Record<string, number> = { high: 3, mid: 2, low: 1 }
    arr.sort((a, b) => {
      let cmp = 0
      if (pSortKey === 'name')       cmp = a.name.localeCompare(b.name)
      else if (pSortKey === 'priority') cmp = (prioRank[a.priority] ?? 0) - (prioRank[b.priority] ?? 0)
      else if (pSortKey === 'progress') cmp = projectProgress(a.id) - projectProgress(b.id)
      else if (pSortKey === 'due') {
        const da = daysUntil(a.target_end)
        const db = daysUntil(b.target_end)
        cmp = (da === null ? Infinity : da) - (db === null ? Infinity : db)
      }
      return pSortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [projects, pSortKey, pSortDir, projectProgress])

  // Sorted recent changes
  const sortedChanges = useMemo(() => {
    const arr = changes.slice(0, 50)
    const riskRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
    const envRank: Record<string, number> = { production: 4, all: 3, staging: 2, development: 1 }
    arr.sort((a, b) => {
      let cmp = 0
      if (cSortKey === 'created_at') cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      else if (cSortKey === 'category') cmp = catFor(a.sector).localeCompare(catFor(b.sector))
      else if (cSortKey === 'risk') cmp = (riskRank[a.risk_level] ?? 0) - (riskRank[b.risk_level] ?? 0)
      else if (cSortKey === 'env')  cmp = (envRank[a.environment ?? 'development'] ?? 0) - (envRank[b.environment ?? 'development'] ?? 0)
      return cSortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [changes, cSortKey, cSortDir])

  // Deadline reminders (overdue + due ≤14d), sorted by urgency
  const deadlineItems = useMemo(() => {
    return projects
      .map(p => ({ p, days: daysUntil(p.target_end) }))
      .filter(x => x.days !== null && x.days <= 14)
      .sort((a, b) => (a.days! - b.days!))
      .slice(0, 6)
  }, [projects])

  const incomingRequests = useMemo(() => {
    return allReqs.filter(r => r.status === 'pending').slice(0, 5)
  }, [allReqs])

  function toggleSort<T extends string>(k: T, sortKey: T, dir: 'asc' | 'desc', setKey: (k: T) => void, setDir: (d: 'asc' | 'desc') => void) {
    if (sortKey === k) setDir(dir === 'asc' ? 'desc' : 'asc')
    else { setKey(k); setDir('desc') }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (al || loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 size={18} className="animate-spin text-text-faint" />
    </div>
  )

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">AXIS · IT Operations</p>
          <h1 className="font-display font-bold text-[24px] text-text leading-tight mt-0.5">Overview</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/axis/consideration')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-surface-rule bg-surface-card text-[12px] font-semibold text-text-muted hover:text-text transition-colors">
            <Inbox size={13} /> Triage requests
            {kpis.requests.value > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-warn text-white text-[9px] font-bold">
                {kpis.requests.value}
              </span>
            )}
          </button>
          <button onClick={() => router.push('/axis/changelog')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-surface-rule bg-surface-card text-[12px] font-semibold text-text-muted hover:text-text transition-colors">
            <Plus size={13} /> Log change
          </button>
          <button onClick={() => router.push('/axis/request')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white text-[12px] font-semibold hover:bg-brand-hover transition-colors">
            <Send size={13} /> New request
          </button>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPICard
          label="Active projects"
          value={kpis.projects.value}
          deltaValue={kpis.projects.delta?.value}
          deltaDir={kpis.projects.delta?.dir}
          deltaText={
            kpis.projects.delta
              ? `${kpis.projects.delta.value} approved this week`
              : kpis.projects.value > 0
                ? 'no new approvals this week'
                : 'none in flight'
          }
        />
        <KPICard
          label="Avg progress"
          value={`${kpis.progress.value}%`}
          deltaText={`${tracks.length} active track${tracks.length === 1 ? '' : 's'}`}
        />
        <KPICard
          label="Pending requests"
          value={kpis.requests.value}
          deltaValue={kpis.requests.delta?.value}
          deltaDir={kpis.requests.delta?.dir}
          deltaText={
            kpis.requests.urgent > 0
              ? `${kpis.requests.urgent} urgent · awaiting triage`
              : kpis.requests.value > 0
                ? 'awaiting triage'
                : 'all clear'
          }
          onClick={() => router.push('/axis/consideration')}
        />
        <KPICard
          label="Changes / 7d"
          value={kpis.changes.value}
          deltaValue={kpis.changes.delta?.value}
          deltaDir={kpis.changes.delta?.dir}
          deltaText={
            kpis.changes.value === 0
              ? 'no activity this week'
              : kpis.changes.prod > 0
                ? `${kpis.changes.prod} hit production`
                : 'none in production'
          }
          onClick={() => router.push('/axis/changelog')}
        />
        <KPICard
          label="Needs review"
          value={kpis.review.value}
          deltaValue={kpis.review.delta?.value}
          deltaDir={kpis.review.delta?.dir}
          deltaText={kpis.review.value > 0 ? 'awaiting sign-off' : 'all clear'}
          onClick={() => router.push('/axis/changelog')}
        />
      </div>

      {/* ── Activity row: bar chart + donut ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Stacked bar chart — change activity by day */}
        <div className="lg:col-span-2 bg-surface-card border border-surface-rule rounded-xl p-5">
          <SectionLabel
            text="Change activity · last 30 days"
            right={
              <div className="flex items-center gap-3 flex-wrap">
                {(Object.entries(CATEGORIES) as [CatKey, typeof CATEGORIES[CatKey]][]).map(([k, c]) => (
                  <span key={k} className="font-mono text-[9px] text-text-muted flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm inline-block" style={{ background: c.fill }} />
                    {c.short}
                  </span>
                ))}
              </div>
            }
          />
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activityData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                  interval={Math.floor(activityData.length / 8)} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 11 }}
                  cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                />
                {(Object.entries(CATEGORIES) as [CatKey, typeof CATEGORIES[CatKey]][]).map(([k, c]) => (
                  <Bar key={k} dataKey={k} stackId="cat" fill={c.fill} name={c.label} radius={[0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: 2 donuts stacked */}
        <div className="space-y-5">
          {/* Review status donut */}
          <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
            <SectionLabel text="Review status · 30d" />
            {reviewDist.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-[12px] text-text-faint">
                No changes in this window
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-32 h-32 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={reviewDist} dataKey="value" nameKey="name"
                        innerRadius={36} outerRadius={56} paddingAngle={2} stroke="none">
                        {reviewDist.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="font-display font-bold text-[20px] text-text leading-none">
                      {reviewDist.reduce((s, d) => s + d.value, 0)}
                    </span>
                    <span className="font-mono text-[9px] text-text-muted uppercase mt-0.5">changes</span>
                  </div>
                </div>
                <div className="flex-1 space-y-1.5">
                  {reviewDist.map(d => (
                    <div key={d.name} className="flex items-center gap-2 text-[11px]">
                      <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: d.fill }} />
                      <span className="text-text-muted flex-1 truncate">{d.name}</span>
                      <span className="font-mono text-text font-semibold">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Risk donut */}
          <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
            <SectionLabel text="Risk distribution · 30d" />
            {riskDist.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-[12px] text-text-faint">
                No risk-rated changes
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-32 h-32 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={riskDist} dataKey="value" nameKey="name"
                        innerRadius={36} outerRadius={56} paddingAngle={2} stroke="none">
                        {riskDist.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="font-display font-bold text-[20px] text-text leading-none">
                      {riskDist.reduce((s, d) => s + d.value, 0)}
                    </span>
                    <span className="font-mono text-[9px] text-text-muted uppercase mt-0.5">total</span>
                  </div>
                </div>
                <div className="flex-1 space-y-1.5">
                  {riskDist.map(d => (
                    <div key={d.name} className="flex items-center gap-2 text-[11px]">
                      <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: d.fill }} />
                      <span className="text-text-muted flex-1">{d.name}</span>
                      <span className="font-mono text-text font-semibold">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Project grid + side panels ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Project progress line/area chart */}
        <div className="lg:col-span-2 bg-surface-card border border-surface-rule rounded-xl p-5">
          <SectionLabel
            text="Active projects · progress overview"
            right={
              <span className="font-mono text-[10px] text-text-muted">
                {sortedProjects.length} projects · {kpis.projects.avgProgress}% avg
              </span>
            }
          />
          {sortedProjects.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center gap-2">
              <FolderKanban size={20} className="text-text-faint" />
              <p className="text-[12px] text-text-muted">No active projects</p>
              <button onClick={() => router.push('/axis/consideration')}
                className="mt-1 text-[12px] text-brand hover:underline">
                Review pending requests →
              </button>
            </div>
          ) : (
            <>
              {/* Horizontal bar chart: project progress */}
              <div className="h-56 -mx-2 mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={sortedProjects.slice(0, 7).map(p => ({
                      name: p.name.length > 24 ? p.name.slice(0, 22) + '…' : p.name,
                      fullName: p.name,
                      progress: projectProgress(p.id),
                      fill: PRIORITY_HEX[p.priority] ?? '#78716C',
                    }))}
                    margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }}
                      axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#57534e' }}
                      axisLine={false} tickLine={false} width={170} />
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 11 }}
                      formatter={(v: any) => [`${v}%`, 'Progress']}
                      labelFormatter={(_, payload) => (payload?.[0]?.payload?.fullName) ?? ''}
                    />
                    <Bar dataKey="progress" radius={[0, 4, 4, 0]}>
                      {sortedProjects.slice(0, 7).map((p, i) => (
                        <Cell key={i} fill={PRIORITY_HEX[p.priority] ?? '#78716C'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Sortable grid */}
              <div className="overflow-x-auto -mx-5">
                <table className="w-full text-[12px]">
                  <thead className="bg-surface-raised border-y border-surface-rule">
                    <tr>
                      <SortHeader label="Project" k="name" sortKey={pSortKey} dir={pSortDir}
                        onClick={k => toggleSort(k, pSortKey, pSortDir, setPSortKey, setPSortDir)} />
                      <SortHeader label="Priority" k="priority" sortKey={pSortKey} dir={pSortDir} align="center"
                        onClick={k => toggleSort(k, pSortKey, pSortDir, setPSortKey, setPSortDir)} />
                      <SortHeader label="Progress" k="progress" sortKey={pSortKey} dir={pSortDir}
                        onClick={k => toggleSort(k, pSortKey, pSortDir, setPSortKey, setPSortDir)} />
                      <th className="px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-text-muted text-left">Term · Effort</th>
                      <SortHeader label="Due" k="due" sortKey={pSortKey} dir={pSortDir} align="right"
                        onClick={k => toggleSort(k, pSortKey, pSortDir, setPSortKey, setPSortDir)} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProjects.slice(0, 10).map(p => {
                      const pct = projectProgress(p.id)
                      const d = daysUntil(p.target_end)
                      const dueColor = d === null ? 'text-text-faint' : d < 0 ? 'text-err' : d <= 7 ? 'text-err' : d <= 14 ? 'text-warn' : 'text-text-muted'
                      const dueLabel = d === null ? '—' : d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : `${d}d`
                      return (
                        <tr key={p.id}
                          onClick={() => router.push(`/axis/projects/${p.id}`)}
                          className="border-b border-surface-rule hover:bg-surface-raised cursor-pointer transition-colors">
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ background: PRIORITY_HEX[p.priority] ?? '#78716C' }} />
                              <span className="font-medium text-text truncate max-w-[260px]">{p.name}</span>
                              {p.hard_deadline && (
                                <Lock size={10} className="text-err flex-shrink-0" />
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_BADGE[p.priority] ?? ''}`}>
                              {p.priority}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2 w-44">
                              <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: PRIORITY_HEX[p.priority] ?? '#78716C' }} />
                              </div>
                              <span className="font-mono text-[10px] text-text-muted w-8 text-right">{pct}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-text-muted">
                            {p.term} · {p.effort_size}
                          </td>
                          <td className={`px-3 py-2.5 text-right font-mono text-[11px] ${dueColor}`}>
                            {dueLabel}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {sortedProjects.length > 10 && (
                <p className="text-center text-[11px] text-text-muted pt-3">
                  + {sortedProjects.length - 10} more projects
                </p>
              )}
            </>
          )}
        </div>

        {/* Right side: Reminders + Incoming */}
        <div className="space-y-5">

          {/* Deadlines / Reminders */}
          <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
            <SectionLabel
              text="Deadlines"
              right={
                <span className="font-mono text-[10px] text-text-muted">
                  {kpis.projects.overdue > 0 && (
                    <span className="text-err font-semibold">{kpis.projects.overdue} overdue</span>
                  )}
                </span>
              }
            />
            {deadlineItems.length === 0 ? (
              <div className="py-6 flex flex-col items-center gap-1">
                <CheckCircle2 size={16} className="text-ok" />
                <p className="text-[12px] text-text-muted">No deadlines in ≤14 days</p>
              </div>
            ) : (
              <div className="space-y-2">
                {deadlineItems.map(({ p, days }) => {
                  const overdue = days! < 0
                  return (
                    <div key={p.id}
                      onClick={() => router.push(`/axis/projects/${p.id}`)}
                      className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-surface-raised hover:bg-surface cursor-pointer transition-colors group"
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        overdue ? 'bg-err/10' : days! <= 7 ? 'bg-warn/10' : 'bg-info/10'
                      }`}>
                        <CalendarClock size={13} className={overdue ? 'text-err' : days! <= 7 ? 'text-warn' : 'text-info'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-text leading-tight truncate">{p.name}</p>
                        <p className="text-[10px] text-text-muted mt-0.5">
                          <span className={overdue ? 'text-err font-semibold' : days! <= 7 ? 'text-warn font-semibold' : ''}>
                            {overdue ? `${-days!}d overdue` : days === 0 ? 'due today' : `due in ${days}d`}
                          </span>
                          {' · '}
                          {fmtDate(p.target_end)}
                          {p.hard_deadline && ' · hard'}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Incoming requests */}
          <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
            <SectionLabel
              text="Incoming requests"
              right={
                <button onClick={() => router.push('/axis/consideration')}
                  className="font-mono text-[10px] text-text-muted hover:text-text transition-colors">
                  All →
                </button>
              }
            />
            {incomingRequests.length === 0 ? (
              <div className="py-6 flex flex-col items-center gap-1">
                <Bell size={16} className="text-text-faint" />
                <p className="text-[12px] text-text-muted">No pending requests</p>
              </div>
            ) : (
              <div className="space-y-2">
                {incomingRequests.map(r => (
                  <div key={r.id}
                    onClick={() => router.push('/axis/consideration')}
                    className="px-3 py-2.5 rounded-lg bg-surface-raised hover:bg-surface cursor-pointer transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-[12px] font-semibold text-text leading-tight">{r.title}</p>
                      <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border flex-shrink-0 ${URGENCY_BADGE[r.urgency] ?? ''}`}>
                        {r.urgency}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-text-muted">
                      <span>{r.requesting_dept}</span>
                      <span>·</span>
                      <span>{timeAgo(r.created_at)} ago</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Change log grid ── */}
      <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
        <SectionLabel
          text="Recent change logs"
          right={
            <button onClick={() => router.push('/axis/changelog')}
              className="font-mono text-[10px] text-text-muted hover:text-text transition-colors">
              Open changelog →
            </button>
          }
        />
        {sortedChanges.length === 0 ? (
          <div className="py-10 flex flex-col items-center gap-2">
            <GitPullRequest size={20} className="text-text-faint" />
            <p className="text-[12px] text-text-muted">No changes logged yet</p>
            <button onClick={() => router.push('/axis/changelog')}
              className="text-[12px] text-brand hover:underline">
              Log first change →
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-[12px]">
              <thead className="bg-surface-raised border-y border-surface-rule">
                <tr>
                  <SortHeader label="Category" k="category" sortKey={cSortKey} dir={cSortDir}
                    onClick={k => toggleSort(k, cSortKey, cSortDir, setCSortKey, setCSortDir)} />
                  <th className="px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-text-muted text-left">Type</th>
                  <th className="px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-text-muted text-left">Description</th>
                  <SortHeader label="Env" k="env" sortKey={cSortKey} dir={cSortDir} align="center"
                    onClick={k => toggleSort(k, cSortKey, cSortDir, setCSortKey, setCSortDir)} />
                  <SortHeader label="Risk" k="risk" sortKey={cSortKey} dir={cSortDir} align="center"
                    onClick={k => toggleSort(k, cSortKey, cSortDir, setCSortKey, setCSortDir)} />
                  <th className="px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-text-muted text-center">Status</th>
                  <SortHeader label="Logged" k="created_at" sortKey={cSortKey} dir={cSortDir} align="right"
                    onClick={k => toggleSort(k, cSortKey, cSortDir, setCSortKey, setCSortDir)} />
                </tr>
              </thead>
              <tbody>
                {sortedChanges.slice(0, 12).map(c => {
                  const key = catFor(c.sector)
                  const cat = CATEGORIES[key]
                  const Icon = cat.icon
                  return (
                    <tr key={c.id}
                      onClick={() => router.push('/axis/changelog')}
                      className="border-b border-surface-rule hover:bg-surface-raised cursor-pointer transition-colors">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Icon size={11} style={{ color: cat.fill }} />
                          <span className="font-mono text-[10px] text-text-muted">{cat.num}</span>
                          <span className="text-text font-medium">{cat.short}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-text-muted whitespace-nowrap">
                        {c.change_type}
                      </td>
                      <td className="px-3 py-2.5 text-text max-w-[360px]">
                        <p className="truncate">{c.description}</p>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {c.environment ? (
                          <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${ENV_BADGE[c.environment] ?? ''}`}>
                            {c.environment}
                          </span>
                        ) : <span className="text-text-faint">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${RISK_BADGE[c.risk_level] ?? ''}`}>
                          {c.risk_level}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {c.review_status === 'pending' ? (
                          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border bg-warn/10 text-warn border-warn/20">
                            review
                          </span>
                        ) : c.is_locked ? (
                          <Lock size={11} className="text-text-faint inline-block" />
                        ) : (
                          <Clock size={11} className="text-warn inline-block" />
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[10px] text-text-muted whitespace-nowrap">
                        {timeAgo(c.created_at)} ago
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
