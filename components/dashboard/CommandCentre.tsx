'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format, subDays, parseISO } from 'date-fns'
import {
  RefreshCw, RotateCcw, ChevronRight, CheckCircle2, Clock,
  ClipboardList, ArrowRight, Target, Settings2, BarChart2,
  Tag, Scale, DollarSign, TrendingUp, Activity, Package,
  AlertTriangle, FlaskConical,
} from 'lucide-react'
import Link from 'next/link'

import KpiRibbon, { type KpiItem } from './KpiRibbon'
import WarehouseMap, { type SectionStatus } from './WarehouseMap'
import UptimeGrid from './UptimeGrid'
import ConnectionsPanel from './ConnectionsPanel'
import Notepad from './Notepad'
import MiniCalendar from './MiniCalendar'
import ActivityFeed from './ActivityFeed'

// ── Types ─────────────────────────────────────────────────────────────────────
interface ScSession {
  id:                string
  count_date:        string
  match_rate_pct:    number | null
  sup_confirmed_at:  string | null
  adm_confirmed_at:  string | null
  sup_total_kg:      number | null
  adm_total_kg:      number | null
  comparison_status: string | null
}

interface ProdSession {
  id:            string
  section_id:    string
  section_name:  string
  shift:         string
  status:        string
  submitted_at:  string | null
}

interface MassBalance {
  session_id:      string
  yield_pct:       number | null
  within_tolerance:boolean | null
  total_input_kg:  number | null
}

// ── Shift helper ──────────────────────────────────────────────────────────────
function getShift(hour: number) {
  if (hour >= 6 && hour < 14) return { label: 'Morning shift',   style: 'bg-amber-50 text-amber-700 border-amber-200' }
  if (hour >= 14 && hour < 22) return { label: 'Afternoon shift', style: 'bg-blue-50 text-blue-700 border-blue-200' }
  return                                { label: 'Night shift',    style: 'bg-purple-50 text-purple-700 border-purple-200' }
}

const ALL_SECTIONS = [
  { id: 'sieving',     code: 'ST', name: 'Sieving Tower' },
  { id: 'refining1',   code: 'R1', name: 'Refining 1'    },
  { id: 'refining2',   code: 'R2', name: 'Refining 2'    },
  { id: 'granule',     code: 'GL', name: 'Granule Line'  },
  { id: 'blender',     code: 'BL', name: 'Blender'       },
  { id: 'pasteuriser', code: 'PR', name: 'Pasteuriser'   },
]

