'use client'

import { useState, useEffect } from 'react'
import { getDb } from '@/lib/supabase/db'
import { format, subDays, differenceInMinutes, parseISO } from 'date-fns'
import {
  TrendingUp, Clock, Target, CheckCircle2, AlertTriangle,
  Tag, Factory, ClipboardList, ArrowUpRight, ArrowDownRight,
  Minus, BarChart3, Zap, Calendar, RefreshCw,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────
interface KPI {
  label:     string
  value:     string
  sub:       string
  trend?:    'up' | 'down' | 'flat'
  trendVal?: string
  good?:     'up' | 'down'
  icon:      React.ReactNode
  color:     string
}

interface CountSession {
  id: string
  count_date: string
  match_rate_pct: number | null
  sup_confirmed_at: string | null
  adm_confirmed_at: string | null
  sup_total_kg: number | null
  adm_total_kg: number | null
  comparison_status: string | null
}

interface ProdSession {
  id: string
  date: string
  section_id: string
  section_name: string
  status: string
  submitted_at: string | null
  approved_at: string | null
  created_at: string
}

interface BagTag {
  id: string
  captured_at: string
  section_id: string
  ocr_confidence: string | null
  ocr_corrected: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────
const BASELINE_MORNING_MINUTES = 90
const DIGITAL_MORNING_MINUTES  = 20
const STAFF_COST_PER_MIN       = 0.83
const WORKING_DAYS_PER_YEAR    = 252

// ── Sparkline ─────────────────────────────────────────────────────────────────
function SparkBar({ values, color = 'bg-brand' }: { values: number[]; color?: string }) {
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-0.5 h-8">
      {values.map((v, i) => (
        <div
          key={i}
          style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
          className={`flex-1 rounded-sm ${color} ${i === values.length - 1 ? 'opacity-100' : 'opacity-40'}`}
        />
      ))}
    </div>
  )
}

// ── Trend badge ───────────────────────────────────────────────────────────────
function TrendBadge({ trend, val, good }: { trend?: 'up'|'down'|'flat'; val?: string; good?: 'up'|'down' }) {
  if (!trend || !val) return null
  const isPositive = trend === good
  const isFlat     = trend === 'flat'
  return (
    <span className={`flex items-center gap-0.5 font-mono text-[10px] px-1.5 py-0.5 rounded-md ${
      isFlat     ? 'bg-surface text-text-muted' :
      isPositive ? 'bg-ok/10 text-ok' : 'bg-err/10 text-err'
    }`}>
      {trend === 'up'   && <ArrowUpRight size={9}/>}
      {trend === 'down' && <ArrowDownRight size={9}/>}
      {trend === 'flat' && <Minus size={9}/>}
      {val}
    </span>
  )
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ kpi }: { kpi: KPI }) {
  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className={`w-9 h-9 rounded-xl ${kpi.color} flex items-center justify-center`}>
          {kpi.icon}
        </div>
        <TrendBadge trend={kpi.trend} val={kpi.trendVal} good={kpi.good}/>
      </div>
      <div>
        <div className="font-display font-bold text-[28px] text-text leading-none">{kpi.value}</div>
        <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mt-1">{kpi.label}</div>
      </div>
      <div className="font-body text-[12px] text-text-muted leading-relaxed">{kpi.sub}</div>
    </div>
  )
}

// ── Accuracy row ──────────────────────────────────────────────────────────────
function AccuracyRow({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="font-mono text-[11px] text-text-muted w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }}/>
      </div>
      <span className="font-display font-bold text-[13px] text-text w-10 text-right">{pct}%</span>
    </div>
  )
}

// ── Phase tracker ─────────────────────────────────────────────────────────────
const PHASES = [
  { name:'Morning count',       status:'live',    pct:100, detail:'Both roles live. Auto-compare active.' },
  { name:'Bag tag capture',     status:'live',    pct:60,  detail:'Sieving Tower pilot. Rolling to all sections.' },
  { name:'Production capture',  status:'active',  pct:45,  detail:'All section forms built. Adoption in progress.' },
  { name:'Notes & info pages',  status:'live',    pct:100, detail:'Floor staff reference guides deployed.' },
  { name:'QR scanning',         status:'planned', pct:0,   detail:'Planned — date to be confirmed.' },
  { name:'Acumatica API push',  status:'planned', pct:0,   detail:'Pending API credentials from management.' },
  { name:'Dispatch & receiving',status:'planned', pct:0,   detail:'Phase 2 — after production capture stable.' },
]

