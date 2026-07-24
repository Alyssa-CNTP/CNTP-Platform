'use client'

// components/production/ProductionDashboard.tsx
// Production manager's KPI cockpit — redesigned to surface yields, machine
// parameters derived from capture checks, and quality integration (PSD vs
// machine settings). Three tabs: Yields · Machine KPIs · Quality Integration.

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, Legend,
} from 'recharts'
import {
  RefreshCw, Scale, Percent, Activity, CheckCircle2, AlertTriangle,
  Wrench, CalendarRange, ClipboardList, Users, ChevronRight,
  Map as MapIcon, TrendingUp, Cpu, FlaskConical, Info, Boxes,
} from 'lucide-react'
import { format } from 'date-fns'
import { getDb } from '@/lib/supabase/db'
import { sectionMeta, SECTION_ORDER, MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'
import { fetchGranuleQuality } from '@/lib/production/granule-quality'
import { EnergyWidget } from '@/components/maintenance/EnergyWidget'
import AiAnalystPanel from '@/components/maintenance/AiAnalystPanel'
import OperationalTrends from '@/components/management/OperationalTrends'
import { FactoryFloorPlan } from '@/components/production/FactoryFloorPlan'

const C = { brand: '#1A3A0E', accent: '#5A8A2A', azure: '#2A7CB8', warn: '#B85C0A', err: '#B81C1C', ok: '#1A7A3C', info: '#2A7CB8', gray: '#96A88A' }
// Categorical palette for the output-mix bars — brand-anchored, distinguishable.
const MIX = ['#1A3A0E', '#5A8A2A', '#2A7CB8', '#B85C0A', '#7A5AA8', '#B81C1C', '#96A88A', '#3C8A6A']
const round1 = (n: number) => Math.round(n * 10) / 10

// ── Info tooltip ──────────────────────────────────────────────────────────────
// Shows a floating tooltip with formula/methodology when clicked.
function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold text-text-muted hover:text-text hover:bg-surface-dim border border-surface-rule transition cursor-help"
        aria-label="How is this calculated?"
      >
        <Info size={9} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-50 bottom-6 left-1/2 -translate-x-1/2 w-64 p-3 rounded-xl border border-surface-rule bg-surface-card shadow-xl text-[11px] text-text-muted leading-relaxed"
        >
          {text}
          <button
            onClick={() => setOpen(false)}
            className="block mt-2 ml-auto text-[10px] text-text-faint hover:text-text"
          >
            Close ×
          </button>
        </div>
      )}
    </span>
  )
}

// ── KPI tile ──────────────────────────────────────────────────────────────────
function Kpi({ label, value, icon: Icon, tone, loading, info }: {
  label: string; value: string; icon: typeof Scale; tone: 'ok' | 'warn' | 'err' | 'info'; loading: boolean; info?: string
}) {
  const accent = { ok: C.ok, warn: C.warn, err: C.err, info: C.azure }[tone]
  const tint = { ok: 'rgba(26,122,60,0.06)', warn: 'rgba(184,92,10,0.06)', err: 'rgba(184,28,28,0.06)', info: 'rgba(42,124,184,0.05)' }[tone]
  return (
    <div className="rounded-xl border border-surface-rule p-4" style={{ borderLeft: `3px solid ${accent}`, background: tint }}>
      <div className="flex items-center justify-between">
        <Icon size={14} style={{ color: accent }} />
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
      </div>
      <div className="text-[22px] leading-none font-semibold mt-2" style={{ color: accent }}>
        {loading ? '—' : value}
      </div>
      <div className="flex items-center mt-1">
        <span className="text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
        {info && <InfoTip text={info} />}
      </div>
    </div>
  )
}

// ── Quick link chip ───────────────────────────────────────────────────────────
function QuickChip({ href, icon: Icon, label }: { href: string; icon: typeof Scale; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-rule bg-surface-card px-2.5 py-1.5 text-[12px] text-text hover:border-brand/40 hover:text-brand transition">
      <Icon size={13} /> {label}
    </Link>
  )
}

// ── Chart wrapper ─────────────────────────────────────────────────────────────
function Chart({ title, subtitle, info, children }: { title: string; subtitle: string; info?: string; children: React.ReactElement }) {
  return (
    <div>
      <div className="mb-2 flex items-start gap-1">
        <div>
          <div className="flex items-center gap-0.5">
            <h3 className="text-sm font-semibold text-text">{title}</h3>
            {info && <InfoTip text={info} />}
          </div>
          <p className="text-[11px] text-text-muted">{subtitle}</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>{children}</ResponsiveContainer>
    </div>
  )
}

// ── Compliance badge ──────────────────────────────────────────────────────────
function CompBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[11px] text-text-faint">—</span>
  const tone = pct >= 90 ? 'ok' : pct >= 75 ? 'warn' : 'err'
  const cls = { ok: 'bg-ok/10 text-ok', warn: 'bg-warn/10 text-warn', err: 'bg-err/10 text-err' }[tone]
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${cls}`}>{pct}%</span>
}

// ── Section title ───────────────────────────────────────────────────────────────
// Heads each grouped block in the single-scroll cockpit (replaces the old tabs).
function SectionTitle({ icon: Icon, title, subtitle }: { icon: typeof Scale; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${C.brand}12` }}>
        <Icon size={15} style={{ color: C.brand }} />
      </span>
      <div>
        <h3 className="text-[15px] font-semibold text-text leading-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-text-muted">{subtitle}</p>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

interface MachineParam { checkKey: string; checkLabel: string; valueNum: number; unit: string; sectionId: string; date: string; shift: string; recordedAt: string; status: string }
interface PsdRun { id: string; date: string; lotNumber: string; variant: string; product: string; sieveResults: Record<string, any>; bulkDensity: string; passStatus: string; grade: string }
interface CheckComp { sectionId: string; total: number; ok: number; flagged: number; fail: number; ratePct: number | null }
interface DailyYield { date: string; label: string; outputKg: number; inputKg: number; sessions: number; yieldPct: number | null }
interface SectionYield { sectionId: string; inputKg: number; outputKg: number; sessions: number }
interface TodaySummary { date: string; outputKg: number; inputKg: number; yieldPct: number | null; sessions: number; activeSections: number; complianceRate: number | null }

const SESSION_STATUS: Record<string, { label: string; cls: string }> = {
  none: { label: 'Idle', cls: 'bg-stone-100 text-stone-500' },
  draft: { label: 'Capturing', cls: 'bg-warn/10 text-warn' },
  submitted: { label: 'Submitted', cls: 'bg-info/10 text-info' },
  approved: { label: 'Signed off', cls: 'bg-ok/10 text-ok' },
}