// ── Component ─────────────────────────────────────────────────────────────────
export default function CommandCentre() {
  const {
    displayName, p, isIT, isManagement, isSales, isMarketing,
    canAccessProduction, canAccessSales, isSupervisor, userId,
    role, department,
  } = useAuth()

  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [recentSessions, setRecentSessions] = useState<ScSession[]>([])
  const [todayCount,     setTodayCount]     = useState<ScSession | null>(null)
  const [todayProd,      setTodayProd]      = useState<ProdSession[]>([])
  const [massBalances,   setMassBalances]   = useState<MassBalance[]>([])
  const [tagCount,       setTagCount]       = useState(0)
  const [tagKg,          setTagKg]          = useState(0)
  const [signalCount,    setSignalCount]    = useState<number | null>(null)
  const [openGrns,       setOpenGrns]       = useState<number | null>(null)

  const today = format(new Date(), 'yyyy-MM-dd')
  const d30   = format(subDays(new Date(), 30), 'yyyy-MM-dd')
  const hour  = new Date().getHours()
  const shift = getShift(hour)
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = displayName.split(' ')[0]

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    const db = getDb()

    const [sessRes, prodRes, tagRes] = await Promise.all([
      db.from('sc_sessions')
        .select('id,count_date,match_rate_pct,sup_confirmed_at,adm_confirmed_at,sup_total_kg,adm_total_kg,comparison_status')
        .gte('count_date', d30)
        .order('count_date', { ascending: false }),
      db.from('prod_sessions')
        .select('id,section_id,section_name,shift,status,submitted_at')
        .eq('date', today)
        .is('deleted_at', null)
        .order('submitted_at', { ascending: false }),
      db.from('bag_tags')
        .select('weight_kg')
        .eq('tag_date', today),
    ])

    const sessions = (sessRes.data as ScSession[]) ?? []
    setRecentSessions(sessions)
    setTodayCount(sessions.find(s => s.count_date === today) ?? null)

    const prod = (prodRes.data as ProdSession[]) ?? []
    setTodayProd(prod)

    if (prod.length > 0) {
      const { data: mbData } = await db
        .from('prod_mass_balance')
        .select('session_id,yield_pct,within_tolerance,total_input_kg')
        .in('session_id', prod.map(s => s.id))
      setMassBalances((mbData as MassBalance[]) ?? [])
    }

    const tags = (tagRes.data as { weight_kg: number | null }[]) ?? []
    setTagCount(tags.length)
    setTagKg(tags.reduce((s, t) => s + (t.weight_kg ?? 0), 0))

    // Best-effort signal count
    try {
      const { count } = await db
        .from('intelligence_signals')
        .select('id', { count: 'exact', head: true })
      setSignalCount(count ?? 0)
    } catch { /* no signals table */ }

    // Best-effort open GRNs
    try {
      const { count } = await (db as any)
        .schema('logistics')
        .from('grns')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
      setOpenGrns(count ?? 0)
    } catch { /* no logistics schema access */ }

    setLoading(false)
    setRefreshing(false)
  }, [today, d30])

  useEffect(() => { load() }, [load])

  // ── Derived values ──────────────────────────────────────────────────────────
  const completed   = recentSessions.filter(s => s.sup_confirmed_at && s.adm_confirmed_at)
  const avgAccuracy = completed.length
    ? Math.round(completed.reduce((s, r) => s + (r.match_rate_pct ?? 0), 0) / completed.length)
    : null
  const variances     = recentSessions.filter(s => s.comparison_status === 'differences').length
  const activeSections = todayProd.filter(s => ['submitted', 'approved'].includes(s.status)).length
  const avgYield = massBalances.filter(m => m.yield_pct != null).length
    ? Math.round(
        massBalances.reduce((s, m) => s + (m.yield_pct ?? 0), 0) /
        massBalances.filter(m => m.yield_pct != null).length * 10
      ) / 10
    : null
  const hasVariances = todayCount?.comparison_status === 'differences'
  const countDone    = !!(todayCount?.sup_confirmed_at && todayCount?.adm_confirmed_at)

  // ── Section statuses for map & uptime grid ─────────────────────────────────
  const sectionStatuses: SectionStatus[] = ALL_SECTIONS.map(sec => {
    const secSessions = todayProd.filter(s => s.section_id === sec.id)
    const secMbs      = massBalances.filter(m => secSessions.some(s => s.id === m.session_id))
    const status =
      secSessions.some(s => s.status === 'approved')  ? 'approved'  as const :
      secSessions.some(s => s.status === 'submitted') ? 'submitted' as const :
      secSessions.some(s => s.status === 'draft')     ? 'draft'     as const :
      'idle' as const

    return {
      sectionId:    sec.id,
      code:         sec.code,
      name:         sec.name,
      sessionCount: secSessions.length,
      status,
      totalKg:   secMbs.reduce((s, m) => s + (m.total_input_kg ?? 0), 0),
      avgYield:  secMbs.filter(m => m.yield_pct != null).length
        ? secMbs.reduce((s, m) => s + (m.yield_pct ?? 0), 0) /
          secMbs.filter(m => m.yield_pct != null).length
        : null,
    }
  })

  // ── KPI ribbon items (permission-filtered) ─────────────────────────────────
  const kpis = [
    canAccessProduction && {
      id: 'accuracy', label: 'Count Accuracy', sublabel: '30-day avg',
      value: avgAccuracy != null ? `${avgAccuracy}%` : '—',
      numericValue: avgAccuracy ?? 0,
      color:  avgAccuracy == null ? 'muted' : avgAccuracy >= 99 ? 'ok' : avgAccuracy >= 95 ? 'info' : 'warn',
      trend:  avgAccuracy != null && avgAccuracy >= 95 ? 'up' : 'down',
      href:   '/management', icon: <Target size={18} />,
    } as KpiItem,
    canAccessProduction && {
      id: 'sections', label: 'Active Sections', sublabel: 'today',
      value: `${activeSections}/6`,
      numericValue: activeSections,
      color:  activeSections >= 4 ? 'ok' : activeSections >= 2 ? 'info' : 'muted',
      href:   '/production', icon: <Settings2 size={18} />,
    } as KpiItem,
    canAccessProduction && avgYield != null && {
      id: 'yield', label: 'Avg Yield', sublabel: 'today',
      value: `${avgYield}%`,
      numericValue: avgYield,
      color: avgYield >= 95 ? 'ok' : avgYield >= 90 ? 'info' : 'warn',
      href:  '/production/history', icon: <BarChart2 size={18} />,
    } as KpiItem,
    canAccessProduction && tagCount > 0 && {
      id: 'tags', label: 'Bag Tags', sublabel: 'today',
      value: String(tagCount),
      numericValue: tagCount,
      color: 'ok',
      href:  '/tags', icon: <Tag size={18} />,
    } as KpiItem,
    canAccessProduction && tagKg > 0 && {
      id: 'tagkg', label: 'Tagged Weight', sublabel: 'today',
      value: `${(tagKg / 1000).toFixed(1)} t`,
      numericValue: tagKg,
      color: 'info',
      href:  '/tags', icon: <Scale size={18} />,
    } as KpiItem,
    // Sales revenue/margin KPIs intentionally removed from the main dashboard —
    // confidential sales figures live only on the dedicated, access-gated
    // /sales dashboard (Sales / IT / Management).
    (p('can_access_research') || isManagement) && signalCount != null && {
      id: 'signals', label: 'Signals', sublabel: 'tracked',
      value: String(signalCount),
      numericValue: signalCount,
      color: 'info',
      href:  '/intelligence', icon: <FlaskConical size={18} />,
    } as KpiItem,
    openGrns != null && {
      id: 'grns', label: 'Open GRNs', sublabel: 'pending',
      value: String(openGrns),
      numericValue: openGrns,
      color: openGrns > 0 ? 'warn' : 'ok',
      href:  '/logistics/receiving', icon: <Package size={18} />,
    } as KpiItem,
    {
      id: 'sessions', label: 'Count Sessions', sublabel: '30 days',
      value: String(completed.length),
      numericValue: completed.length,
      color: 'muted',
      href:  '/management', icon: <ClipboardList size={18} />,
    } as KpiItem,
    variances > 0 && {
      id: 'variances', label: 'Variances', sublabel: '30 days',
      value: String(variances),
      numericValue: variances,
      color: 'warn',
      href:  '/management', icon: <AlertTriangle size={18} />,
    } as KpiItem,
  ].filter(Boolean) as KpiItem[]

  // ── Can see floor/map section ───────────────────────────────────────────────
  const canSeeFloor = canAccessProduction || isManagement

  return (
    <div className="px-4 py-5 space-y-5 max-w-[1400px] animate-in">

      {/* ── Pending role banner — shown to new users with no role assigned yet ── */}
      {!role && !department && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 18px', borderRadius: 10,
          background: '#FFFBEB', border: '1px solid #FCD34D',
          fontFamily: 'Arial, -apple-system, sans-serif',
        }}>
          <span style={{ fontSize: 18 }}>👋</span>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#92400E' }}>
              Welcome — your account is active but doesn&apos;t have a role yet.
            </span>
            <span style={{ fontSize: 13, color: '#B45309', marginLeft: 6 }}>
              Contact Alyssa or Gustav to get your department and access assigned.
            </span>
          </div>
        </div>
      )}

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-[28px] text-text leading-tight">
            {greeting}, {firstName}
          </h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="font-mono text-[12px] text-text-muted">
              {format(new Date(), 'EEEE d MMMM yyyy')}
            </span>
            <span className="h-3.5 w-px bg-surface-rule hidden sm:block" />
            <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] px-2 py-0.5 rounded-md border ${shift.style}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {shift.label}
            </span>
          </div>
        </div>
        <button
          onClick={() => load(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-card border border-surface-rule font-mono text-[10px] text-text-muted hover:text-text transition-colors shrink-0"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* ── ALERT BANNER ───────────────────────────────────────────────────── */}
      {hasVariances && (
        <Link
          href="/recount"
          className="flex items-center gap-3 px-4 py-3.5 bg-warn/8 border border-warn/25 rounded-xl hover:bg-warn/12 transition-colors"
        >
          <div className="w-8 h-8 rounded-lg bg-warn/15 flex items-center justify-center shrink-0">
            <RotateCcw size={16} className="text-warn" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-[13px] text-warn">
              Count variance detected today
            </div>
            <div className="font-mono text-[11px] text-warn/70">
              Differences found between supervisor and admin counts — tap to review or submit a recount
            </div>
          </div>
          <ChevronRight size={14} className="text-warn shrink-0" />
        </Link>
      )}

      {/* ── KPI RIBBON ─────────────────────────────────────────────────────── */}
      {!loading
        ? <KpiRibbon kpis={kpis} />
        : (
          <div className="flex gap-3 overflow-hidden">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="shrink-0 w-[172px] h-[110px] bg-surface-card border border-surface-rule rounded-2xl animate-pulse" />
            ))}
          </div>
        )
      }

      {/* ── TODAY'S COUNT STATUS (supervisors + production) ───────────── */}
      {(isSupervisor || canAccessProduction) && todayCount && (
        <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-surface-rule">
            <ClipboardList size={14} className="text-brand" />
            <span className="font-display font-bold text-[14px] text-text">
              Morning count · {format(new Date(), 'd MMM')}
            </span>
            <span className={`ml-auto font-mono text-[10px] px-2 py-0.5 rounded-md ${
              countDone ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'
            }`}>
              {countDone ? 'Completed' : 'In progress'}
            </span>
          </div>
          <div className="grid grid-cols-3 divide-x divide-surface-rule">
            {[
              {
                label: 'Supervisor',
                value: todayCount.sup_confirmed_at
                  ? format(parseISO(todayCount.sup_confirmed_at), 'HH:mm')
                  : '—',
                sub:   todayCount.sup_total_kg != null
                  ? `${todayCount.sup_total_kg.toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg`
                  : 'Not started',
                color: todayCount.sup_confirmed_at ? 'text-ok' : 'text-warn',
              },
              {
                label: 'Admin',
                value: todayCount.adm_confirmed_at
                  ? format(parseISO(todayCount.adm_confirmed_at), 'HH:mm')
                  : '—',
                sub:   todayCount.adm_total_kg != null
                  ? `${todayCount.adm_total_kg.toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg`
                  : 'Waiting',
                color: todayCount.adm_confirmed_at ? 'text-info' : 'text-text-faint',
              },
              {
                label: 'Match',
                value: countDone && todayCount.match_rate_pct != null
                  ? `${todayCount.match_rate_pct}%`
                  : '—',
                sub:   countDone
                  ? todayCount.comparison_status === 'match' ? 'All matched' : 'Differences'
                  : 'Pending',
                color: countDone && todayCount.match_rate_pct != null
                  ? todayCount.match_rate_pct >= 99 ? 'text-ok'
                  : todayCount.match_rate_pct >= 95 ? 'text-info'
                  : 'text-warn'
                  : 'text-text-faint',
              },
            ].map(col => (
              <div key={col.label} className="px-5 py-4 text-center">
                <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-1">
                  {col.label}
                </div>
                <div className={`font-display font-bold text-[22px] ${col.color}`}>
                  {col.value}
                </div>
                <div className="font-mono text-[10px] text-text-muted mt-0.5">{col.sub}</div>
              </div>
            ))}
          </div>
          <div className="px-5 pb-4">
            <Link
              href="/count"
              className="flex items-center justify-center gap-2 py-3 bg-brand text-white rounded-xl font-display font-bold text-[13px] hover:opacity-90 transition-opacity"
            >
              {countDone ? 'View count details' : 'Open count'}
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}

      {/* ── MAIN GRID: MAP + FEED ──────────────────────────────────────────── */}
      {canSeeFloor && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ minHeight: 340 }}>
          <div className="lg:col-span-2 min-h-[300px]">
            <WarehouseMap sections={sectionStatuses} loading={loading} />
          </div>
          <div className="min-h-[300px]">
            <ActivityFeed
              recentSessions={recentSessions}
              todayProd={todayProd}
              loading={loading}
            />
          </div>
        </div>
      )}

      {/* ── SECTION UPTIME GRID ──────────────────────────────────────────────── */}
      {canAccessProduction && (
        <UptimeGrid sections={sectionStatuses} loading={loading} />
      )}

      {/* ── CONNECTIONS PANEL (IT + Management) ──────────────────────────── */}
      {(isIT || isManagement) && <ConnectionsPanel />}

      {/* ── PERSONAL PANEL ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Notepad userId={userId ?? 'guest'} />
        <MiniCalendar sessions={recentSessions} />
      </div>

    </div>
  )
}
