'use client'

// app/(app)/sales/page.tsx
// Single file — no sub-routes. All tabs live here.
// Tabs: Overview · Customers · Products · OKRs · Intelligence
// Data: seeded from CNTP_EXCO_Dashboard_2026_Redesign_3.xlsx

import React, { useState } from 'react'
import {
  TrendingUp, TrendingDown, Users, Package,
  BarChart3, Target, ChevronRight, Search,
  Cpu, AlertTriangle, CheckCircle2, Clock,
  ArrowUpRight, ArrowDownRight, Layers,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts'

// ─── Real data from CNTP_EXCO_Dashboard_2026_Redesign_3.xlsx ─────────────────

const KPI = {
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

const MONTHLY_DATA = [
  { month: 'Jan', actualRev: 14405912, targetRev: 18665279, actualVol: 231150, targetVol: 286563, gp: 5309616 },
  { month: 'Feb', actualRev: 9590923,  targetRev: 18665279, actualVol: 179045, targetVol: 286563, gp: 3566423 },
  { month: 'Mar', actualRev: 21611865, targetRev: 21153983, actualVol: 317199, targetVol: 324771, gp: 7359716 },
  { month: 'Apr', actualRev: 24917130, targetRev: 19909631, actualVol: 356945, targetVol: 305667, gp: 8236952 },
]

const CUSTOMERS = [
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

const PRODUCTS = [
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

type TabKey = 'overview' | 'customers' | 'products' | 'okrs' | 'intelligence'

export default function SalesPage() {
  const [tab, setTab]             = useState<TabKey>('overview')
  const [search, setSearch]       = useState('')
  const [tierFilter, setTier]     = useState('ALL')
  const [intelQuery, setQuery]    = useState('')
  const [intelResp, setResp]      = useState('')
  const [intelLoading, setLoad]   = useState(false)

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'overview',      label: 'Overview'      },
    { key: 'customers',     label: 'Customers'     },
    { key: 'products',      label: 'Product Mix'   },
    { key: 'okrs',          label: 'OKRs'          },
    { key: 'intelligence',  label: 'Intelligence'  },
  ]

  const filteredCustomers = CUSTOMERS.filter(c => {
    const s = search.toLowerCase()
    return (
      (c.name.toLowerCase().includes(s) || c.region.toLowerCase().includes(s)) &&
      (tierFilter === 'ALL' || c.tier === tierFilter)
    )
  })

  const runIntel = async (q: string) => {
    if (!q.trim()) return
    setLoad(true)
    setResp('')
    try {
      const context = `CNTP YTD Jan-Apr 2026: Revenue R70.5M (vs R229.9M 2025, -69.3% YoY — volume shift not pricing loss). Gross margin R24.5M at 34.7% (2025: 39.8%). Volume 1,092,439kg (-73.4% YoY). Avg Rev/kg R64.55 (+15.3% pricing improvement). Bulk R69.5M (98.6%), VA R982k (1.4%). Super Grade SKU = 47.1% of volume. Top 3 SKUs = 76% of volume. 31 active SKUs. Full year target: R248.9M.`
      const res  = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'agent', prompt: q, context }),
      })
      const data = await res.json()
      setResp(data.response ?? 'No response received.')
    } catch {
      setResp('Intelligence engine unavailable. Please try again.')
    } finally {
      setLoad(false)
    }
  }

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
              {/* KPI row */}
              <div>
                <SectionLabel text="Financial performance · YTD Jan–Apr 2026" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <KPICard label="Total revenue"  value={fR(KPI.totalRevenue)} sub={`vs ${fR(KPI.rev2025)} 2025`} up={false} />
                  <KPICard label="Gross margin"   value={fR(KPI.grossMargin)}  sub="R24.5M YTD" />
                  <KPICard label="Margin %"       value={fP(KPI.marginPct)}    sub={`2025: ${fP(KPI.margin2025)} · −5.1pp`} up={false} />
                  <KPICard label="Volume (kg)"    value={fK(KPI.volumeKg)}     sub={`vs ${fK(KPI.vol2025)} 2025`} up={false} />
                  <KPICard label="Avg rev / kg"   value={`R${KPI.avgRevPerKg.toFixed(2)}`} sub="+15.3% pricing uplift" up />
                  <KPICard label="Bulk revenue"   value={fR(KPI.bulkRevenue)}  sub="98.6% of total" />
                  <KPICard label="VA revenue"     value={`R${(KPI.vaRevenue/1000).toFixed(0)}k`} sub="1.4% — grow target" />
                  <KPICard label="Super Grade mix" value={fP(KPI.superGradeMix)} sub="515k kg · concentration risk" />
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Revenue vs Target */}
                <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
                  <SectionLabel text="Monthly revenue vs target (R)" />
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={MONTHLY_DATA} barGap={6} barCategoryGap="30%">
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
                          {MONTHLY_DATA.map((d, i) => (
                            <Cell key={i} fill={d.actualRev >= d.targetRev ? '#16a34a' : '#2563eb'} />
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
                      <AreaChart data={MONTHLY_DATA}>
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

              {/* Engine mix */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
                  <SectionLabel text="Revenue engine mix · YTD" />
                  {[
                    { label: 'Bulk Engine',      value: KPI.bulkRevenue, color: '#2563eb', pct: 0.986 },
                    { label: 'Value-Add Engine', value: KPI.vaRevenue,   color: '#7c3aed', pct: 0.014 },
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
                  { label: 'T1 accounts', value: CUSTOMERS.filter(c=>c.tier==='T1').length, color: 'blue' },
                  { label: 'T2 accounts', value: CUSTOMERS.filter(c=>c.tier==='T2').length, color: 'gray' },
                  { label: 'T3 / exit',   value: CUSTOMERS.filter(c=>c.tier==='T3').length, color: 'red'  },
                  { label: 'GP% ≥ 35%',  value: CUSTOMERS.filter(c=>c.ytdGP!==null&&c.ytdGP>=0.35).length, color: 'green' },
                  { label: 'Below target',value: CUSTOMERS.filter(c=>c.ytdGP!==null&&c.ytdGP<c.gpTgt).length, color: 'amber' },
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
                    <BarChart data={PRODUCTS} layout="vertical" barCategoryGap="25%">
                      <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                        tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="sku" width={190} tick={{ fontSize: 10, fill: '#374151' }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 11 }}
                        formatter={(v: any) => [`${((v as number)/1000).toFixed(0)}k kg`, 'YTD Volume'] as [string, string]}
                      />
                      <Bar dataKey="ytd" radius={[0,3,3,0]}>
                        {PRODUCTS.map((_, i) => (
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
                      {PRODUCTS.map((p, i) => (
                        <tr key={i} className={`hover:bg-surface ${i < 3 ? 'font-semibold' : ''}`}>
                          <td className="py-2 px-3 text-text text-[12px]">{p.sku}</td>
                          <td className="py-2 px-3 font-mono text-[11px] text-text-muted">{p.jan > 0 ? p.jan.toLocaleString() : '—'}</td>
                          <td className="py-2 px-3 font-mono text-[11px] text-text-muted">{p.feb > 0 ? p.feb.toLocaleString() : '—'}</td>
                          <td className="py-2 px-3 font-mono text-[11px] text-text-muted">{p.mar > 0 ? p.mar.toLocaleString() : '—'}</td>
                          <td className="py-2 px-3 font-mono text-[11px] text-text-muted">{p.apr > 0 ? p.apr.toLocaleString() : '—'}</td>
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

          {/* ════════════════════════════════════════════════════════════════
              INTELLIGENCE
          ════════════════════════════════════════════════════════════════ */}
          {tab === 'intelligence' && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 min-h-[600px]">
              {/* Left: query cards */}
              <div className="space-y-6">
                <div>
                  <SectionLabel text="Market intelligence · CNTP data loaded as context" />
                  <p className="text-[13px] text-text-muted leading-relaxed">
                    The engine has your current CNTP YTD numbers loaded. Ask it to compare against market benchmarks, 
                    suggest account actions, or scout new markets. Your raw customer data never leaves your server — only 
                    aggregated metrics are used as context.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { tag: 'Pricing',        q: 'How does our R64.55/kg avg pricing compare to global bulk rooibos market benchmarks?' },
                    { tag: 'Market entry',   q: 'What is the demand outlook for rooibos in Germany and Poland? We have two T2 accounts there.' },
                    { tag: 'VA strategy',    q: 'Our VA revenue is only 1.4% of total. What realistic target should we set and how do we grow it?' },
                    { tag: 'Volume recovery',q: 'Which markets should we target to recover the 73% YoY volume decline?' },
                    { tag: 'Rosehip synergy',q: 'What is the current rosehip market outlook and how does it complement our rooibos VA engine?' },
                    { tag: 'Account risk',   q: 'Analyse T3 accounts with <15% GP and recommend exit or reprice approach with talking points.' },
                    { tag: 'Japan relationship', q: 'How do we protect and grow our Japan relationship while diversifying into new markets?' },
                    { tag: 'Competitor scan',q: 'Who are the main competing bulk rooibos exporters and what are their pricing and positioning strategies?' },
                  ].map((s, i) => (
                    <button key={i} onClick={() => { setQuery(s.q); runIntel(s.q) }}
                      className="text-left p-4 bg-surface-card border border-surface-rule rounded-xl hover:border-brand hover:shadow-card transition-all group">
                      <div className="font-mono text-[9px] uppercase tracking-wider text-brand mb-2 font-bold">{s.tag}</div>
                      <p className="text-[12px] text-text-muted leading-relaxed group-hover:text-text transition-colors">{s.q}</p>
                      <div className="mt-3 text-[11px] text-brand flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        Run query <ChevronRight size={11}/>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Right: terminal */}
              <div className="bg-surface-card border border-surface-rule rounded-xl flex flex-col lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-180px)]">
                <div className="px-4 py-3 border-b border-surface-rule flex items-center gap-2">
                  <Cpu size={13} className="text-brand" />
                  <span className="font-mono text-[11px] font-bold text-text uppercase tracking-wider">Intelligence Engine</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${intelLoading ? 'bg-amber-400 animate-pulse' : 'bg-green-500'}`} />
                    <span className="font-mono text-[10px] text-text-muted">{intelLoading ? 'PROCESSING' : 'READY'}</span>
                  </div>
                </div>

                <div className="flex-1 p-4 overflow-y-auto text-[12px] leading-relaxed text-text font-mono min-h-[300px]">
                  {intelLoading ? (
                    <div className="h-full flex flex-col items-center justify-center gap-3 text-text-muted">
                      <div className="w-8 h-8 border-2 border-surface-rule border-t-brand rounded-full animate-spin" />
                      <span className="animate-pulse text-[11px]">Synthesising intelligence…</span>
                    </div>
                  ) : intelResp ? (
                    <div className="whitespace-pre-wrap">{intelResp}</div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center text-text-muted gap-3">
                      <Cpu size={32} className="text-surface-rule" />
                      <div>
                        <p className="text-[12px] font-medium">Select a query card</p>
                        <p className="text-[11px] mt-1">or type your own question below</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-3 border-t border-surface-rule">
                  <div className="relative">
                    <textarea
                      value={intelQuery}
                      onChange={e => setQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runIntel(intelQuery) }}}
                      placeholder="Ask about market conditions, account strategy, pricing…"
                      rows={3}
                      className="w-full text-[12px] bg-surface border border-surface-rule rounded-lg p-2.5 pr-10 text-text placeholder:text-text-muted focus:outline-none focus:border-brand resize-none"
                    />
                    <button onClick={() => runIntel(intelQuery)}
                      className="absolute bottom-3 right-2 w-7 h-7 bg-brand rounded-md flex items-center justify-center text-white hover:opacity-90">
                      <ChevronRight size={13}/>
                    </button>
                  </div>
                  <p className="text-[10px] text-text-muted mt-1.5 font-mono">Enter ↵ to send · Shift+Enter for new line</p>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}