// ── Main ──────────────────────────────────────────────────────────────────────
export default function StatusPage() {
  const [loading,      setLoading]    = useState(true)
  const [lastRefresh,  setLastRefresh]= useState(new Date())
  const [countSessions,setCount]      = useState<CountSession[]>([])
  const [prodSessions, setProd]       = useState<ProdSession[]>([])
  const [bagTags,      setBagTags]    = useState<BagTag[]>([])

  async function load() {
    setLoading(true)
    const db  = getDb()
    const d30 = format(subDays(new Date(), 30), 'yyyy-MM-dd')

    const [c, p, t] = await Promise.all([
      // Count sessions — no schema prefix (sc_ tables are in public)
      db.from('sc_sessions')
        .select('id,count_date,match_rate_pct,sup_confirmed_at,adm_confirmed_at,sup_total_kg,adm_total_kg,comparison_status')
        .gte('count_date', d30)
        .order('count_date', { ascending: false }),

      // Production sessions — MUST use .schema('production')
      db.schema('production').from('prod_sessions')
        .select('id,date,section_id,section_name,status,submitted_at,approved_at,created_at')
        .gte('date', d30)
        .order('date', { ascending: false }),

      // Bag tags — public schema
      db.from('bag_tags')
        .select('id,captured_at,section_id,ocr_confidence,ocr_corrected')
        .gte('captured_at', d30),
    ])

    setCount((c.data  as CountSession[]) ?? [])
    setProd((p.data   as ProdSession[])  ?? [])
    setBagTags((t.data as BagTag[])      ?? [])
    setLoading(false)
    setLastRefresh(new Date())
  }

  useEffect(() => { load() }, [])

  // ── Derived — count ────────────────────────────────────────────────────────
  const sessionsWithBoth = countSessions.filter(s => s.sup_confirmed_at && s.adm_confirmed_at)
  const avgAccuracy      = sessionsWithBoth.length
    ? Math.round(sessionsWithBoth.reduce((s,r) => s + (r.match_rate_pct ?? 0), 0) / sessionsWithBoth.length)
    : null
  const perfectMatches   = sessionsWithBoth.filter(s => (s.match_rate_pct ?? 0) >= 99).length

  const digitalSessionTimes = sessionsWithBoth
    .filter(s => s.sup_confirmed_at && s.adm_confirmed_at)
    .map(s => differenceInMinutes(parseISO(s.adm_confirmed_at!), parseISO(s.sup_confirmed_at!)))
    .filter(m => m > 0 && m < 240)
  const avgDigitalTime   = digitalSessionTimes.length
    ? Math.round(digitalSessionTimes.reduce((a,b) => a+b, 0) / digitalSessionTimes.length)
    : null
  const timeSavedPerDay  = avgDigitalTime != null
    ? Math.max(0, BASELINE_MORNING_MINUTES - avgDigitalTime)
    : BASELINE_MORNING_MINUTES - DIGITAL_MORNING_MINUTES
  const timeSavedTotal   = sessionsWithBoth.length * timeSavedPerDay
  const costSavedTotal   = Math.round(timeSavedTotal * STAFF_COST_PER_MIN)
  const annualisedSaving = Math.round(timeSavedPerDay * STAFF_COST_PER_MIN * WORKING_DAYS_PER_YEAR)

  // Match rate trend — last 7d vs previous 7d
  const d7  = format(subDays(new Date(), 7),  'yyyy-MM-dd')
  const d14 = format(subDays(new Date(), 14), 'yyyy-MM-dd')
  const recent7  = countSessions.filter(s => s.count_date >= d7)
  const prev7    = countSessions.filter(s => s.count_date >= d14 && s.count_date < d7)
  const avg7     = recent7.length  ? recent7.reduce((a,b)  => a + (b.match_rate_pct??0), 0) / recent7.length  : 0
  const avgPrev7 = prev7.length    ? prev7.reduce((a,b)    => a + (b.match_rate_pct??0), 0) / prev7.length    : 0
  const matchTrend: 'up'|'down'|'flat' = avg7 > avgPrev7+1 ? 'up' : avg7 < avgPrev7-1 ? 'down' : 'flat'

  // ── Derived — production ───────────────────────────────────────────────────
  const prodDraft     = prodSessions.filter(s => s.status === 'draft').length
  const prodSubmitted = prodSessions.filter(s => s.status === 'submitted').length
  const prodApproved  = prodSessions.filter(s => s.status === 'approved').length
  const prodTotal     = prodSessions.length

  // Adoption = submitted + approved out of all sessions started
  const adoptionPct = prodTotal > 0
    ? Math.round(((prodSubmitted + prodApproved) / prodTotal) * 100)
    : 0

  // Avg time from session created_at to submitted_at (minutes)
  const submitTimes = prodSessions
    .filter(s => s.submitted_at && s.created_at)
    .map(s => differenceInMinutes(parseISO(s.submitted_at!), parseISO(s.created_at)))
    .filter(m => m >= 0 && m < 600)
  const avgSubmitTime = submitTimes.length
    ? Math.round(submitTimes.reduce((a,b) => a+b, 0) / submitTimes.length)
    : null

  // Section breakdown — which sections are most active
  const sectionCounts: Record<string, number> = {}
  prodSessions.forEach(s => {
    const name = s.section_name || s.section_id
    sectionCounts[name] = (sectionCounts[name] || 0) + 1
  })
  const topSections = Object.entries(sectionCounts)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 4)

  // Production adoption trend — last 7d vs prev 7d
  const prodRecent7  = prodSessions.filter(s => s.date >= d7).length
  const prodPrev7    = prodSessions.filter(s => s.date >= d14 && s.date < d7).length
  const prodTrend: 'up'|'down'|'flat' = prodRecent7 > prodPrev7 ? 'up' : prodRecent7 < prodPrev7 ? 'down' : 'flat'

  // ── Derived — OCR/tags ─────────────────────────────────────────────────────
  const totalTags     = bagTags.length
  const highConfTags  = bagTags.filter(t => t.ocr_confidence === 'high').length
  const correctedTags = bagTags.filter(t => t.ocr_corrected).length
  const ocrAccuracy   = totalTags > 0 ? Math.round((highConfTags / totalTags) * 100) : null

  // ── Sparklines ─────────────────────────────────────────────────────────────
  const weeklyCountCounts: number[] = []
  for (let w = 7; w >= 0; w--) {
    const start = format(subDays(new Date(), w*7+7), 'yyyy-MM-dd')
    const end   = format(subDays(new Date(), w*7),   'yyyy-MM-dd')
    weeklyCountCounts.push(countSessions.filter(s => s.count_date >= start && s.count_date < end).length)
  }

  const weeklyProdCounts: number[] = []
  for (let w = 7; w >= 0; w--) {
    const start = format(subDays(new Date(), w*7+7), 'yyyy-MM-dd')
    const end   = format(subDays(new Date(), w*7),   'yyyy-MM-dd')
    weeklyProdCounts.push(prodSessions.filter(s => s.date >= start && s.date < end).length)
  }

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis: KPI[] = [
    {
      label:    'Avg count accuracy',
      value:    avgAccuracy != null ? `${avgAccuracy}%` : '—',
      sub:      `${perfectMatches} of ${sessionsWithBoth.length} sessions matched perfectly (≥99%)`,
      trend:    matchTrend,
      trendVal: 'vs prev 7d',
      good:     'up',
      icon:     <Target size={17} className="text-white"/>,
      color:    'bg-ok',
    },
    {
      label:    'Time saved to date',
      value:    timeSavedTotal >= 60
        ? `${Math.floor(timeSavedTotal/60)}h ${timeSavedTotal%60}m`
        : `${timeSavedTotal}m`,
      sub:      `~${timeSavedPerDay}min saved per count vs paper baseline of ${BASELINE_MORNING_MINUTES}min`,
      trend:    'up',
      trendVal: `${sessionsWithBoth.length} sessions`,
      good:     'up',
      icon:     <Clock size={17} className="text-white"/>,
      color:    'bg-brand',
    },
    {
      label:    'Cost saved to date',
      value:    `R${costSavedTotal.toLocaleString('en-ZA')}`,
      sub:      `Blended staff rate. Annualised: R${annualisedSaving.toLocaleString('en-ZA')}/yr`,
      trend:    'up',
      trendVal: 'rolling',
      good:     'up',
      icon:     <TrendingUp size={17} className="text-white"/>,
      color:    'bg-purple-500',
    },
    {
      label:    'Count sessions (30d)',
      value:    String(sessionsWithBoth.length),
      sub:      `${countSessions.length} total started · ${sessionsWithBoth.length} fully completed`,
      icon:     <ClipboardList size={17} className="text-white"/>,
      color:    'bg-blue-500',
    },
    {
      label:    'Production sessions (30d)',
      value:    String(prodTotal),
      sub:      prodTotal > 0
        ? `${prodApproved} approved · ${prodSubmitted} awaiting sign-off · ${prodDraft} draft`
        : 'No sessions recorded yet',
      trend:    prodTrend,
      trendVal: 'vs prev 7d',
      good:     'up',
      icon:     <Factory size={17} className="text-white"/>,
      color:    'bg-emerald-500',
    },
    {
      label:    'Production adoption',
      value:    `${adoptionPct}%`,
      sub:      avgSubmitTime != null
        ? `Avg ${avgSubmitTime}min from start to submission · ${prodSubmitted + prodApproved} submitted`
        : `${prodSubmitted + prodApproved} of ${prodTotal} sessions submitted in 30d`,
      trend:    adoptionPct > 50 ? 'up' : adoptionPct > 0 ? 'flat' : 'down',
      trendVal: 'adoption',
      good:     'up',
      icon:     <TrendingUp size={17} className="text-white"/>,
      color:    'bg-red-500',
    },
    {
      label:    'Bag tags captured',
      value:    String(totalTags),
      sub:      ocrAccuracy != null
        ? `${ocrAccuracy}% OCR high-confidence · ${correctedTags} manually corrected`
        : 'No tags captured yet — pilot Sieving Tower first',
      icon:     <Tag size={17} className="text-white"/>,
      color:    'bg-amber-500',
    },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="px-6 py-6 space-y-8 max-w-[1200px]">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-[26px] text-text">Platform analytics</h1>
          <p className="font-body text-[13px] text-text-muted mt-0.5">
            Real-time impact of digitisation · Cape Natural Tea Products · BHW
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-card border border-surface-rule font-mono text-[11px] text-text-muted hover:text-text transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''}/>
          Refresh · {format(lastRefresh, 'HH:mm')}
        </button>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map(kpi => <KpiCard key={kpi.label} kpi={kpi}/>)}
      </div>

      {/* Two column — count activity + production activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Count sessions */}
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div className="font-display font-bold text-[15px] text-text">Count sessions</div>
            <span className="font-mono text-[10px] text-text-muted">Last 8 weeks</span>
          </div>
          <SparkBar values={weeklyCountCounts} color="bg-brand"/>
          <div className="border-t border-surface-rule pt-4 space-y-1">
            <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-3">Match rate breakdown</div>
            {[
              { label:'≥ 99% match', pct: sessionsWithBoth.length ? Math.round(sessionsWithBoth.filter(s=>(s.match_rate_pct??0)>=99).length/sessionsWithBoth.length*100) : 0, color:'bg-ok' },
              { label:'95–99%',      pct: sessionsWithBoth.length ? Math.round(sessionsWithBoth.filter(s=>(s.match_rate_pct??0)>=95&&(s.match_rate_pct??0)<99).length/sessionsWithBoth.length*100) : 0, color:'bg-blue-400' },
              { label:'90–95%',      pct: sessionsWithBoth.length ? Math.round(sessionsWithBoth.filter(s=>(s.match_rate_pct??0)>=90&&(s.match_rate_pct??0)<95).length/sessionsWithBoth.length*100) : 0, color:'bg-warn' },
              { label:'< 90%',       pct: sessionsWithBoth.length ? Math.round(sessionsWithBoth.filter(s=>(s.match_rate_pct??0)<90).length/sessionsWithBoth.length*100) : 0, color:'bg-err' },
            ].map(r => <AccuracyRow key={r.label} {...r}/>)}
          </div>
        </div>

        {/* Production sessions */}
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div className="font-display font-bold text-[15px] text-text">Production capture</div>
            <span className="font-mono text-[10px] text-text-muted">Last 8 weeks</span>
          </div>
          <SparkBar values={weeklyProdCounts} color="bg-emerald-500"/>

          {/* Status breakdown */}
          <div className="border-t border-surface-rule pt-4">
            <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-3">Status breakdown (30d)</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label:'Approved', value:prodApproved, color:'text-ok',   bg:'bg-ok/8 border-ok/20'      },
                { label:'Submitted',value:prodSubmitted,color:'text-info',  bg:'bg-info/8 border-info/20'  },
                { label:'Draft',    value:prodDraft,    color:'text-warn',  bg:'bg-warn/8 border-warn/20'  },
              ].map(s => (
                <div key={s.label} className={`rounded-xl border px-3 py-2.5 text-center ${s.bg}`}>
                  <div className={`font-display font-bold text-[22px] ${s.color}`}>{s.value}</div>
                  <div className={`font-mono text-[9px] uppercase tracking-wide ${s.color} opacity-70`}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Section activity */}
          {topSections.length > 0 && (
            <div className="border-t border-surface-rule pt-4">
              <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-3">Most active sections</div>
              <div className="space-y-1.5">
                {topSections.map(([name, count]) => (
                  <div key={name} className="flex items-center gap-3">
                    <span className="font-mono text-[11px] text-text-muted w-32 shrink-0 truncate">{name}</span>
                    <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${Math.round((count / prodTotal) * 100)}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] text-text w-6 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Phase tracker */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl p-5">
        <div className="font-display font-bold text-[15px] text-text mb-4">Digitisation roadmap</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          {PHASES.map(phase => (
            <div key={phase.name} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {phase.status==='live'    && <CheckCircle2 size={13} className="text-ok shrink-0"/>}
                  {phase.status==='active'  && <Zap size={13} className="text-warn shrink-0"/>}
                  {phase.status==='planned' && <Calendar size={13} className="text-text-muted/40 shrink-0"/>}
                  <span className="font-body font-medium text-[13px] text-text truncate">{phase.name}</span>
                </div>
                <span className={`font-mono text-[10px] shrink-0 px-2 py-0.5 rounded-md ${
                  phase.status==='live'   ? 'bg-ok/10 text-ok' :
                  phase.status==='active' ? 'bg-warn/10 text-warn' :
                                            'bg-surface text-text-muted'
                }`}>
                  {phase.status==='live' ? 'Live' : phase.status==='active' ? 'In progress' : 'Planned'}
                </span>
              </div>
              <div className="h-1.5 bg-surface rounded-full overflow-hidden ml-5">
                <div className={`h-full rounded-full transition-all duration-700 ${
                  phase.status==='live'   ? 'bg-ok' :
                  phase.status==='active' ? 'bg-warn' : 'bg-surface-rule'
                }`} style={{ width:`${phase.pct}%` }}/>
              </div>
              <p className="font-mono text-[10px] text-text-muted ml-5">{phase.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ROI breakdown */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-5">
          <BarChart3 size={16} className="text-brand"/>
          <div className="font-display font-bold text-[15px] text-text">Return on investment breakdown</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: 'Paper eliminated',
              value: `${sessionsWithBoth.length * 4}`,
              unit:  'sheets/session avg',
              sub:   `${sessionsWithBoth.length} completed count sessions`,
              color: 'text-ok',
            },
            {
              label: 'Manual calculations removed',
              value: `${sessionsWithBoth.length * 2}`,
              unit:  'auto-comparisons run',
              sub:   'Previously done manually per session',
              color: 'text-blue-400',
            },
            {
              label: 'Staff hours recovered',
              value: `${Math.round(timeSavedTotal / 60)}`,
              unit:  'hours saved so far',
              sub:   `At ~${timeSavedPerDay}min saved per session`,
              color: 'text-purple-400',
            },
            {
              label: 'Projected annual saving',
              value: `R${annualisedSaving.toLocaleString('en-ZA')}`,
              unit:  'per year (staff cost only)',
              sub:   `Based on ${WORKING_DAYS_PER_YEAR} working days`,
              color: 'text-amber-400',
            },
          ].map(item => (
            <div key={item.label} className="bg-surface rounded-xl p-4 space-y-1">
              <div className={`font-display font-bold text-[24px] ${item.color}`}>{item.value}</div>
              <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide">{item.unit}</div>
              <div className="font-body text-[11px] text-text-muted leading-relaxed pt-1">{item.sub}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 px-4 py-3 bg-surface rounded-xl border border-surface-rule">
          <p className="font-mono text-[10px] text-text-muted leading-relaxed">
            <span className="text-text font-medium">Assumptions: </span>
            Paper baseline = {BASELINE_MORNING_MINUTES}min/session ·
            Blended staff cost = R50/hr ·
            {WORKING_DAYS_PER_YEAR} working days/yr ·
            Time saved calculated from actual sup→adm confirmation gap where available.
            Update constants in <code className="bg-surface-rule px-1 rounded">app/(app)/status/page.tsx</code> as data accumulates.
          </p>
        </div>
      </div>

      {/* Recent count sessions table */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-rule">
          <div className="font-display font-bold text-[15px] text-text">Recent count sessions</div>
          <span className="font-mono text-[10px] text-text-muted">Last 10</span>
        </div>
        {loading ? (
          <div className="px-5 py-8 text-center font-mono text-[12px] text-text-muted animate-pulse">Loading…</div>
        ) : sessionsWithBoth.length === 0 ? (
          <div className="px-5 py-8 text-center font-mono text-[12px] text-text-muted">No completed sessions yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface border-b border-surface-rule">
                  {['Date','Match rate','Sup kg','Adm kg','Variance','Status'].map(h => (
                    <th key={h} className="px-5 py-2.5 font-mono text-[10px] uppercase tracking-wide text-text-muted whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-rule">
                {sessionsWithBoth.slice(0,10).map(s => {
                  const variance = Math.abs((s.sup_total_kg??0) - (s.adm_total_kg??0))
                  const rate     = s.match_rate_pct ?? 0
                  return (
                    <tr key={s.id} className="hover:bg-surface transition-colors">
                      <td className="px-5 py-3 font-mono text-[12px] text-text whitespace-nowrap">
                        {format(parseISO(s.count_date), 'd MMM yyyy')}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`font-display font-bold text-[14px] ${
                          rate>=99?'text-ok':rate>=95?'text-blue-400':rate>=90?'text-warn':'text-err'
                        }`}>{rate}%</span>
                      </td>
                      <td className="px-5 py-3 font-mono text-[12px] text-text-muted">
                        {(s.sup_total_kg??0).toLocaleString('en-ZA',{maximumFractionDigits:0})} kg
                      </td>
                      <td className="px-5 py-3 font-mono text-[12px] text-text-muted">
                        {(s.adm_total_kg??0).toLocaleString('en-ZA',{maximumFractionDigits:0})} kg
                      </td>
                      <td className="px-5 py-3 font-mono text-[12px]">
                        <span className={variance>100?'text-err':variance>20?'text-warn':'text-ok'}>
                          {variance.toLocaleString('en-ZA',{maximumFractionDigits:0})} kg
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`font-mono text-[10px] px-2 py-0.5 rounded-md ${
                          s.comparison_status==='match'       ? 'bg-ok/10 text-ok' :
                          s.comparison_status==='differences' ? 'bg-warn/10 text-warn' :
                                                                'bg-surface text-text-muted'
                        }`}>
                          {s.comparison_status ?? 'pending'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent production sessions table */}
      {prodSessions.length > 0 && (
        <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-rule">
            <div className="font-display font-bold text-[15px] text-text">Recent production sessions</div>
            <span className="font-mono text-[10px] text-text-muted">Last 10</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface border-b border-surface-rule">
                  {['Date','Section','Status','Submitted'].map(h => (
                    <th key={h} className="px-5 py-2.5 font-mono text-[10px] uppercase tracking-wide text-text-muted whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-rule">
                {prodSessions.slice(0,10).map(s => (
                  <tr key={s.id} className="hover:bg-surface transition-colors">
                    <td className="px-5 py-3 font-mono text-[12px] text-text whitespace-nowrap">
                      {format(parseISO(s.date), 'd MMM yyyy')}
                    </td>
                    <td className="px-5 py-3 font-mono text-[12px] text-text-muted">
                      {s.section_name || s.section_id}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`font-mono text-[10px] px-2 py-0.5 rounded-md ${
                        s.status==='approved'  ? 'bg-ok/10 text-ok' :
                        s.status==='submitted' ? 'bg-info/10 text-info' :
                        s.status==='draft'     ? 'bg-warn/10 text-warn' :
                                                  'bg-surface text-text-muted'
                      }`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-[12px] text-text-muted">
                      {s.submitted_at ? format(parseISO(s.submitted_at), 'HH:mm') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  )
}