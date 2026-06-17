'use client'

// lib/dashboard/data.tsx
// Single fetch of the production operations dataset, shared by every widget on
// the dashboard via context. Widgets read derived values from here instead of
// each running its own query — this mirrors the data CommandCentre already
// loads, just lifted into a provider so the editable grid can compose widgets
// freely without multiplying round-trips.

import {
  createContext, useContext, useEffect, useState, useCallback,
  type ReactNode,
} from 'react'
import { getDb } from '@/lib/supabase/db'
import { format, subDays } from 'date-fns'
import type { SectionStatus } from '@/components/dashboard/WarehouseMap'

// ── Row types (subset of columns the dashboard needs) ───────────────────────
export interface ScSession {
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
  id:           string
  section_id:   string
  section_name: string
  shift:        string
  status:       string
  submitted_at: string | null
}

interface MassBalance {
  session_id:       string
  yield_pct:        number | null
  within_tolerance: boolean | null
  total_input_kg:   number | null
}

const ALL_SECTIONS = [
  { id: 'sieving',     code: 'ST', name: 'Sieving Tower' },
  { id: 'refining1',   code: 'R1', name: 'Refining 1'    },
  { id: 'refining2',   code: 'R2', name: 'Refining 2'    },
  { id: 'granule',     code: 'GL', name: 'Granule Line'  },
  { id: 'blender',     code: 'BL', name: 'Blender'       },
  { id: 'pasteuriser', code: 'PR', name: 'Pasteuriser'   },
]

// ── Shape exposed to widgets ─────────────────────────────────────────────────
export interface DashboardData {
  loading:    boolean
  refreshing: boolean
  refresh:    () => void

  // Raw-ish collections
  recentSessions: ScSession[]
  todayCount:     ScSession | null
  todayProd:      { id: string; section_name: string; shift: string; status: string; submitted_at: string | null }[]
  sectionStatuses: SectionStatus[]

  // Derived KPIs
  avgAccuracy:   number | null
  variances:     number
  activeSections:number
  avgYield:      number | null
  tagCount:      number
  tagKg:         number
  completedCount:number
  hasVariances:  boolean
  countDone:     boolean
}

const DashboardDataContext = createContext<DashboardData | null>(null)

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [recentSessions, setRecentSessions] = useState<ScSession[]>([])
  const [todayCount,     setTodayCount]     = useState<ScSession | null>(null)
  const [todayProd,      setTodayProd]      = useState<ProdSession[]>([])
  const [massBalances,   setMassBalances]   = useState<MassBalance[]>([])
  const [tagCount,       setTagCount]       = useState(0)
  const [tagKg,          setTagKg]          = useState(0)

  const today = format(new Date(), 'yyyy-MM-dd')
  const d30   = format(subDays(new Date(), 30), 'yyyy-MM-dd')

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
    } else {
      setMassBalances([])
    }

    const tags = (tagRes.data as { weight_kg: number | null }[]) ?? []
    setTagCount(tags.length)
    setTagKg(tags.reduce((s, t) => s + (t.weight_kg ?? 0), 0))

    setLoading(false)
    setRefreshing(false)
  }, [today, d30])

  useEffect(() => { load() }, [load])

  // ── Derived values ──────────────────────────────────────────────────────────
  const completed = recentSessions.filter(s => s.sup_confirmed_at && s.adm_confirmed_at)
  const avgAccuracy = completed.length
    ? Math.round(completed.reduce((s, r) => s + (r.match_rate_pct ?? 0), 0) / completed.length)
    : null
  const variances      = recentSessions.filter(s => s.comparison_status === 'differences').length
  const activeSections = todayProd.filter(s => ['submitted', 'approved'].includes(s.status)).length
  const yieldRows      = massBalances.filter(m => m.yield_pct != null)
  const avgYield = yieldRows.length
    ? Math.round(yieldRows.reduce((s, m) => s + (m.yield_pct ?? 0), 0) / yieldRows.length * 10) / 10
    : null
  const hasVariances = todayCount?.comparison_status === 'differences'
  const countDone    = !!(todayCount?.sup_confirmed_at && todayCount?.adm_confirmed_at)

  // ── Section statuses for map / uptime / chart ───────────────────────────────
  const sectionStatuses: SectionStatus[] = ALL_SECTIONS.map(sec => {
    const secSessions = todayProd.filter(s => s.section_id === sec.id)
    const secMbs      = massBalances.filter(m => secSessions.some(s => s.id === m.session_id))
    const secYieldRows = secMbs.filter(m => m.yield_pct != null)
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
      totalKg:  secMbs.reduce((s, m) => s + (m.total_input_kg ?? 0), 0),
      avgYield: secYieldRows.length
        ? secYieldRows.reduce((s, m) => s + (m.yield_pct ?? 0), 0) / secYieldRows.length
        : null,
    }
  })

  const value: DashboardData = {
    loading, refreshing, refresh: () => load(true),
    recentSessions, todayCount, todayProd, sectionStatuses,
    avgAccuracy, variances, activeSections, avgYield,
    tagCount, tagKg, completedCount: completed.length, hasVariances, countDone,
  }

  return (
    <DashboardDataContext.Provider value={value}>
      {children}
    </DashboardDataContext.Provider>
  )
}

export function useDashboardData(): DashboardData {
  const ctx = useContext(DashboardDataContext)
  if (!ctx) throw new Error('useDashboardData must be used within a DashboardDataProvider')
  return ctx
}
