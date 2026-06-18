'use client'

// app/(app)/sales/page.tsx
// Single file — no sub-routes. All tabs live here.
// Tabs: Overview · Customers · Products · OKRs · Intelligence
// Data: seeded from CNTP_EXCO_Dashboard_2026_Redesign_3.xlsx

import React, { useState, useEffect, useMemo } from 'react'
import {
  TrendingUp, TrendingDown, Users, Package,
  BarChart3, Target, ChevronRight, Search,
  AlertTriangle, CheckCircle2, Clock,
  ArrowUpRight, ArrowDownRight, Layers, Globe2,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import SignalCard   from '@/components/intelligence/SignalCard'
import SignalDrawer from '@/components/intelligence/SignalDrawer'
import type { Signal } from '@/components/intelligence/types'
import type { SalesActuals, SalesCategory } from '@/lib/acumatica/sales-actuals'

// ─── Planning / forecast data from CNTP_EXCO_Dashboard_2026_Redesign_3.xlsx ──
// Live ACTUALS now come from GET /api/dashboard/sales. These constants are kept
// for (a) planning fields not in the live source (targets, tiers, OKRs) and
// (b) fallback display if the live fetch fails.

const FALLBACK_KPI = {
  totalRevenue:  70525831,
  totalCost:     48042495,
  grossMargin:   24472707,
  marginPct:     0.347,
  volumeKg:      1092439,
  avgRevPerKg:   64.55,
  bulkRevenue:   69543762,
  vaRevenue:     982069,
  superGradeMix: 0.471,
  activeSkus:    31,
  rev2025:       229883161,
  vol2025:       4105764,
  margin2025:    0.398,
}

const PLAN_MONTHLY = [
  { month: 'Jan', actualRev: 14405912, targetRev: 18665279, actualVol: 231150, targetVol: 286563, gp: 5309616 },
  { month: 'Feb', actualRev: 9590923,  targetRev: 18665279, actualVol: 179045, targetVol: 286563, gp: 3566423 },
  { month: 'Mar', actualRev: 21611865, targetRev: 21153983, actualVol: 317199, targetVol: 324771, gp: 7359716 },
  { month: 'Apr', actualRev: 24917130, targetRev: 19909631, actualVol: 356945, targetVol: 305667, gp: 8236952 },
]

const PLAN_CUSTOMERS = [
  { name: 'Kunitaro Co. Ltd',                    tier: 'T1', action: 'MAINTAIN', region: 'Japan',        seg: 'Bulk', ytdRev: 31256639, ytdCost: 23426465, ytdVol: 373788, ytdGP: 0.314, gp25: 0.344, gpTgt: 0.35  },
  { name: 'National Brands Limited',             tier: 'T1', action: 'MAINTAIN', region: 'South Africa', seg: 'Bulk', ytdRev: 24121865, ytdCost: 15291786, ytdVol: 448726, ytdGP: 0.366, gp25: 0.331, gpTgt: 0.34  },
  { name: 'Lipton Teas & Infusions',             tier: 'T1', action: 'MAINTAIN', region: 'South Africa', seg: 'Bulk', ytdRev: 2820096,  ytdCost: 1964730,  ytdVol: 57600,  ytdGP: 0.303, gp25: 0.252, gpTgt: 0.26  },
  { name: 'Tanganda Tea Company Ltd',            tier: 'T2', action: 'REDUCE',   region: 'Zimbabwe',     seg: 'Bulk', ytdRev: 3085632,  ytdCost: 2051182,  ytdVol: 57600,  ytdGP: 0.335, gp25: 0.318, gpTgt: 0.32  },
  { name: 'Amoros Nature SL',                   tier: 'T2', action: 'MAINTAIN', region: 'Spain',         seg: 'Bulk', ytdRev: 987370,   ytdCost: 622799,   ytdVol: 18000,  ytdGP: 0.369, gp25: 0.371, gpTgt: 0.38  },
  { name: 'Wollenhaupt Tee GmbH',               tier: 'T2', action: 'GROW',     region: 'Germany',       seg: 'Bulk', ytdRev: 860773,   ytdCost: 280200,   ytdVol: 20000,  ytdGP: 0.674, gp25: 0.00,  gpTgt: 0.50  },
  { name: 'Jutrzenka Colian Sp.',                tier: 'T2', action: 'GROW',     region: 'Poland',        seg: 'Bulk', ytdRev: 686812,   ytdCost: 304851,   ytdVol: 9000,   ytdGP: 0.556, gp25: 0.00,  gpTgt: 0.45  },
  { name: 'Meridian Trading Co.',               tier: 'T2', action: 'MAINTAIN', region: 'South Africa',  seg: 'Bulk', ytdRev: 684096,   ytdCost: 469697,   ytdVol: 4860,   ytdGP: 0.313, gp25: 0.00,  gpTgt: 0.32  },
  { name: 'Global Coffee Exports Ltd',          tier: 'T2', action: 'MAINTAIN', region: 'South Africa',  seg: 'Bulk', ytdRev: 900482,   ytdCost: 644714,   ytdVol: 18432,  ytdGP: 0.284, gp25: 0.265, gpTgt: 0.28  },
  { name: 'Baorong International (Beijing)',     tier: 'T2', action: 'GROW',     region: 'China',         seg: 'Bulk', ytdRev: 625129,   ytdCost: 470841,   ytdVol: 7258,   ytdGP: 0.247, gp25: 0.00,  gpTgt: 0.35  },
  { name: 'Harvest Trading Co. Ltd',            tier: 'T2', action: 'MAINTAIN', region: 'South Africa',  seg: 'Bulk', ytdRev: 1308006,  ytdCost: 822970,   ytdVol: 24045,  ytdGP: 0.371, gp25: 0.00,  gpTgt: 0.35  },
  { name: 'Southern Tea LLC',                   tier: 'T2', action: 'GROW',     region: 'USA',           seg: 'Bulk', ytdRev: 1122374,  ytdCost: 599605,   ytdVol: 0,      ytdGP: 0.466, gp25: 0.00,  gpTgt: 0.45  },
  { name: 'East West Tea (USA)',                tier: 'T2', action: 'GROW',     region: 'USA',           seg: 'Bulk', ytdRev: 0,        ytdCost: 0,        ytdVol: 0,      ytdGP: null,  gp25: 0.392, gpTgt: 0.42  },
  { name: 'Edelweiss Laboratories',             tier: 'T2', action: 'GROW',     region: 'South Africa',  seg: 'VA',   ytdRev: 483087,   ytdCost: 256567,   ytdVol: 31288,  ytdGP: 0.469, gp25: 0.505, gpTgt: 0.52  },
  { name: 'Liquid Concepts Trading',            tier: 'T2', action: 'GROW',     region: 'South Africa',  seg: 'VA',   ytdRev: 99263,    ytdCost: 38134,    ytdVol: 936,    ytdGP: 0.616, gp25: 0.623, gpTgt: 0.62  },
  { name: 'Good Young Co. (Taiwan)',            tier: 'T2', action: 'GROW',     region: 'Taiwan',        seg: 'Bulk', ytdRev: 0,        ytdCost: 0,        ytdVol: 0,      ytdGP: null,  gp25: 0.630, gpTgt: 0.60  },
  { name: 'Adanim Tea Company',                 tier: 'T2', action: 'GROW',     region: 'Israel',        seg: 'Bulk', ytdRev: 98680,    ytdCost: 45313,    ytdVol: 0,      ytdGP: 0.541, gp25: 0.00,  gpTgt: 0.45  },
  { name: 'Hain Celestial Group',              tier: 'T2', action: 'GROW',     region: 'USA',           seg: 'VA',   ytdRev: 89071,    ytdCost: 31928,    ytdVol: 0,      ytdGP: 0.642, gp25: 0.00,  gpTgt: 0.60  },
  { name: 'Dethlefsen & Balk (DE)',            tier: 'T2', action: 'MAINTAIN', region: 'Germany',       seg: 'Bulk', ytdRev: 0,        ytdCost: 0,        ytdVol: 0,      ytdGP: null,  gp25: 0.267, gpTgt: 0.29  },
  { name: 'Motherwell (Botswana)',             tier: 'T2', action: 'REDUCE',   region: 'Botswana',      seg: 'Bulk', ytdRev: 0,        ytdCost: 0,        ytdVol: 0,      ytdGP: null,  gp25: 0.300, gpTgt: 0.32  },
  { name: 'VA - Espresso Blend',              tier: 'T2', action: 'GROW',     region: 'South Africa',  seg: 'VA',   ytdRev: 979425,   ytdCost: 391770,   ytdVol: 5900,   ytdGP: 0.600, gp25: 0.600, gpTgt: 0.62  },
  { name: 'VA - Red Matcha',                  tier: 'T2', action: 'DEVELOP',  region: 'South Africa',  seg: 'VA',   ytdRev: 0,        ytdCost: 0,        ytdVol: 0,      ytdGP: null,  gp25: 0.00,  gpTgt: 0.65  },
  { name: 'Cape Herb & Spice',               tier: 'T3', action: 'REPRICE',  region: 'South Africa',  seg: 'Bulk', ytdRev: 0,        ytdCost: 0,        ytdVol: 0,      ytdGP: null,  gp25: 0.097, gpTgt: 0.35  },
  { name: 'Gold Crown (Kenya)',              tier: 'T3', action: 'REPRICE',  region: 'Kenya',         seg: 'Bulk', ytdRev: 0,        ytdCost: 0,        ytdVol: 0,      ytdGP: null,  gp25: 0.128, gpTgt: 0.35  },
]

const FALLBACK_PRODUCTS = [
  { sku: 'Super Grade',                       jan: 93400,  feb: 148845, mar: 154984, apr: 117812, ytd: 515041, pct: 0.4750 },
  { sku: 'Super Fine Cut - Conventional',     jan: 54000,  feb: 0,      mar: 72000,  apr: 90000,  ytd: 216000, pct: 0.1992 },
  { sku: 'SFC Bold - RA Conventional',        jan: 18000,  feb: 0,      mar: 0,      apr: 72000,  ytd: 90000,  pct: 0.0830 },
  { sku: 'Super Grade - Ruby',                jan: 0,      feb: 28800,  mar: 28800,  apr: 2016,   ytd: 59616,  pct: 0.0550 },
  { sku: 'Organic - Super Fine Cut 15 RA',    jan: 0,      feb: 0,      mar: 26640,  apr: 17280,  ytd: 43920,  pct: 0.0405 },
  { sku: 'Phyto Blend Tea Edws 30s',          jan: 11512,  feb: 0,      mar: 8400,   apr: 11376,  ytd: 31288,  pct: 0.0289 },
  { sku: 'Super Grade Conventional',          jan: 0,      feb: 0,      mar: 0,      apr: 30000,  ytd: 30000,  pct: 0.0277 },
  { sku: 'Granules - Super Export',           jan: 18000,  feb: 0,      mar: 0,      apr: 0,      ytd: 18000,  pct: 0.0166 },
  { sku: 'Organic - Super Fine Cut',          jan: 0,      feb: 0,      mar: 8640,   apr: 9342,   ytd: 17982,  pct: 0.0166 },
  { sku: 'Organic - Super Grade',             jan: 16542,  feb: 0,      mar: 0,      apr: 0,      ytd: 16542,  pct: 0.0153 },
  { sku: 'Other SKUs (21)',                   jan: 19696,  feb: 1400,   mar: 17735,  apr: 17119,  ytd: 55950,  pct: 0.0516 },
]

const OKRS = [
  { id: 'OKR-01', engine: 'BULK',    obj: 'Lock T1 Volume Commitments',         owner: 'Tom',       due: '2026-05-31', priority: 'CRITICAL', status: 'Open',        pct: 0  },
  { id: 'OKR-02', engine: 'BULK',    obj: 'Confirm 2025 Baseline + 14% Growth', owner: 'Tom/KH',    due: '2026-03-31', priority: 'CRITICAL', status: 'Open',        pct: 0  },
  { id: 'OKR-03', engine: 'BULK',    obj: 'Define T2/T3 Tier Criteria',         owner: 'Tom',       due: '2026-03-31', priority: 'HIGH',     status: 'Open',        pct: 0  },
  { id: 'OKR-04', engine: 'BULK',    obj: 'Configure CRM Reporting',            owner: 'Sales Ops', due: '2026-03-31', priority: 'HIGH',     status: 'Open',        pct: 0  },
  { id: 'OKR-05', engine: 'VA',      obj: 'Finalise Red Matcha Product Spec',   owner: 'Tom',       due: '2026-03-31', priority: 'CRITICAL', status: 'Open',        pct: 0  },
  { id: 'OKR-06', engine: 'VA',      obj: 'Identify 5 Espresso/Matcha Partners',owner: 'VA Lead',   due: '2026-06-30', priority: 'HIGH',     status: 'In Progress', pct: 40 },
  { id: 'OKR-07', engine: 'VA',      obj: 'Develop Cafe Playbook & Barista Guide', owner: 'VA Lead',due: '2026-04-30', priority: 'MEDIUM',   status: 'At Risk',     pct: 20 },
  { id: 'OKR-08', engine: 'DIGITAL', obj: 'Capture All Digital Baselines',     owner: 'Tom',       due: '2026-04-30', priority: 'CRITICAL', status: 'In Progress', pct: 60 },
  { id: 'OKR-09', engine: 'DIGITAL', obj: 'Appoint SEO Agency & Agree SLA',    owner: 'VA Lead',   due: '2026-04-30', priority: 'MEDIUM',   status: 'Open',        pct: 0  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fR  = (v: number) => `R${(v / 1_000_000).toFixed(1)}M`
const fP  = (v: number) => `${(v * 100).toFixed(1)}%`
const fK  = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : `${(v / 1_000).toFixed(0)}k`

const gpCol  = (v: number | null) => v === null ? '#9ca3af' : v >= 0.35 ? '#16a34a' : v >= 0.15 ? '#d97706' : '#dc2626'
const gpBg   = (v: number | null) => v === null ? '#f3f4f6' : v >= 0.35 ? '#f0fdf4' : v >= 0.15 ? '#fffbeb' : '#fef2f2'
const gpText = (v: number | null) => v === null ? '#6b7280' : v >= 0.35 ? '#166534' : v >= 0.15 ? '#92400e' : '#991b1b'

const actionCol: Record<string, { bg: string; text: string }> = {
  GROW:    { bg: '#f0fdf4', text: '#166534' },
  MAINTAIN:{ bg: '#eff6ff', text: '#1e40af' },
  REDUCE:  { bg: '#fffbeb', text: '#92400e' },
  REPRICE: { bg: '#fef2f2', text: '#991b1b' },
  DEVELOP: { bg: '#faf5ff', text: '#6b21a8' },
}

const statusCol: Record<string, { bg: string; text: string; bar: string }> = {
  'Complete':    { bg: '#f0fdf4', text: '#166534', bar: '#16a34a' },
  'In Progress': { bg: '#eff6ff', text: '#1e40af', bar: '#2563eb' },
  'At Risk':     { bg: '#fef2f2', text: '#991b1b', bar: '#dc2626' },
  'Open':        { bg: '#f9fafb', text: '#6b7280', bar: '#9ca3af' },
}

const prioCol: Record<string, { bg: string; text: string }> = {
  CRITICAL: { bg: '#fef2f2', text: '#991b1b' },
  HIGH:     { bg: '#fffbeb', text: '#92400e' },
  MEDIUM:   { bg: '#eff6ff', text: '#1e40af' },
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KPICard({ label, value, sub, up }: { label: string; value: string; sub: string; up?: boolean }) {
  return (
    <div className="bg-surface-card border border-surface-rule rounded-xl p-4">
      <div className="font-mono text-[10px] tracking-widest text-text-muted uppercase mb-2">{label}</div>
      <div className="font-display font-bold text-2xl text-text">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px]">
        {up !== undefined && (
          up
            ? <ArrowUpRight size={11} className="text-status-ok shrink-0" />
            : <ArrowDownRight size={11} className="text-status-warn shrink-0" />
        )}
        <span className="text-text-muted">{sub}</span>
      </div>
    </div>
  )
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-1 h-4 bg-brand rounded-full" />
      <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-text-muted font-semibold">{text}</span>
    </div>
  )
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? 'border-brand text-brand'
          : 'border-transparent text-text-muted hover:text-text hover:border-surface-rule'
      }`}
    >
      {label}
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

type TabKey = 'overview' | 'customers' | 'products' | 'okrs'

// Category toggle chips → live API `include` scope.
const CATEGORY_CHIPS: { key: SalesCategory; label: string }[] = [
  { key: 'product',  label: 'Tea Product'         },
  { key: 'contract', label: 'Contract Processing' },
  { key: 'freight',  label: 'Freight'             },
  { key: 'other',    label: 'Other'               },
]

export default function SalesPage() {
  const [tab, setTab]             = useState<TabKey>('overview')
  const [search, setSearch]       = useState('')
  const [tierFilter, setTier]     = useState('ALL')

  // Live sales actuals — fetched on mount + when year/scope changes.
  const [year]                    = useState(2026)
  const [include, setInclude]     = useState<SalesCategory[]>(['product'])
  const [data, setData]           = useState<SalesActuals | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/dashboard/sales?year=${year}&include=${include.join(',')}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d: SalesActuals) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setError('Live data unavailable — showing last known figures') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [year, include])

  const toggleCategory = (key: SalesCategory) =>
    setInclude(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      return next.length ? next : ['product']  // never empty — API defaults to product
    })

  // ── Merge: live actuals + planning overlay (fall back to constants) ─────────
  const kpi = data?.kpi ?? null

  // Monthly chart: live actuals keyed by month, plan targets joined by name.
  const monthlyData = useMemo(() => {
    const planByMonth = new Map(PLAN_MONTHLY.map(p => [p.month, p]))
    if (data?.monthly) {
      return data.monthly.map(m => {
        const plan = planByMonth.get(m.month)
        return {
          month:     m.month,
          actualRev: m.actualRev,
          actualVol: m.actualVol,
          gp:        m.gp,
          targetRev: plan?.targetRev ?? 0,
          targetVol: plan?.targetVol ?? 0,
        }
      })
    }
    return PLAN_MONTHLY
  }, [data])

  // Customers: live actuals joined onto plan for tier/action/seg/targets.
  const customers = useMemo(() => {
    const planByName = new Map(PLAN_CUSTOMERS.map(p => [p.name, p]))
    if (data?.customers) {
      return data.customers.map(c => {
        const plan = planByName.get(c.name)
        return {
          name:    c.name,
          region:  c.region,
          seg:     plan?.seg    ?? 'Bulk',
          tier:    plan?.tier   ?? 'T3',
          action:  plan?.action ?? 'MAINTAIN',
          gpTgt:   plan?.gpTgt  ?? 0,
          gp25:    plan?.gp25   ?? 0,
          ytdRev:  c.ytdRev,
          ytdCost: c.ytdCost,
          ytdVol:  c.ytdVol,
          ytdGP:   c.ytdGP,
        }
      })
    }
    return PLAN_CUSTOMERS
  }, [data])

  // Products: live monthly record + ytd + pct (fall back to seeded jan..apr shape).
  const products = useMemo(() => {
    if (data?.products) {
      return data.products.map(p => ({
        sku:     p.sku,
        monthly: p.monthly,
        ytd:     p.ytd,
        pct:     p.pct,
      }))
    }
    return FALLBACK_PRODUCTS.map(p => ({
      sku:     p.sku,
      monthly: { Jan: p.jan, Feb: p.feb, Mar: p.mar, Apr: p.apr } as Record<string, number>,
      ytd:     p.ytd,
      pct:     p.pct,
    }))
  }, [data])

  const categoryRev = useMemo(() => {
    const map = new Map<SalesCategory, number>()
    data?.categories?.forEach(c => map.set(c.category, c.revenue))
    return map
  }, [data])

  // Market Pulse — signal data
  const [signals,        setSignals]        = useState<Signal[]>([])
  const [signalsLoading, setSignalsLoading] = useState(true)
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null)

  useEffect(() => {
    fetch('/api/signals?limit=200')
      .then(r => r.json())
      .then(d => setSignals(d.signals ?? []))
      .catch(() => {})
      .finally(() => setSignalsLoading(false))
  }, [])

  const regionData = useMemo(() => {
    const counts = new Map<string, number>()
    signals.forEach(s => { if (s.region) counts.set(s.region, (counts.get(s.region) ?? 0) + 1) })
    return Array.from(counts.entries())
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  }, [signals])

  const opportunities = useMemo(() => signals.filter(s => s.classification === 'opportunity').sort((a, b) => b.relevance_score - a.relevance_score), [signals])
  const competitors   = useMemo(() => signals.filter(s => s.classification === 'competitor').sort((a, b) => b.relevance_score - a.relevance_score), [signals])
  const tradeSignals  = useMemo(() => signals.filter(s => s.keyword_group === 'trade').sort((a, b) => b.relevance_score - a.relevance_score), [signals])

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'overview',  label: 'Overview'    },
    { key: 'customers', label: 'Customers'   },
    { key: 'products',  label: 'Product Mix' },
    { key: 'okrs',      label: 'OKRs'        },
  ]

  const filteredCustomers = customers.filter(c => {
    const s = search.toLowerCase()
    return (
      (c.name.toLowerCase().includes(s) || c.region.toLowerCase().includes(s)) &&
      (tierFilter === 'ALL' || c.tier === tierFilter)
    )
  })

  return (
    <div className="flex flex-col h-full bg-background">

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div className="bg-surface-card border-b border-surface-rule px-6 flex gap-0 overflow-x-auto">
        {TABS.map(t => (
          <Tab key={t.key} label={t.label} active={tab === t.key} onClick={() => setTab(t.key)} />
        ))}
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1280px] mx-auto p-6 space-y-8">

          {/* ════════════════════════════════════════════════════════════════
              OVERVIEW
          ════════════════════════════════════════════════════════════════ */}
          {tab === 'overview' && (
            <>
              {/* Category scope chips */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] tracking-widest uppercase text-text-muted mr-1">Scope</span>
                {CATEGORY_CHIPS.map(chip => {
                  const on  = include.includes(chip.key)
                  const rev = categoryRev.get(chip.key)
                  return (
                    <button key={chip.key} onClick={() => toggleCategory(chip.key)}
                      className={`px-3 py-1.5 text-[12px] rounded-full border transition-colors ${
                        on
                          ? 'bg-brand text-white border-brand'
                          : 'bg-surface-card border-surface-rule text-text-muted hover:text-text'
                      }`}>
                      {chip.label}
                      {rev !== undefined && rev > 0 && (
                        <span className={`ml-1.5 font-mono text-[10px] ${on ? 'text-white/70' : 'text-text-faint'}`}>{fR(rev)}</span>
                      )}
                    </button>
                  )
                })}
                {loading && <span className="text-[11px] text-text-faint ml-1">Loading…</span>}
              </div>

              {/* Live-data fallback notice */}
              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-status-warnBg border border-surface-rule text-[12px] text-status-warn">
                  <AlertTriangle size={13} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* KPI row */}
              <div>
                <SectionLabel text="Financial performance · YTD Jan–Apr 2026" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <KPICard label="Total revenue"  value={fR(kpi?.totalRevenue ?? FALLBACK_KPI.totalRevenue)} sub={`vs ${fR(FALLBACK_KPI.rev2025)} 2025`} up={false} />
                  <KPICard label="Gross margin"   value={fR(kpi?.grossMargin ?? FALLBACK_KPI.grossMargin)}  sub={`${fR(kpi?.grossMargin ?? FALLBACK_KPI.grossMargin)} YTD`} />
                  <KPICard label="Margin %"       value={fP(kpi?.marginPct ?? FALLBACK_KPI.marginPct)}    sub={`2025: ${fP(FALLBACK_KPI.margin2025)} · −5.1pp`} up={false} />
                  <KPICard label="Volume (kg)"    value={fK(kpi?.volumeKg ?? FALLBACK_KPI.volumeKg)}     sub={`vs ${fK(FALLBACK_KPI.vol2025)} 2025`} up={false} />
                  <KPICard label="Avg rev / kg"   value={`R${(kpi?.avgRevPerKg ?? FALLBACK_KPI.avgRevPerKg).toFixed(2)}`} sub="+15.3% pricing uplift" up />
                  {kpi
                    ? <>
                        <KPICard label="Export revenue" value={fR(kpi.exportRevenue)} sub={`${fP(kpi.totalRevenue > 0 ? kpi.exportRevenue / kpi.totalRevenue : 0)} of total`} />
                        <KPICard label="Local revenue"  value={fR(kpi.localRevenue)}  sub={`${fP(kpi.totalRevenue > 0 ? kpi.localRevenue / kpi.totalRevenue : 0)} of total`} />
                      </>
                    : <>
                        <KPICard label="Bulk revenue"   value={fR(FALLBACK_KPI.bulkRevenue)}  sub="98.6% of total" />
                        <KPICard label="VA revenue"     value={`R${(FALLBACK_KPI.vaRevenue/1000).toFixed(0)}k`} sub="1.4% — grow target" />
                      </>
                  }
                  <KPICard label="Active SKUs"    value={`${kpi?.activeSkus ?? FALLBACK_KPI.activeSkus}`} sub="distinct grades dispatched" />
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Revenue vs Target */}
                <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
                  <SectionLabel text="Monthly revenue vs target (R)" />
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthlyData} barGap={6} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                          tickFormatter={v => `R${(v/1000000).toFixed(0)}M`} />
                        <Tooltip
                          contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 11 }}
                          formatter={(v: any, n: any) => [`R${((v as number)/1000000).toFixed(2)}M`, n === 'actualRev' ? 'Actual' : 'Target'] as [string, string]}
                        />
                        <Bar dataKey="targetRev" fill="#f3f4f6" radius={[3,3,0,0]} name="Target" />
                        <Bar dataKey="actualRev" radius={[3,3,0,0]} name="Actual">
                          {monthlyData.map((d, i) => (
                            <Cell key={i} fill={d.targetRev > 0 && d.actualRev >= d.targetRev ? '#16a34a' : '#2563eb'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex gap-4 mt-2 text-[10px] text-text-muted font-mono">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-600 inline-block"/>Above target</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-600 inline-block"/>Below target</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-gray-200 inline-block"/>Target</span>
                  </div>
                </div>

                {/* Volume trend */}
                <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
                  <SectionLabel text="Volume dispatched (kg) vs target" />
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={monthlyData}>
                        <defs>
                          <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="var(--color-brand)" stopOpacity={0.15}/>
                            <stop offset="95%" stopColor="var(--color-brand)" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                          tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 11 }}
                          formatter={(v: any, n: any) => [`${((v as number)/1000).toFixed(0)}k kg`, n === 'actualVol' ? 'Actual' : 'Target'] as [string, string]}
                        />
                        <Area type="monotone" dataKey="targetVol" stroke="#e5e7eb" fill="transparent" strokeDasharray="4 4" dot={false} name="Target" />
                        <Area type="monotone" dataKey="actualVol" stroke="var(--color-brand)" fill="url(#volGrad)" strokeWidth={2} dot={{ r: 3, fill: 'var(--color-brand)' }} name="Actual" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* YoY table */}
              <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
                <SectionLabel text="Year-on-year comparison · Jan–Apr 2025 vs 2026" />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-rule">
                        {['Metric','2025 Jan–Apr','2026 Jan–Apr','Change','Status'].map(h => (
                          <th key={h} className="text-left py-2 px-3 font-mono text-[10px] tracking-wider text-text-muted uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-rule">
                      {[
                        { m: 'Total Revenue',  v25: 'R229.9M', v26: 'R70.5M',   chg: '−R159.4M', ok: false },
                        { m: 'Total Cost',     v25: 'R138.5M', v26: 'R48.0M',   chg: '−R90.5M',  ok: false },
                        { m: 'Gross Margin',   v25: 'R91.4M',  v26: 'R24.5M',   chg: '−R66.9M',  ok: false },
                        { m: 'Margin %',       v25: '39.8%',   v26: '34.7%',    chg: '−5.1pp',   ok: false },
                        { m: 'Volume (kg)',    v25: '4.1M kg', v26: '1.09M kg', chg: '−73.4%',   ok: false },
                        { m: 'Avg Rev / kg',   v25: 'R55.99',  v26: 'R64.55',   chg: '+15.3%',   ok: true  },
                      ].map((r, i) => (
                        <tr key={i} className="hover:bg-surface">
                          <td className="py-2.5 px-3 font-medium text-text">{r.m}</td>
                          <td className="py-2.5 px-3 font-mono text-text-muted">{r.v25}</td>
                          <td className="py-2.5 px-3 font-mono text-text">{r.v26}</td>
                          <td className={`py-2.5 px-3 font-mono font-semibold ${r.ok ? 'text-status-ok' : 'text-status-warn'}`}>{r.chg}</td>
                          <td className="py-2.5 px-3">
                            {r.ok
                              ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-status-okBg text-status-ok text-[10px] font-medium"><CheckCircle2 size={10}/>Positive</span>
                              : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-status-warnBg text-status-warn text-[10px] font-medium"><AlertTriangle size={10}/>Monitor</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-4 text-[11px] text-text-muted leading-relaxed border-t border-surface-rule pt-3">
                  <strong className="text-text">Note:</strong> YoY volume decline is driven by removal of grower intake rows from dispatch records — not a commercial sales loss.
                  Pricing uplift of +15.3% Rev/kg confirms commercial performance is improving. Apr 2026 revenue of R24.9M exceeded monthly target.
                </p>
              </div>

              {/* Market Pulse */}
              <div className="space-y-4">
                <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <SectionLabel text="Market Pulse · Signal volume by region" />
                      <p className="text-[11px] text-text-muted -mt-2">Live signals from n8n · updated daily at 06:00</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-status-ok" style={{ boxShadow: '0 0 6px var(--color-status-ok)' }} />
                      <span className="font-mono text-[9px] text-text-faint uppercase tracking-wider">Live</span>
                    </div>
                  </div>
                  {signalsLoading ? (
                    <div className="h-[160px] flex items-center justify-center text-text-faint text-[12px]">Loading…</div>
                  ) : regionData.length === 0 ? (
                    <div className="h-[160px] flex items-center justify-center text-text-faint text-[12px]">No regional data yet — signals will appear once n8n is live</div>
                  ) : (
                    <div className="h-[160px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={regionData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-rule)" vertical={false} />
                          <XAxis dataKey="region" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={{ stroke: 'var(--color-surface-rule)' }} tickLine={false} />
                          <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} />
                          <Tooltip
                            contentStyle={{ background: 'var(--color-surface-card)', border: '1px solid var(--color-surface-rule)', borderRadius: 8, fontSize: 12 }}
                            cursor={{ fill: 'var(--color-surface)' }}
                          />
                          <Bar dataKey="count" fill="var(--color-brand)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {[
                    { title: 'Opportunities', icon: TrendingUp, items: opportunities, accent: 'var(--color-status-ok)' },
                    { title: 'Competitor Activity', icon: Globe2, items: competitors, accent: 'var(--color-status-danger)' },
                    { title: 'Trade Signals', icon: BarChart3, items: tradeSignals, accent: 'var(--color-brand)' },
                  ].map(col => (
                    <section key={col.title} className="bg-surface-card rounded-xl border border-surface-rule flex flex-col max-h-[480px]">
                      <header className="flex items-center justify-between px-4 py-3 border-b border-surface-rule">
                        <div className="flex items-center gap-2">
                          <col.icon size={13} style={{ color: col.accent }} />
                          <h3 className="font-display font-semibold text-[13px] text-text">{col.title}</h3>
                        </div>
                        <span className="font-mono text-[10px] px-2 py-0.5 rounded border border-surface-rule text-text-muted bg-surface">{col.items.length}</span>
                      </header>
                      <div className="flex-1 overflow-y-auto p-3 grid gap-2">
                        {signalsLoading ? (
                          <p className="text-center text-text-faint text-[12px] py-4">Loading…</p>
                        ) : col.items.length === 0 ? (
                          <p className="text-center text-text-faint text-[12px] py-4">No signals yet</p>
                        ) : (
                          col.items.slice(0, 12).map(s => (
                            <SignalCard key={s.id} signal={s} compact onClick={setSelectedSignal} />
                          ))
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              </div>

              <SignalDrawer signal={selectedSignal} onClose={() => setSelectedSignal(null)} />

              {/* Engine mix */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
                  <SectionLabel text="Revenue engine mix · YTD" />
                  {[
                    { label: 'Bulk Engine',      value: FALLBACK_KPI.bulkRevenue, color: '#2563eb', pct: 0.986 },
                    { label: 'Value-Add Engine', value: FALLBACK_KPI.vaRevenue,   color: '#7c3aed', pct: 0.014 },
                  ].map(e => (
                    <div key={e.label} className="mb-5 last:mb-0">
                      <div className="flex justify-between items-baseline mb-1.5">
                        <span className="text-[13px] font-medium text-text">{e.label}</span>
                        <span className="font-mono text-[12px] text-text">{fR(e.value)} <span className="text-text-muted">({(e.pct*100).toFixed(1)}%)</span></span>
                      </div>
                      <div className="h-2 bg-surface rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${e.pct*100}%`, background: e.color }} />
                      </div>
                    </div>
                  ))}
                  <div className="mt-5 p-3 bg-surface rounded-lg border border-surface-rule">
                    <div className="font-mono text-[10px] text-text-muted uppercase tracking-wider mb-1">Full year target</div>
                    <div className="font-display font-bold text-xl text-text">R248.9M</div>
                    <div className="text-[11px] text-text-muted mt-0.5">Bulk: R239M · VA: R9.9M · Blended GP: 36.2%</div>
                  </div>
                </div>

                <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
                  <SectionLabel text="OKR snapshot" />
                  {(['BULK','VA','DIGITAL'] as const).map(eng => {
                    const items = OKRS.filter(o => o.engine === eng)
                    const done  = items.filter(o => o.status === 'Complete').length
                    const risk  = items.filter(o => o.status === 'At Risk').length
                    return (
                      <div key={eng} className="flex items-center gap-4 py-3 border-b border-surface-rule last:border-0">
                        <div className="w-16 font-mono text-[10px] font-bold text-text-muted uppercase">{eng}</div>
                        <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                          <div className="h-full bg-brand rounded-full" style={{ width: `${(done/items.length)*100}%` }} />
                        </div>
                        <div className="text-[11px] text-text-muted font-mono w-16 text-right">{done}/{items.length} done</div>
                        {risk > 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-status-dangerBg text-status-danger">{risk} risk</span>
                        )}
                      </div>
                    )
                  })}
                  <button onClick={() => setTab('okrs')} className="mt-4 w-full text-[12px] text-brand hover:underline text-center flex items-center justify-center gap-1">
                    View all OKRs <ChevronRight size={12}/>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════════════════════════
              CUSTOMERS
          ════════════════════════════════════════════════════════════════ */}
          {tab === 'customers' && (
            <>
              {/* Filters */}
              <div className="flex gap-3 flex-wrap items-center">
                <div className="relative flex-1 min-w-[200px]">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name or region…"
                    className="w-full pl-8 pr-3 py-2 text-sm bg-surface-card border border-surface-rule rounded-lg focus:outline-none focus:border-brand"
                  />
                </div>
                {['ALL','T1','T2','T3'].map(t => (
                  <button key={t} onClick={() => setTier(t)}
                    className={`px-3 py-1.5 text-[12px] font-mono rounded-lg border transition-colors ${
                      tierFilter === t
                        ? 'bg-brand text-white border-brand'
                        : 'bg-surface-card border-surface-rule text-text-muted hover:text-text'
                    }`}>{t}</button>
                ))}
                <span className="text-[12px] text-text-muted">{filteredCustomers.length} accounts</span>
              </div>

              {/* Summary chips */}
              <div className="flex gap-3 flex-wrap">
                {[
                  { label: 'T1 accounts', value: customers.filter(c=>c.tier==='T1').length, color: 'blue' },
                  { label: 'T2 accounts', value: customers.filter(c=>c.tier==='T2').length, color: 'gray' },
                  { label: 'T3 / exit',   value: customers.filter(c=>c.tier==='T3').length, color: 'red'  },
                  { label: 'GP% ≥ 35%',  value: customers.filter(c=>c.ytdGP!==null&&c.ytdGP>=0.35).length, color: 'green' },
                  { label: 'Below target',value: customers.filter(c=>c.ytdGP!==null&&c.ytdGP<c.gpTgt).length, color: 'amber' },
                ].map((s, i) => (
                  <div key={i} className="bg-surface-card border border-surface-rule rounded-lg px-3 py-2 text-center min-w-[90px]">
                    <div className="font-display font-bold text-lg text-text">{s.value}</div>
                    <div className="font-mono text-[9px] text-text-muted uppercase tracking-wider">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Customer cards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredCustomers.map((c, i) => {
                  const ac = actionCol[c.action] ?? actionCol.MAINTAIN
                  return (
                    <div key={i} className="bg-surface-card border border-surface-rule rounded-xl p-4 hover:shadow-card-hover transition-shadow"
                      style={{ borderLeft: `3px solid ${gpCol(c.ytdGP)}` }}>
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-[13px] text-text leading-tight">{c.name}</div>
                          <div className="text-[11px] text-text-muted mt-0.5">{c.region} · {c.seg}</div>
                        </div>
                        <div className="flex gap-1.5 ml-2 shrink-0">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-surface text-text-muted border border-surface-rule">{c.tier}</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: ac.bg, color: ac.text }}>{c.action}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {[
                          { l: 'YTD Rev',   v: c.ytdRev > 0 ? fR(c.ytdRev) : '—' },
                          { l: 'Vol (kg)',  v: c.ytdVol > 0 ? fK(c.ytdVol) : '—' },
                          { l: 'GP%',       v: c.ytdGP !== null ? fP(c.ytdGP) : '—', col: gpText(c.ytdGP), bg: gpBg(c.ytdGP) },
                        ].map(m => (
                          <div key={m.l} className="rounded-lg p-2 text-center" style={{ background: (m as any).bg ?? '#f9fafb' }}>
                            <div className="font-mono text-[8px] text-text-muted uppercase mb-0.5">{m.l}</div>
                            <div className="font-bold text-[12px]" style={{ color: (m as any).col ?? '#111827' }}>{m.v}</div>
                          </div>
                        ))}
                      </div>

                      {c.ytdGP !== null && (
                        <div>
                          <div className="flex justify-between text-[10px] text-text-muted mb-1 font-mono">
                            <span>GP% vs target ({fP(c.gpTgt)})</span>
                            <span style={{ color: c.ytdGP >= c.gpTgt ? '#16a34a' : '#d97706' }}>
                              {c.ytdGP >= c.gpTgt ? '▲ On track' : `▼ ${((c.gpTgt - c.ytdGP)*100).toFixed(1)}pp below`}
                            </span>
                          </div>
                          <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{
                              width: `${Math.min((c.ytdGP/c.gpTgt)*100, 100)}%`,
                              background: c.ytdGP >= c.gpTgt ? '#16a34a' : '#d97706',
                            }} />
                          </div>
                        </div>
                      )}
                      {c.ytdGP === null && c.ytdRev === 0 && (
                        <div className="text-[10px] text-text-muted italic">No YTD activity — pipeline account</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════════════════════════
              PRODUCTS
          ════════════════════════════════════════════════════════════════ */}
          {tab === 'products' && (
            <>
              <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
                <SectionLabel text="Product mix by volume (kg) · YTD Jan–Apr 2026" />
                <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-[12px] text-amber-800">
                  <strong>Concentration risk:</strong> Super Grade = 47.5% of volume. Top 3 SKUs account for 76% of all dispatched volume. High dependency on single grade type.
                </div>
                <div className="h-64 mb-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={products} layout="vertical" barCategoryGap="25%">
                      <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                        tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="sku" width={190} tick={{ fontSize: 10, fill: '#374151' }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 11 }}
                        formatter={(v: any) => [`${((v as number)/1000).toFixed(0)}k kg`, 'YTD Volume'] as [string, string]}
                      />
                      <Bar dataKey="ytd" radius={[0,3,3,0]}>
                        {products.map((_, i) => (
                          <Cell key={i} fill={i === 0 ? '#2563eb' : i < 3 ? '#60a5fa' : '#bfdbfe'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Monthly breakdown table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-rule">
                        {['SKU','Jan (kg)','Feb (kg)','Mar (kg)','Apr (kg)','YTD (kg)','Mix %'].map(h => (
                          <th key={h} className="text-left py-2 px-3 font-mono text-[10px] tracking-wider text-text-muted uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-rule">
                      {products.map((p, i) => (
                        <tr key={i} className={`hover:bg-surface ${i < 3 ? 'font-semibold' : ''}`}>
                          <td className="py-2 px-3 text-text text-[12px]">{p.sku}</td>
                          {['Jan','Feb','Mar','Apr'].map(mo => {
                            const v = p.monthly[mo] ?? 0
                            return <td key={mo} className="py-2 px-3 font-mono text-[11px] text-text-muted">{v > 0 ? v.toLocaleString() : '—'}</td>
                          })}
                          <td className="py-2 px-3 font-mono text-[11px] text-text font-bold">{p.ytd.toLocaleString()}</td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-surface rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${p.pct*100}%`, background: i < 3 ? '#2563eb' : '#93c5fd' }} />
                              </div>
                              <span className="font-mono text-[10px] text-text-muted">{(p.pct*100).toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════════════════════════
              OKRs
          ════════════════════════════════════════════════════════════════ */}
          {tab === 'okrs' && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { l: 'Total OKRs',   v: OKRS.length,                                        col: 'text-text' },
                  { l: 'Complete',     v: OKRS.filter(o=>o.status==='Complete').length,        col: 'text-status-ok' },
                  { l: 'In Progress',  v: OKRS.filter(o=>o.status==='In Progress').length,     col: 'text-status-info' },
                  { l: 'At Risk',      v: OKRS.filter(o=>o.status==='At Risk').length,         col: 'text-status-danger' },
                ].map(s => (
                  <div key={s.l} className="bg-surface-card border border-surface-rule rounded-xl p-4 text-center">
                    <div className={`font-display font-bold text-3xl ${s.col}`}>{s.v}</div>
                    <div className="font-mono text-[10px] text-text-muted uppercase tracking-wider mt-1">{s.l}</div>
                  </div>
                ))}
              </div>

              {/* OKR groups */}
              {(['BULK','VA','DIGITAL'] as const).map(eng => (
                <div key={eng} className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-surface-rule bg-surface flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-brand" />
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-text">
                      Engine {eng === 'BULK' ? '1' : eng === 'VA' ? '2' : '3'} · {eng === 'BULK' ? 'Bulk Expansion' : eng === 'VA' ? 'Value-Add' : 'Digital'}
                    </span>
                  </div>
                  <div className="divide-y divide-surface-rule">
                    {OKRS.filter(o => o.engine === eng).map(okr => {
                      const sc = statusCol[okr.status]
                      const pc = prioCol[okr.priority]
                      return (
                        <div key={okr.id} className="px-5 py-4 hover:bg-surface">
                          <div className="flex items-start gap-4">
                            <span className="font-mono text-[10px] text-brand font-bold mt-0.5 w-14 shrink-0">{okr.id}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-medium text-text">{okr.obj}</div>
                              <div className="text-[11px] text-text-muted mt-0.5">
                                Owner: <span className="font-medium">{okr.owner}</span> · Due: <span className="font-mono">{okr.due}</span>
                              </div>
                              <div className="mt-2 flex items-center gap-3">
                                <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden max-w-[160px]">
                                  <div className="h-full rounded-full transition-all" style={{ width: `${okr.pct}%`, background: sc.bar }} />
                                </div>
                                <span className="font-mono text-[10px] text-text-muted">{okr.pct}%</span>
                              </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold" style={{ background: pc.bg, color: pc.text }}>{okr.priority}</span>
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold" style={{ background: sc.bg, color: sc.text }}>{okr.status}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </>
          )}

        </div>
      </div>
    </div>
  )
}