export default function ProductionDashboard() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [windowDays, setWindowDays] = useState(14)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Data from new manager-kpis API
  const [todaySummary, setTodaySummary] = useState<TodaySummary | null>(null)
  const [dailyYield, setDailyYield] = useState<DailyYield[]>([])
  const [yieldBySection, setYieldBySection] = useState<SectionYield[]>([])
  const [machineParams, setMachineParams] = useState<MachineParam[]>([])
  const [checkCompliance, setCheckCompliance] = useState<CheckComp[]>([])
  const [psdRuns, setPsdRuns] = useState<PsdRun[]>([])

  // Section status (today) — still from direct DB for live view
  const [todayRows, setTodayRows] = useState<any[]>([])
  const [breakdowns, setBreakdowns] = useState<any[]>([])

  // Batch-spine analytics (folded in from the old standalone Analytics page):
  // per-product output share + the batch grid linking yield to quality.
  const [outputMix, setOutputMix] = useState<{ productType: string; kg: number; sharePct: number | null }[]>([])
  const [batches, setBatches] = useState<any[]>([])
  const [batchSort, setBatchSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'lastDate', dir: -1 })

  // Granule KPI foundations — scale-verification health + granule quality readings
  const [granuleScale, setGranuleScale] = useState<{ date: string; label: string; dev: number; readings: number }[]>([])
  const [granuleQuality, setGranuleQuality] = useState<{ date: string; label: string; moisture: number | null; bulkDensity: number | null }[]>([])
  const [scaleAudit, setScaleAudit] = useState<{ date: string; label: string; shift: string; std: number | null; actual: number | null; dev: number | null; pass: boolean; at: string }[]>([])

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true)
    const db = getDb()

    // Fetch KPI data from API + section status + breakdowns in parallel
    const [kpiRes, { data: sess }, { data: bags }, { data: bd }] = await Promise.all([
      fetch(`/api/production/manager-kpis?days=${windowDays}`).then(r => r.json()),
      db.schema('production').from('prod_sessions').select('id,section_id,status,date').eq('date', today).is('deleted_at', null),
      db.schema('production').from('bag_tags').select('section_id,weight_kg').gte('created_at', `${today}T00:00:00`),
      db.schema('maintenance').from('job_cards').select('card_no,area,machine,status,raised_at').eq('workflow', 'breakdown').neq('status', 'complete'),
    ])

    // KPI API data
    if (!kpiRes.error) {
      setTodaySummary(kpiRes.today)
      setDailyYield(kpiRes.dailyYield || [])
      setYieldBySection(kpiRes.yieldBySection || [])
      setMachineParams(kpiRes.machineParams || [])
      setCheckCompliance(kpiRes.checkCompliance || [])
      setPsdRuns(kpiRes.psdRuns || [])
    }

    // Batch-spine analytics — output mix + batch grid (best-effort; the views
    // may not be populated yet on every environment).
    fetch(`/api/production/yield-analytics?days=${windowDays}`)
      .then(r => r.json())
      .then(j => { if (!j.error) { setOutputMix(j.outputMix || []); setBatches(j.batches || []) } })
      .catch(() => {})

    // Build today's section rows from direct DB data
    const sessRows: any[] = sess || []
    const bagsData: any[] = bags || []
    const sessIds = sessRows.map(s => s.id)
    let mbRows: any[] = []
    if (sessIds.length) {
      const { data } = await db.schema('production').from('prod_mass_balance')
        .select('session_id,total_input_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg')
        .in('session_id', sessIds)
      mbRows = data || []
    }
    const mbMap = new Map(mbRows.map(m => [m.session_id, m]))
    const outOf = (s: any) => { const m = mbMap.get(s.id); return m ? (Number(m.total_output_b_kg) || 0) + (Number(m.total_output_c_kg) || 0) + (Number(m.total_output_d_kg) || 0) : 0 }
    const inOf = (s: any) => { const m = mbMap.get(s.id); return m ? Number(m.total_input_kg) || 0 : 0 }
    const rank = (s: string) => ({ approved: 3, submitted: 2, draft: 1 } as Record<string, number>)[s] ?? 0

    const rows = SECTION_ORDER.map(id => {
      const ss = sessRows.filter(s => s.section_id === id)
      const status = ss.reduce((acc, s) => rank(s.status) > rank(acc) ? s.status : acc, 'none')
      const kgIn = ss.reduce((t, s) => t + inOf(s), 0)
      const kgOut = ss.reduce((t, s) => t + outOf(s), 0)
      const bags = bagsData.filter(b => b.section_id === id).length
      const yieldPct = kgIn > 0 ? round1(kgOut / kgIn * 100) : null
      return { id, status, kgIn, kgOut, variance: kgIn - kgOut, bags, yieldPct }
    })

    setTodayRows(rows)
    setBreakdowns((bd as any[]) ?? [])

    // ── Granule KPI foundations ──────────────────────────────────────────────
    // Quality readings (moisture %, bulk density cc/100g) from the capture draft,
    // and scale verifications from the Checks audit trail (check_events) — the
    // pass/fail record and the scale-health deviation trend.
    // Best-effort: a schema/parse hiccup must never take the dashboard down.
    try {
      const windowStart = format(new Date(Date.now() - windowDays * 86_400_000), 'yyyy-MM-dd')
      const num = (v: any) => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? null : x }
      const avg = (a: number[]) => a.length ? round1(a.reduce((x, y) => x + y, 0) / a.length) : null
      const lbl = (d: string) => format(new Date(d + 'T12:00:00'), 'd MMM')

      // Quality readings come from the QC lab (qms.granule_*), linked by date —
      // the same source the operators' graph is drawn from. Averaged per day.
      const qpts = await fetchGranuleQuality({ fromDate: windowStart })
      const moistByDate = new Map<string, number[]>()
      const bdByDate = new Map<string, number[]>()
      qpts.forEach(p => {
        if (!p.date) return
        if (p.moisture != null) { const a = moistByDate.get(p.date) ?? []; a.push(p.moisture); moistByDate.set(p.date, a) }
        if (p.bulkDensity != null) { const a = bdByDate.get(p.date) ?? []; a.push(p.bulkDensity); bdByDate.set(p.date, a) }
      })
      setGranuleQuality(Array.from(new Set([...moistByDate.keys(), ...bdByDate.keys()])).sort().map(d => ({
        date: d, label: lbl(d), moisture: avg(moistByDate.get(d) ?? []), bulkDensity: avg(bdByDate.get(d) ?? []),
      })))

      // Scale verifications from the Checks audit (check_records → check_events).
      const { data: crs } = await db.schema('production').from('check_records')
        .select('id,date,shift').eq('section_id', 'granule').gte('date', windowStart)
      const crList = (crs as any[]) ?? []
      const crMap = new Map(crList.map(r => [r.id, r]))
      const scaleByDate = new Map<string, number[]>()
      const audit: { date: string; label: string; shift: string; std: number | null; actual: number | null; dev: number | null; pass: boolean; at: string }[] = []
      if (crList.length) {
        const { data: evs } = await db.schema('production').from('check_events')
          .select('record_id,value_text,value_num,status,recorded_at')
          .eq('check_key', 'scale_verification').in('record_id', crList.map(r => r.id))
        ;((evs as any[]) ?? []).forEach(e => {
          const cr = crMap.get(e.record_id); if (!cr) return
          const m = /std\s*([\d.]+)\s*\/\s*actual\s*([\d.]+)/i.exec(String(e.value_text ?? ''))
          const std = m ? parseFloat(m[1]) : null
          const actual = m ? parseFloat(m[2]) : (num(e.value_num))
          const dev = (std != null && actual != null) ? round1(actual - std) : null
          if (dev != null) { const a = scaleByDate.get(cr.date) ?? []; a.push(dev); scaleByDate.set(cr.date, a) }
          audit.push({ date: cr.date, label: lbl(cr.date), shift: cr.shift, std, actual, dev, pass: e.status !== 'fail', at: e.recorded_at })
        })
      }
      audit.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
      setGranuleScale(Array.from(scaleByDate.keys()).sort().map(d => {
        const a = scaleByDate.get(d)!; return { date: d, label: lbl(d), dev: avg(a) ?? 0, readings: a.length }
      }))
      setScaleAudit(audit)
    } catch { /* granule KPIs are best-effort */ }

    setLoading(false); setRefreshing(false)
  }, [today, windowDays])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(() => load(true), 120_000); return () => clearInterval(t) }, [load])

  // ── Machine KPI derived data ────────────────────────────────────────────────

  const vsdReadings = useMemo(() =>
    machineParams
      .filter(e => e.checkKey === 'infeed_vsd')
      .map(e => ({ date: e.date, label: format(new Date(e.date + 'T12:00:00'), 'EEE d'), hz: e.valueNum, status: e.status }))
      .sort((a, b) => a.date.localeCompare(b.date))
  , [machineParams])

  // Average VSD per day for trend chart
  const vsdByDay = useMemo(() => {
    const grouped: Record<string, { date: string; label: string; values: number[]; flagged: number }> = {}
    for (const r of vsdReadings) {
      if (!grouped[r.date]) grouped[r.date] = { date: r.date, label: r.label, values: [], flagged: 0 }
      grouped[r.date].values.push(r.hz)
      if (r.status !== 'ok') grouped[r.date].flagged++
    }
    return Object.values(grouped).map(g => ({
      date: g.date,
      label: g.label,
      avgHz: g.values.length ? round1(g.values.reduce((a, b) => a + b, 0) / g.values.length) : null,
      minHz: g.values.length ? Math.min(...g.values) : null,
      maxHz: g.values.length ? Math.max(...g.values) : null,
      readings: g.values.length,
      flagged: g.flagged,
    }))
  }, [vsdReadings])

  const screenSettings = useMemo(() =>
    machineParams
      .filter(e => e.checkKey === 'indent_screen_angle' || e.checkKey === 'indent_screen_speed')
      .map(e => ({ date: e.date, label: format(new Date(e.date + 'T12:00:00'), 'd MMM'), shift: e.shift, checkKey: e.checkKey, checkLabel: e.checkLabel, value: e.valueNum, unit: e.unit, status: e.status }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20)
  , [machineParams])

  // ── Quality integration: correlate PSD runs with machine settings ────────────

  const psdCorrelation = useMemo(() => {
    return psdRuns.slice(0, 40).map(run => {
      // Find sieving machine params on the same date
      const dayParams = machineParams.filter(e => e.date === run.date && e.sectionId === 'sieving')
      const vsdOnDay = dayParams.filter(e => e.checkKey === 'infeed_vsd').map(e => e.valueNum)
      const angleOnDay = dayParams.find(e => e.checkKey === 'indent_screen_angle')
      const speedOnDay = dayParams.find(e => e.checkKey === 'indent_screen_speed')
      // valueNum is the numeric reading on the MachineParam type

      // Key PSD fractions from sieve_results
      const sr = run.sieveResults || {}
      const gt18 = sr['>18 (%)'] ?? sr['gt18'] ?? null
      const gt12 = sr['>12 (%)'] ?? sr['gt12'] ?? null
      const gt10 = sr['>10 (%)'] ?? sr['gt10'] ?? null

      return {
        date: run.date,
        label: format(new Date(run.date + 'T12:00:00'), 'd MMM'),
        lot: run.lotNumber,
        variant: run.variant,
        product: run.product,
        grade: run.grade,
        passStatus: run.passStatus,
        bulkDensity: run.bulkDensity ? Number(run.bulkDensity) : null,
        avgVsd: vsdOnDay.length ? round1(vsdOnDay.reduce((a, b) => a + b, 0) / vsdOnDay.length) : null,
        screenAngle: angleOnDay ? angleOnDay.valueNum : null,
        screenSpeed: speedOnDay ? speedOnDay.valueNum : null,
        gt18: gt18 != null ? Number(gt18) : null,
        gt12: gt12 != null ? Number(gt12) : null,
        gt10: gt10 != null ? Number(gt10) : null,
      }
    })
  }, [psdRuns, machineParams])

  // PSD trend for key fractions over time
  const psdTrend = useMemo(() => {
    const byDate: Record<string, { date: string; label: string; gt18: number[]; gt12: number[]; gt10: number[]; pass: number; fail: number }> = {}
    for (const run of psdRuns) {
      if (!byDate[run.date]) byDate[run.date] = { date: run.date, label: format(new Date(run.date + 'T12:00:00'), 'd MMM'), gt18: [], gt12: [], gt10: [], pass: 0, fail: 0 }
      const sr = run.sieveResults || {}
      const v18 = sr['>18 (%)'] ?? sr['gt18']; if (v18 != null && !isNaN(Number(v18))) byDate[run.date].gt18.push(Number(v18))
      const v12 = sr['>12 (%)'] ?? sr['gt12']; if (v12 != null && !isNaN(Number(v12))) byDate[run.date].gt12.push(Number(v12))
      const v10 = sr['>10 (%)'] ?? sr['gt10']; if (v10 != null && !isNaN(Number(v10))) byDate[run.date].gt10.push(Number(v10))
      if (run.passStatus === 'Pass') byDate[run.date].pass++; else if (run.passStatus === 'Fail') byDate[run.date].fail++
    }
    return Object.values(byDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({
        date: d.date, label: d.label,
        avg18: d.gt18.length ? round1(d.gt18.reduce((a, b) => a + b, 0) / d.gt18.length) : null,
        avg12: d.gt12.length ? round1(d.gt12.reduce((a, b) => a + b, 0) / d.gt12.length) : null,
        avg10: d.gt10.length ? round1(d.gt10.reduce((a, b) => a + b, 0) / d.gt10.length) : null,
        passRate: (d.pass + d.fail) > 0 ? Math.round((d.pass / (d.pass + d.fail)) * 100) : null,
      }))
  }, [psdRuns])

  // ── Today summary KPIs ──────────────────────────────────────────────────────

  const yieldToday = todaySummary?.yieldPct
  const outputToday = todaySummary?.outputKg ?? 0
  const compRate = todaySummary?.complianceRate
  const activeSections = todaySummary?.activeSections ?? 0

  const kpis = [
    {
      label: 'Yield today',
      value: yieldToday != null ? `${yieldToday}%` : '—',
      icon: Percent,
      tone: (yieldToday != null && yieldToday < 70 ? 'warn' : 'ok') as 'ok' | 'warn',
      info: 'Total output kg ÷ total input kg × 100, across all approved and in-progress sessions today. Calculated from prod_mass_balance (output groups B+C+D divided by total input A).',
    },
    {
      label: 'Output today',
      value: outputToday ? `${outputToday.toLocaleString()} kg` : '—',
      icon: Scale,
      tone: 'info' as const,
      info: 'Sum of output bags (groups B+C+D) bagged today across all sections, from prod_mass_balance. Does not include sessions still in draft with no mass balance recorded.',
    },
    {
      label: 'Check compliance',
      value: compRate != null ? `${compRate}%` : '—',
      icon: CheckCircle2,
      tone: (compRate != null && compRate < 80 ? 'warn' : 'ok') as 'ok' | 'warn',
      info: `Check events marked OK ÷ total check events × 100, over the last ${windowDays} days across all sections. Counts all startup, running, and shutdown check entries. Flagged or failed checks reduce this score.`,
    },
    {
      label: 'Active sections',
      value: String(activeSections),
      icon: Activity,
      tone: 'info' as const,
      info: 'Number of production sections with a capture session currently in "Capturing" (draft) status today.',
    },
  ]

  const agg = useMemo(() => ({
    today: todaySummary,
    dailyYield,
    yieldBySection,
    openBreakdowns: breakdowns.map(b => ({ card: b.card_no, area: b.area, machine: b.machine, status: b.status })),
  }), [todaySummary, dailyYield, yieldBySection, breakdowns])

  // Scale-verification audit summary — the pass/fail record for granule.
  const scalePass = scaleAudit.filter(a => a.pass).length
  const scalePassRate = scaleAudit.length ? Math.round((scalePass / scaleAudit.length) * 100) : null
  const granuleHasData = granuleQuality.length > 0 || granuleScale.length > 0 || scaleAudit.length > 0

  return (
    <div className="space-y-5">

      {/* Header + refresh */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Production Dashboard · {format(new Date(), 'EEE d MMM')}</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-surface-dim rounded-lg p-1">
            {([7, 14, 30] as const).map(d => (
              <button key={d} onClick={() => setWindowDays(d)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${windowDays === d ? 'bg-brand text-white' : 'text-text-muted hover:text-text'}`}>
                {d}d
              </button>
            ))}
          </div>
          <button onClick={() => load(true)} className="inline-flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Hero KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map(k => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      {/* ── §1 Yield & output — the manager's headline ─────────────────────── */}
      <div className="card p-4">
        <SectionTitle icon={TrendingUp} title="Yield & output" subtitle={`Output ÷ input, throughput & mix · last ${windowDays} days`} />
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Chart
                title="Daily yield %"
                subtitle={`Output ÷ input per day · last ${windowDays} days`}
                info="Each day's total output kg (sum of B+C+D output groups) divided by total input kg, expressed as %. The 70% reference line marks the minimum acceptable yield. Days with no sessions show as empty."
              >
                <LineChart data={dailyYield} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                  <Tooltip formatter={(v: any) => v != null ? `${v}%` : '—'} />
                  <ReferenceLine y={70} stroke={C.warn} strokeDasharray="4 4" label={{ value: '70% min', fontSize: 9, fill: C.warn }} />
                  <Line type="monotone" dataKey="yieldPct" name="Yield %" stroke={C.brand} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                </LineChart>
              </Chart>

              <Chart
                title="Yield by section"
                subtitle={`Average yield % per section · last ${windowDays} days`}
                info="Total output kg ÷ total input kg per section over the selected window. Only sections with at least one mass balance recorded are shown."
              >
                <BarChart
                  data={yieldBySection.map(s => ({ ...s, name: sectionMeta(s.sectionId).name, code: sectionMeta(s.sectionId).code, color: sectionMeta(s.sectionId).colorHex, yieldPct: s.inputKg > 0 ? round1(s.outputKg / s.inputKg * 100) : 0 })).filter(s => s.inputKg > 0)}
                  margin={{ top: 8, right: 8, left: -14, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                  <XAxis dataKey="code" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                  <Tooltip formatter={(v: any) => `${v}%`} />
                  <ReferenceLine y={70} stroke={C.warn} strokeDasharray="4 4" />
                  <Bar dataKey="yieldPct" name="Yield %" radius={[3, 3, 0, 0]}>
                    {yieldBySection.map((s, i) => <Cell key={i} fill={sectionMeta(s.sectionId).colorHex} />)}
                  </Bar>
                </BarChart>
              </Chart>
            </div>

            {/* Output throughput */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Chart
                title="Daily output (kg)"
                subtitle={`Total bagged output per day · last ${windowDays} days`}
                info="Total kg of all output bags (groups B, C, D combined) per day across all sections. Reflects completed or in-progress mass balances."
              >
                <BarChart data={dailyYield} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="outputKg" name="kg out" fill={C.accent} radius={[3, 3, 0, 0]} />
                </BarChart>
              </Chart>

              <Chart
                title="Output vs input (kg)"
                subtitle="Mass flow per day — input vs output"
                info="Side-by-side of total input kg (raw material debagged) vs total output kg (product bagged) per day. The gap between the two bars represents moisture loss, dust extraction, and floor waste — all tracked in the mass balance."
              >
                <BarChart data={dailyYield} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="inputKg" name="Input kg" fill={C.gray} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="outputKg" name="Output kg" fill={C.accent} radius={[3, 3, 0, 0]} />
                </BarChart>
              </Chart>
            </div>
          </div>
      </div>

      {/* ── §2 Output mix & batches (folded in from the Analytics page) ─────── */}
      <div className="card p-4">
        <SectionTitle icon={Boxes} title="Output mix & batches" subtitle="Per-product share of output, and each batch linked to quality" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Output mix */}
          <div>
            <div className="flex items-center gap-1 mb-3">
              <h3 className="text-sm font-semibold text-text">Output mix</h3>
              <InfoTip text="Each product's share of total bagged output over the window, from v_output_stream (bagged kg per product ÷ total bagged output). This is the Fine Leaf ÷ total ratio, generalised to every stream." />
            </div>
            {outputMix.length === 0 ? (
              <div className="text-[12px] text-text-muted py-4">No output captured for this window.</div>
            ) : (
              <div className="space-y-1.5">
                {outputMix.slice(0, 10).map((m, i) => (
                  <div key={m.productType} className="flex items-center gap-2 text-[12px]">
                    <span className="w-32 truncate text-text">{m.productType}</span>
                    <div className="flex-1 h-3.5 bg-surface-dim rounded overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${m.sharePct ?? 0}%`, background: MIX[i % MIX.length] }} />
                    </div>
                    <span className="w-20 text-right font-mono text-text-muted">{Math.round(m.kg).toLocaleString()}</span>
                    <span className="w-11 text-right font-mono font-semibold text-text">{m.sharePct ?? '—'}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Interactive batch grid — batch → yield → quality */}
          <div>
            <div className="flex items-center gap-1 mb-3">
              <h3 className="text-sm font-semibold text-text">Batches</h3>
              <InfoTip text="From v_batch_360: each batch's production rollup joined to quality by the canonical batch key. Click a column header to sort. Yield = output ÷ input × 100." />
            </div>
            {batches.length === 0 ? (
              <div className="text-[12px] text-text-muted py-4">No batches in this window.</div>
            ) : (
              <div className="rounded-xl border border-surface-rule max-h-80 overflow-auto">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-surface-dim">
                    <tr className="border-b border-surface-rule text-left">
                      {([['displayLot', 'Batch'], ['variant', 'Variant'], ['totalOutputKg', 'Output'], ['yieldPct', 'Yield'], ['bulkDensity', 'Bulk dens.'], ['leafShade', 'Leaf shade'], ['hasQuality', 'QC']] as [string, string][]).map(([k, label]) => (
                        <th key={k} onClick={() => setBatchSort(s => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : -1 }))}
                          className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted cursor-pointer hover:text-text whitespace-nowrap select-none">
                          {label}{batchSort.key === k ? (batchSort.dir === 1 ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-rule">
                    {[...batches].sort((a, b) => {
                      const av = a[batchSort.key], bv = b[batchSort.key]
                      if (av == null && bv == null) return 0
                      if (av == null) return 1
                      if (bv == null) return -1
                      return (av > bv ? 1 : av < bv ? -1 : 0) * batchSort.dir
                    }).slice(0, 60).map((b, i) => (
                      <tr key={b.batchKey || i} className="hover:bg-surface-dim/40">
                        <td className="px-2.5 py-2 font-mono text-text whitespace-nowrap">{b.displayLot || b.batchKey}</td>
                        <td className="px-2.5 py-2 text-text-muted">{b.variant || '—'}</td>
                        <td className="px-2.5 py-2 font-mono">{b.totalOutputKg != null ? Math.round(b.totalOutputKg).toLocaleString() : '—'}</td>
                        <td className="px-2.5 py-2 font-mono font-semibold" style={{ color: (b.yieldPct ?? 0) >= 70 ? C.ok : C.warn }}>{b.yieldPct != null ? `${b.yieldPct}%` : '—'}</td>
                        <td className="px-2.5 py-2 font-mono">{b.bulkDensity ?? '—'}</td>
                        <td className="px-2.5 py-2 text-text-muted">{b.leafShade || '—'}</td>
                        <td className="px-2.5 py-2">{b.hasQuality ? (b.allPassed === false ? <span className="text-err font-semibold">Fail</span> : <span className="text-ok font-semibold">Pass</span>) : <span className="text-text-faint">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── §3 Machine KPIs & throughput ───────────────────────────────────── */}
      <div className="card p-4">
        <SectionTitle icon={Cpu} title="Machine KPIs & throughput" subtitle="Infeed speed (VSD), screen settings & check compliance" />
        <div className="space-y-6">

            {/* VSD trend */}
            {vsdByDay.length > 0 ? (
              <Chart
                title="Infeed VSD frequency — Sieving"
                subtitle="Average Hz per day from hourly running checks"
                info="Each hourly 'Infeed speed (VSD)' check reading from production.check_events (check_key = infeed_vsd) is averaged per day. Captured by floor operators during running phase of the sieving shift. Spec range is set by the supervisor in check_specs."
              >
                <ComposedChart data={vsdByDay} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} unit=" Hz" />
                  <Tooltip formatter={(v: any) => v != null ? `${v} Hz` : '—'} />
                  <Line type="monotone" dataKey="avgHz" name="Avg VSD (Hz)" stroke={C.azure} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="minHz" name="Min (Hz)" stroke={C.gray} strokeWidth={1} dot={false} strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="maxHz" name="Max (Hz)" stroke={C.gray} strokeWidth={1} dot={false} strokeDasharray="3 3" />
                </ComposedChart>
              </Chart>
            ) : (
              <div className="rounded-xl border border-surface-rule p-6 text-center text-[12px] text-text-muted">
                No VSD readings captured yet for the selected window. VSD readings are recorded hourly by floor operators during the sieving running phase.
              </div>
            )}

            {/* Screen angle/speed table + compliance side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Screen settings table */}
              <div>
                <div className="flex items-center gap-1 mb-3">
                  <h3 className="text-sm font-semibold text-text">Screen settings — Sieving</h3>
                  <InfoTip text="Indent screen angle (°) and speed (rpm) captured at startup each shift. Recorded once per session in the startup phase of machine checks. Changes here correlate with particle size distribution results — a shallower angle or lower speed reduces separation efficiency." />
                </div>
                {screenSettings.length === 0 ? (
                  <div className="text-[12px] text-text-muted py-4">No screen settings captured for this window.</div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-surface-rule">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-surface-dim border-b border-surface-rule">
                          {['Date', 'Shift', 'Check', 'Value', 'Status'].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-rule">
                        {screenSettings.map((r, i) => (
                          <tr key={i} className="hover:bg-surface-dim/40">
                            <td className="px-3 py-2 text-text-muted">{r.label}</td>
                            <td className="px-3 py-2 capitalize text-text-muted">{r.shift || '—'}</td>
                            <td className="px-3 py-2 text-text">{r.checkLabel}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-text">{r.value} {r.unit}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${r.status === 'ok' ? 'bg-ok/10 text-ok' : r.status === 'flagged' ? 'bg-warn/10 text-warn' : 'bg-err/10 text-err'}`}>
                                {r.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Check compliance by section */}
              <div>
                <div className="flex items-center gap-1 mb-3">
                  <h3 className="text-sm font-semibold text-text">Check compliance by section</h3>
                  <InfoTip text="For each section, the percentage of all machine check events (startup + running + shutdown) recorded as OK over the selected window. Compliance = OK count ÷ total checks × 100. Flagged checks indicate out-of-spec readings; failed checks trigger maintenance job cards." />
                </div>
                {checkCompliance.length === 0 ? (
                  <div className="text-[12px] text-text-muted py-4">No check data captured for this window.</div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-surface-rule">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-surface-dim border-b border-surface-rule">
                          {['Section', 'Checks', 'OK', 'Flagged', 'Fail', 'Rate'].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-rule">
                        {checkCompliance.map((r, i) => {
                          const m = sectionMeta(r.sectionId)
                          return (
                            <tr key={i} className="hover:bg-surface-dim/40">
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-5 h-5 rounded flex items-center justify-center text-[8px] font-bold text-white" style={{ background: m.colorHex }}>{m.code}</span>
                                  <span className="text-text">{m.name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2 font-mono text-text-muted">{r.total}</td>
                              <td className="px-3 py-2 font-mono text-ok">{r.ok}</td>
                              <td className="px-3 py-2 font-mono text-warn">{r.flagged}</td>
                              <td className="px-3 py-2 font-mono text-err">{r.fail}</td>
                              <td className="px-3 py-2"><CompBadge pct={r.ratePct} /></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* VSD readings detail */}
            {vsdByDay.length > 0 && (
              <div className="rounded-xl border border-surface-rule p-4 bg-surface-dim/30">
                <div className="flex items-center gap-1 mb-2">
                  <h3 className="text-[12px] font-semibold text-text">VSD reading summary</h3>
                  <InfoTip text="Summary statistics for the infeed VSD (Variable Speed Drive) frequency at the sieving section. The VSD controls how fast material feeds into the sieve. Higher Hz = faster feed rate. This affects throughput and particle separation — too fast reduces separation quality; too slow reduces throughput. Pair with PSD results in the Quality Integration tab." />
                </div>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                  {vsdByDay.slice(-7).map(d => (
                    <div key={d.date} className="text-center">
                      <div className="text-[10px] text-text-muted">{d.label}</div>
                      <div className="text-[16px] font-semibold text-azure" style={{ color: C.azure }}>{d.avgHz ?? '—'}</div>
                      <div className="text-[9px] text-text-faint">{d.avgHz != null ? 'Hz avg' : 'no data'}</div>
                      {d.readings > 1 && <div className="text-[9px] text-text-faint">{d.minHz}–{d.maxHz} Hz range</div>}
                      {d.flagged > 0 && <div className="text-[9px] text-warn">⚠ {d.flagged} flagged</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
      </div>

      {/* ── §3 Quality integration ─────────────────────────────────────────── */}
      <div className="card p-4">
        <SectionTitle icon={FlaskConical} title="Quality integration" subtitle="Particle size (PSD) ↔ machine settings, from QC" />
        <div className="space-y-6">

            {/* Methodology note */}
            <div className="rounded-xl border border-azure/20 bg-info/5 p-4 text-[12px] text-text-muted leading-relaxed" style={{ borderColor: `${C.azure}30`, background: `${C.azure}08` }}>
              <div className="font-semibold text-text mb-1 flex items-center gap-1">
                <FlaskConical size={14} style={{ color: C.azure }} />
                PSD ↔ Machine settings correlation
                <InfoTip text="Particle Size Distribution (PSD) results from qms.sd_runs are linked to machine settings from production.check_events by matching date and sieving section. VSD frequency and screen angle at startup are the primary machine variables that influence sieve fractions. A higher VSD Hz means faster throughput — which can reduce separation if the screen is not set correctly. Screen angle affects the trajectory of particles across the mesh." />
              </div>
              Sieve analysis results from QC (in-process runs) are paired with the sieving machine settings recorded that same day —
              infeed VSD frequency (Hz) and screen angle (°). If PSD results trend out of spec, trace back to the machine configuration
              that produced them. Spec ranges are per IPS-SIEV standards; screen parameters are set by the supervisor and validated
              against traceable calibration records.
            </div>

            {/* PSD trend */}
            {psdTrend.length > 0 ? (
              <Chart
                title="Particle size trend — sieving QC"
                subtitle="Mean sieve fractions per day from in-process QC runs"
                info="Mean % retained on each key sieve mesh per day, averaged across all in-process sieve runs for that day. Source: qms.sd_runs. The >18 mesh fraction is the primary sizing indicator for Coarse Leaf and Fine Leaf product grades. Deviations outside spec should prompt a check of VSD settings and screen configuration."
              >
                <LineChart data={psdTrend} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v: any) => v != null ? `${v}%` : '—'} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="avg18" name=">18 mesh %" stroke={C.accent} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="avg12" name=">12 mesh %" stroke={C.azure} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="avg10" name=">10 mesh %" stroke={C.warn} strokeWidth={1.5} dot={{ r: 2 }} connectNulls={false} strokeDasharray="4 2" />
                </LineChart>
              </Chart>
            ) : (
              <div className="rounded-xl border border-surface-rule p-8 text-center text-[12px] text-text-muted">
                No PSD sieve analysis runs found for the selected window. QC runs from the Sieving quality page will appear here automatically.
              </div>
            )}

            {/* Correlation table */}
            {psdCorrelation.filter(r => r.avgVsd != null || r.screenAngle != null).length > 0 ? (
              <div>
                <div className="flex items-center gap-1 mb-3">
                  <h3 className="text-sm font-semibold text-text">PSD + machine settings — by run</h3>
                  <InfoTip text="Each row is one QC sieve analysis run from qms.sd_runs. The Avg VSD (Hz) and Screen Angle columns show the sieving machine settings recorded on the same date via check_events. Use this to identify which machine configurations produced passing or failing PSD results. Traceable to IPS-SIEV standards for sieving parameter calibration." />
                </div>
                <div className="overflow-x-auto rounded-xl border border-surface-rule">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-surface-dim border-b border-surface-rule">
                        {['Date', 'Lot', 'Product', 'Variant', 'Avg VSD (Hz)', 'Screen Angle', '>18 %', '>12 %', 'BD', 'PSD Result'].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-rule">
                      {psdCorrelation.slice(0, 30).map((r, i) => (
                        <tr key={i} className={`hover:bg-surface-dim/40 ${r.passStatus === 'Fail' ? 'bg-err/5' : ''}`}>
                          <td className="px-3 py-2 text-text-muted whitespace-nowrap">{r.label}</td>
                          <td className="px-3 py-2 font-mono text-text">{r.lot || '—'}</td>
                          <td className="px-3 py-2 text-text whitespace-nowrap">{r.product || '—'}</td>
                          <td className="px-3 py-2 text-text-muted">{r.variant || '—'}</td>
                          <td className="px-3 py-2 font-mono font-semibold" style={{ color: r.avgVsd ? C.azure : undefined }}>
                            {r.avgVsd != null ? `${r.avgVsd} Hz` : <span className="text-text-faint text-[10px]">no check data</span>}
                          </td>
                          <td className="px-3 py-2 font-mono">{r.screenAngle != null ? `${r.screenAngle}°` : <span className="text-text-faint text-[10px]">—</span>}</td>
                          <td className="px-3 py-2 font-mono">{r.gt18 != null ? `${r.gt18}%` : '—'}</td>
                          <td className="px-3 py-2 font-mono">{r.gt12 != null ? `${r.gt12}%` : '—'}</td>
                          <td className="px-3 py-2 font-mono">{r.bulkDensity != null ? r.bulkDensity : '—'}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${r.passStatus === 'Pass' ? 'bg-ok/10 text-ok' : r.passStatus === 'Fail' ? 'bg-err/10 text-err' : 'bg-surface-dim text-text-muted'}`}>
                              {r.passStatus || '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-text-faint mt-2">
                  Machine settings linked by date — if a day has both QC sieve runs and check_events from sieving, they are paired here.
                  Days without check data show "no check data" — capture will improve this correlation over time.
                </p>
              </div>
            ) : psdRuns.length > 0 ? (
              <div className="rounded-xl border border-surface-rule p-6 text-center text-[12px] text-text-muted">
                PSD runs found but no machine check data for the same dates yet. As sieving checks (VSD, screen angle) are captured daily, they will automatically pair with QC sieve runs here.
              </div>
            ) : null}

          </div>
      </div>

      {/* Granule Line — quality & scale-health KPI foundations */}
      <div className="card p-4">
        <div className="flex items-center gap-1 mb-3">
          <FlaskConical size={15} style={{ color: sectionMeta('granule').colorHex }} />
          <h3 className="text-sm font-semibold text-text">Granule Line — quality &amp; scale health</h3>
          <InfoTip text="Foundations for granule quality and scale predictive-maintenance KPIs. Quality readings come from the capture screen; scale verifications come from the Checks audit trail. Both grow richer as shifts are captured, and feed the per-production pass/fail audit below." />
        </div>

        {/* What each metric means — so the dashboard explains, not just reports */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5 text-[11px] leading-relaxed text-text-muted">
          <div className="rounded-xl border p-3" style={{ borderColor: `${C.azure}30`, background: `${C.azure}08` }}>
            <div className="font-semibold text-text mb-0.5">Granule quality — why it matters</div>
            Granule uniformity drives consistent product density, flow and structural integrity, and depends on precise raw-material batching in the pellet mill. Moisture (%) and bulk density (cc/100g) are the two in-process indicators the QC lab measures per lot; linked here by lot number + date, trends flag drift before it becomes off-spec product.
          </div>
          <div className="rounded-xl border p-3" style={{ borderColor: `${C.warn}30`, background: `${C.warn}08` }}>
            <div className="font-semibold text-text mb-0.5">Scale verification — not calibration</div>
            Verification proves the scale reads accurately within tolerance (calibration adjusts it). Each shift: <strong>zero check</strong> (no tare) → <strong>test load</strong> (certified mass) → <strong>pass/fail</strong> on the deviation. Accurate weighing cuts product giveaway and overfill, and keeps us compliant with the Legal Metrology Act (NRCS / SANAS — e.g. Clover Scales, Scale Tronic, SWIS for on-site verification).
          </div>
        </div>

        {!granuleHasData ? (
          <div className="rounded-xl border border-surface-rule p-6 text-center text-[12px] text-text-muted">
            No granule quality or scale-verification data captured yet for the selected window. Quality readings come from the Granule capture screen; scale verifications from the Checks tab.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Chart
                title="Granule quality"
                subtitle={`Daily avg moisture % & bulk density · from QC · last ${windowDays} days`}
                info="Daily average of the moisture (%) and bulk-density (cc/100g) readings measured by the QC lab (qms.granule_samples), linked to production by lot number and date. Moisture uses the left axis, bulk density the right. Same data as the operators' QC graph — one source of truth, and the basis for future AI/uniformity research."
              >
                <ComposedChart data={granuleQuality} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="m" tick={{ fontSize: 11 }} unit="%" />
                  <YAxis yAxisId="b" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line yAxisId="m" type="monotone" dataKey="moisture" name="Moisture %" stroke={C.azure} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line yAxisId="b" type="monotone" dataKey="bulkDensity" name="Bulk density (cc/100g)" stroke={C.accent} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </ComposedChart>
              </Chart>

              <Chart
                title="Scale verification health"
                subtitle={`Daily avg deviation (actual − std) · last ${windowDays} days`}
                info="Actual test-load reading minus the certified standard weight, averaged per day. Zero is perfect. A deviation trending away from zero is the early predictive-maintenance signal to recalibrate or service the scale."
              >
                <LineChart data={granuleScale} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} unit=" kg" />
                  <Tooltip formatter={(v: any) => `${v} kg`} />
                  <ReferenceLine y={0} stroke={C.ok} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="dev" name="Deviation (kg)" stroke={C.warn} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </Chart>
            </div>

            {/* Scale verification audit — pass/fail per production */}
            {scaleAudit.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1">
                    <h4 className="text-[13px] font-semibold text-text">Scale verification audit</h4>
                    <InfoTip text="Every scale verification signed off on the granule Checks tab, most recent first. Pass = deviation within the allowable ± tolerance (supervisor-set in check_specs, default ±0.1 kg); a fail raises a maintenance job. This is the per-production audit trail for legal-metrology compliance." />
                  </div>
                  {scalePassRate != null && (
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${scalePassRate >= 95 ? 'bg-ok/10 text-ok' : scalePassRate >= 80 ? 'bg-warn/10 text-warn' : 'bg-err/10 text-err'}`}>
                      {scalePass}/{scaleAudit.length} passed · {scalePassRate}%
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto rounded-xl border border-surface-rule">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-surface-dim border-b border-surface-rule">
                        {['Date', 'Shift', 'Standard', 'Actual', 'Deviation', 'Result'].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-rule">
                      {scaleAudit.slice(0, 12).map((r, i) => (
                        <tr key={i} className={`hover:bg-surface-dim/40 ${!r.pass ? 'bg-err/5' : ''}`}>
                          <td className="px-3 py-2 text-text-muted">{r.label}</td>
                          <td className="px-3 py-2 capitalize text-text-muted">{r.shift || '—'}</td>
                          <td className="px-3 py-2 font-mono text-text">{r.std != null ? `${r.std} kg` : '—'}</td>
                          <td className="px-3 py-2 font-mono text-text">{r.actual != null ? `${r.actual} kg` : '—'}</td>
                          <td className="px-3 py-2 font-mono" style={{ color: r.dev != null && Math.abs(r.dev) > 0.1 ? C.warn : C.ok }}>
                            {r.dev != null ? `${r.dev > 0 ? '+' : ''}${r.dev} kg` : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${r.pass ? 'bg-ok/10 text-ok' : 'bg-err/10 text-err'}`}>
                              {r.pass ? 'Verified' : 'Fail'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-text-muted mr-1">Quick links</span>
        <QuickChip href="/production/capture" icon={ClipboardList} label="Capture" />
        <QuickChip href="/supervisor" icon={Users} label="Supervisor Hub" />
        <QuickChip href="/production/roster" icon={CalendarRange} label="Rosters" />
        <QuickChip href="/production/floor-plan" icon={MapIcon} label="Floor Plan" />
        <QuickChip href="/quality/sieving" icon={FlaskConical} label="Sieving QC" />
      </div>

      {/* ── Factory floor plan ─────────────────────────────────────────────── */}
      <div className="card p-4">
        <SectionTitle icon={MapIcon} title="Factory floor plan" subtitle="Live section layout & status" />
        <FactoryFloorPlan />
      </div>

      {/* Energy + breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EnergyWidget />
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wrench size={15} className="text-text-muted" />
            <h3 className="text-sm font-semibold text-text">Open breakdowns</h3>
          </div>
          {breakdowns.length === 0 ? (
            <div className="text-[12px] text-text-faint py-6 text-center">No open breakdowns. All clear.</div>
          ) : (
            <div className="space-y-2">
              {breakdowns.slice(0, 6).map((b: any) => (
                <Link key={b.card_no} href="/maintenance/job-cards" className="flex items-center justify-between rounded-lg border border-err/20 bg-err/5 px-3 py-2 hover:border-err/40 transition">
                  <div>
                    <div className="text-[13px] font-medium text-text">{b.area}{b.machine ? ` · ${b.machine}` : ''}</div>
                    <div className="text-[11px] text-text-muted">{b.card_no} · raised {format(new Date(b.raised_at), 'd MMM HH:mm')}</div>
                  </div>
                  <span className="text-[10px] font-medium px-2 py-1 rounded-lg bg-err/10 text-err capitalize">{b.status}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AI analyst */}
      <AiAnalystPanel
        agg={agg}
        insightsUrl="/api/production/dashboard-insights"
        askUrl="/api/production/ask"
        title="AI Production Analyst"
        subtitle="Plain-English insights over your production data"
        cacheKey="prod-insight"
      />

      {/* Operational trends */}
      <div className="card p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-text">Operational trends</h3>
          <p className="text-[11px] text-text-muted">Yield, count reliability &amp; inventory velocity · last 6 months</p>
        </div>
        <OperationalTrends dateFrom={format(new Date(new Date().setMonth(new Date().getMonth() - 6)), 'yyyy-MM-dd')} dateTo={today} />
      </div>

      {/* Section status — today (moved to the end, per manager preference) */}
      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-surface-rule flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">Section status · today</h3>
          <InfoTip text="Live status of each production section today. kg in/out from prod_mass_balance; yield % = output ÷ input × 100. Variance = input − output; a large positive variance (above tolerance) triggers a ⚠ warning. Status reflects the highest session status across all shifts today." />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-rule bg-surface-dim text-left">
                {['Section', 'Status', 'kg in', 'kg out', 'Yield %', 'Variance', 'Bags', ''].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-rule">
              {todayRows.map(r => {
                const m = sectionMeta(r.id)
                const st = SESSION_STATUS[r.status] ?? SESSION_STATUS.none
                const flag = r.kgIn > 0 && Math.abs(r.variance) > MASS_BALANCE_TOLERANCE_KG
                return (
                  <tr key={r.id} className="hover:bg-surface-dim/60 transition-colors cursor-pointer" onClick={() => { window.location.href = `/production/capture/${r.id}?date=${today}` }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
                          <span className="font-mono font-bold text-[8px] text-white">{m.code}</span>
                        </div>
                        <span className="font-medium text-[13px] text-text">{m.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={`text-[10px] font-medium px-2 py-1 rounded-lg ${st.cls}`}>{st.label}</span></td>
                    <td className="px-4 py-3 font-mono text-[12px] text-text-muted">{r.kgIn ? r.kgIn.toFixed(1) : '—'}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-text">{r.kgOut ? r.kgOut.toFixed(1) : '—'}</td>
                    <td className="px-4 py-3 font-mono text-[12px]" style={{ color: r.yieldPct != null && r.yieldPct < 70 ? C.warn : C.ok }}>
                      {r.yieldPct != null ? `${r.yieldPct}%` : '—'}
                    </td>
                    <td className={`px-4 py-3 font-mono text-[12px] ${flag ? 'text-warn font-bold' : 'text-text-muted'}`}>
                      {r.kgIn ? `${r.variance > 0 ? '+' : ''}${r.variance.toFixed(1)}` : '—'}{flag ? ' ⚠' : ''}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-text">{r.bags || '—'}</td>
                    <td className="px-4 py-3 text-right"><ChevronRight size={15} className="text-text-muted inline" /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-surface-rule text-[10px] text-text-muted">
          Auto-refreshes every 2 min · {format(new Date(), 'HH:mm')}
        </div>
      </div>

    </div>
  )
}
