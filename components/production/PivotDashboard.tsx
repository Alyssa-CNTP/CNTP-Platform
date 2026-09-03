'use client'

// components/production/PivotDashboard.tsx
//
// Production dashboard v2 — a filterable pivot/grid tool, not a stacked
// report. Approved concept: group by domain (Floor / Quality / Machine /
// Supply & demand / Solar), let the manager filter by date/shift/line/
// variant, and show aggregates + totals + a chart — not the entire shift
// report. Replaces the old widget-stack ProductionDashboard.tsx.
//
// Data: /api/production/dashboard-rows (row-level, unaggregated — this
// component does all pivoting/filtering client-side, same as the approved
// prototype), /api/production/yield-analytics (output mix + batches, already
// real), /api/production/dashboard-supply (PO-reference output — see the
// Supply & demand section below for why "demand" isn't wired in yet), and
// /api/maintenance/energy/history (Solar).

import { useEffect, useMemo, useState, type ReactElement } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  LayoutGrid, Filter, RotateCcw, Map as MapIcon, ArrowRight,
} from 'lucide-react'
import { sectionMeta, SECTION_ORDER } from '@/lib/production/capture-config'
import AiAnalystPanel from '@/components/maintenance/AiAnalystPanel'
import GradeBalanceSection from '@/components/production/GradeBalanceSection'

const C = { brand: '#1A3A0E', accent: '#5A8A2A', azure: '#2A7CB8', warn: '#B85C0A', err: '#B81C1C', ok: '#1A7A3C', info: '#2A7CB8', gray: '#96A88A' }
const VARIANTS = ['Conventional', 'Organic', 'RA-Conventional', 'RA-Organic', 'FT-CON', 'FT-ORG']

interface Row {
  sessionId: string; date: string; shift: string; sectionId: string
  sectionName: string; sectionCode: string; colorHex: string
  variant: string | null; productionOrders: string[]
  inputKg: number; outputKg: number; hours: number | null; bags: number; toleranceKg: number
  checkTotal: number | null; checkOk: number | null; checkFlagged: number | null; checkFailed: number | null
  vsdHz: number | null
  checkOperator: string | null; checkSupervisor: string | null
  lastCheckedAt: string | null; lastCheckActor: string | null
  moisture: number | null; bulkDensity: number | null; paLevel: number | null; passed: boolean | null
  qcName: string | null; qcCheckedAt: string | null
}

type Domain = 'floor' | 'quality' | 'machine' | 'supply' | 'solar' | 'balance'
type ColDim = 'date' | 'variant'

const num0 = (v: number | null) => (v == null ? null : v)
const sumOr = (rows: Row[], k: keyof Row): number | null => {
  const v = rows.map(r => r[k] as any).filter((x): x is number => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) : null
}
const avgOr = (rows: Row[], k: keyof Row): number | null => {
  const v = rows.map(r => r[k] as any).filter((x): x is number => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
const fmtDateLabel = (iso: string) => format(new Date(iso + 'T12:00:00'), 'd MMM')
// A quality/check timestamp in this app is one of three shapes: a bare date
// ("2026-08-05", nothing to show as a time), a real UTC instant with a "Z" or
// offset (check_events.recorded_at, quality_records.created_at — convert to
// SAST), or "date" + a floor-operator-entered SAST wall-clock time glued on
// with no timezone marker (sd_runs.time_of_run, granule_samples.sample_time —
// already SAST, just read the clock portion back out, don't re-convert it).
const fmtTime = (v: string | null): string | null => {
  if (!v || v.length <= 10) return null
  const hasOffset = v.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(v)
  if (hasOffset) {
    const d = new Date(v)
    if (isNaN(d.getTime())) return null
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(d)
  }
  return v.split('T')[1]?.slice(0, 5) ?? null
}

// ── Metric configs — the "how it was calculated" text shown in each info tip ──
interface MetricConf {
  key: string; label: string; info: string
  agg: (rows: Row[]) => number | null
  fmt: (v: number | null) => string | null
  flag?: (v: number | null) => boolean
}
const FLOOR_METRICS: MetricConf[] = [
  { key: 'outputKg', label: 'Output kg', info: 'Sum of bagged output (kg) across every filtered line-shift. Source: prod_mass_balance, streams B+C+D.', agg: r => sumOr(r, 'outputKg'), fmt: v => v == null ? null : Math.round(v).toLocaleString() },
  { key: 'inputKg', label: 'Input kg', info: 'Sum of debagged/raw material input (kg) across every filtered line-shift. Source: prod_mass_balance, stream A.', agg: r => sumOr(r, 'inputKg'), fmt: v => v == null ? null : Math.round(v).toLocaleString() },
  { key: 'yieldPct', label: 'Yield %', info: 'Total output ÷ total input × 100 for the filtered rows — not an average of daily yields. Flagged below 85%.', agg: r => { const i = sumOr(r, 'inputKg'), o = sumOr(r, 'outputKg'); return i ? (o ?? 0) / i * 100 : null }, fmt: v => v == null ? null : v.toFixed(1) + '%', flag: v => v != null && v < 85 },
  { key: 'kgPerHr', label: 'kg / hr', info: 'Total output kg ÷ total run hours (first→last bag per session) for the filtered rows.', agg: r => { const h = sumOr(r, 'hours'), o = sumOr(r, 'outputKg'); return h ? (o ?? 0) / h : null }, fmt: v => v == null ? null : Math.round(v).toLocaleString() },
]
const QUALITY_METRICS: MetricConf[] = [
  { key: 'moisture', label: 'Moisture %', info: 'Average moisture across filtered runs — tracked on Granule Line and Pasteuriser only.', agg: r => avgOr(r, 'moisture'), fmt: v => v == null ? null : v.toFixed(1) + '%' },
  { key: 'bulkDensity', label: 'Bulk density', info: 'Average bulk density (cc/100g) — tracked on Sieving Tower, Granule Line and Pasteuriser.', agg: r => avgOr(r, 'bulkDensity'), fmt: v => v == null ? null : Math.round(v).toString() },
  { key: 'paLevel', label: 'PA %', info: 'Average PA (particle analysis) level — tracked on Sieving Tower only.', agg: r => avgOr(r, 'paLevel'), fmt: v => v == null ? null : v.toFixed(1) + '%' },
  { key: 'passRate', label: 'Pass rate %', info: 'QC-passed runs ÷ all QC-tracked runs × 100. Flagged below 90%.', agg: r => { const qc = r.filter(x => x.passed != null); return qc.length ? qc.filter(x => x.passed).length / qc.length * 100 : null }, fmt: v => v == null ? null : v.toFixed(0) + '%', flag: v => v != null && v < 90 },
]
const MACHINE_METRICS: MetricConf[] = [
  { key: 'compliance', label: 'Compliance %', info: 'Checks OK ÷ total checks logged × 100. Flagged below 85%.', agg: r => { const ok = sumOr(r, 'checkOk'), tot = sumOr(r, 'checkTotal'); return tot ? (ok ?? 0) / tot * 100 : null }, fmt: v => v == null ? null : v.toFixed(0) + '%', flag: v => v != null && v < 85 },
  { key: 'flagged', label: 'Flagged checks', info: 'Count of out-of-spec (but not failed) machine check readings.', agg: r => sumOr(r, 'checkFlagged'), fmt: v => v == null ? null : Math.round(v).toString() },
  { key: 'failed', label: 'Failed checks', info: 'Count of failed machine check readings. Any failure is flagged.', agg: r => sumOr(r, 'checkFailed'), fmt: v => v == null ? null : Math.round(v).toString(), flag: v => v != null && v > 0 },
  { key: 'vsdHz', label: 'VSD avg Hz', info: 'Average infeed VSD frequency — tracked on the Sieving Tower only.', agg: r => avgOr(r, 'vsdHz'), fmt: v => v == null ? null : v.toFixed(1) },
]
const METRICS_BY_DOMAIN: Record<'floor' | 'quality' | 'machine', MetricConf[]> = { floor: FLOOR_METRICS, quality: QUALITY_METRICS, machine: MACHINE_METRICS }

// ── Small shared UI bits ──────────────────────────────────────────────────
function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex items-center justify-center w-4 h-4 rounded-full text-[11px] text-text-faint cursor-help shrink-0">
      ⓘ
      <span className="pointer-events-none absolute z-10 top-5 left-0 w-72 rounded-lg bg-text text-surface-card text-[11px] leading-relaxed p-2.5 opacity-0 group-hover:opacity-100 transition-opacity">{text}</span>
    </span>
  )
}
function Seg({ options, value, onChange }: { options: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="flex gap-0.5 bg-surface-dim rounded-lg p-0.5">
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)}
          className={`text-[11.5px] px-2.5 py-1 rounded-md ${value === o.key ? 'bg-surface-card text-brand font-semibold shadow-sm' : 'text-text-muted'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
function KpiTile({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-surface-rule bg-surface-card p-3.5">
      <div className="text-[11.5px] text-text-muted mb-1.5">{label}</div>
      <div className="text-[22px] font-semibold text-text tracking-tight">{value}{unit && <span className="text-[13px] font-normal text-text-muted"> {unit}</span>}</div>
      {sub && <div className="text-[11.5px] text-text-faint mt-0.5">{sub}</div>}
    </div>
  )
}

interface Flag { sev: 'crit' | 'warn'; date: string; shift: string; title: string; body: string }

export default function PivotDashboard() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [domain, setDomain] = useState<Domain>('floor')
  const [from, setFrom] = useState(format(new Date(Date.now() - 13 * 86_400_000), 'yyyy-MM-dd'))
  const [to, setTo] = useState(today)
  const [shift, setShift] = useState<'all' | 'morning' | 'afternoon'>('all')
  const [lines, setLines] = useState<string[]>([...SECTION_ORDER])
  const [variants, setVariants] = useState<string[]>(VARIANTS)
  const [colDim, setColDim] = useState<ColDim>('date')
  const [metric, setMetric] = useState('outputKg')

  const [rows, setRows] = useState<Row[]>([])
  const [outputMix, setOutputMix] = useState<{ productType: string; kg: number; sharePct: number | null }[]>([])
  const [batches, setBatches] = useState<any[]>([])
  const [supply, setSupply] = useState<{ orders: any[]; totals: any } | null>(null)
  const [energyDays, setEnergyDays] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1
    Promise.all([
      fetch(`/api/production/dashboard-rows?from=${from}&to=${to}`).then(r => r.json()),
      fetch(`/api/production/yield-analytics?days=${days}`).then(r => r.json()),
      fetch(`/api/production/dashboard-supply?from=${from}&to=${to}`).then(r => r.json()),
      fetch(`/api/maintenance/energy/history?from=${from}&to=${to}`).then(r => r.json()),
    ]).then(([rowsRes, yieldRes, supplyRes, energyRes]) => {
      if (cancelled) return
      if (!rowsRes.error) setRows(rowsRes.rows || [])
      if (!yieldRes.error) { setOutputMix(yieldRes.outputMix || []); setBatches(yieldRes.batches || []) }
      if (!supplyRes.error) setSupply(supplyRes)
      if (!energyRes.error) setEnergyDays(energyRes.days || [])
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to])

  // Metric reset when switching domain, so a stale metric key from another
  // domain's list never gets passed to buildPivot().
  useEffect(() => {
    if (domain === 'floor' || domain === 'quality' || domain === 'machine') {
      const list = METRICS_BY_DOMAIN[domain]
      if (!list.some(m => m.key === metric)) setMetric(list[0].key)
    }
  }, [domain]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredRows = useMemo(() => rows.filter(r =>
    (shift === 'all' || r.shift === shift) &&
    lines.includes(r.sectionId) &&
    (r.variant == null || variants.includes(r.variant))
  ), [rows, shift, lines, variants])

  function toggleIn(arr: string[], setArr: (a: string[]) => void, val: string) {
    if (arr.includes(val)) { if (arr.length > 1) setArr(arr.filter(x => x !== val)) }
    else setArr([...arr, val])
  }

  // ── Flags — shared by the Needs action panel and the AI aggregate blob ───
  const flags: Flag[] = useMemo(() => {
    const out: Flag[] = []
    if (domain === 'machine') {
      filteredRows.forEach(r => {
        const who = r.checkOperator ? ` Logged by ${r.checkOperator}${r.checkSupervisor ? `, supervisor ${r.checkSupervisor}` : ''}.` : ''
        const when = fmtTime(r.lastCheckedAt); const at = when ? ` Last check ${when} SAST${r.lastCheckActor ? ` (${r.lastCheckActor})` : ''}.` : ''
        if ((r.checkFailed ?? 0) > 0) out.push({ sev: 'crit', date: r.date, shift: r.shift, title: `${r.sectionName} — ${r.checkFailed} failed check(s)`, body: `A machine check failed on ${fmtDateLabel(r.date)} ${r.shift}.${who}${at}` })
        else if ((r.checkFlagged ?? 0) >= 2) out.push({ sev: 'warn', date: r.date, shift: r.shift, title: `${r.sectionName} — ${r.checkFlagged} flagged checks`, body: `Multiple out-of-spec readings on ${fmtDateLabel(r.date)} ${r.shift}.${who}${at}` })
      })
    } else if (domain === 'supply') {
      // No demand figure to compare against yet — see the Supply & demand card's note.
    } else {
      filteredRows.forEach(r => {
        const yieldPct = r.inputKg ? r.outputKg / r.inputKg * 100 : null
        if (yieldPct != null && yieldPct < 85) out.push({ sev: 'crit', date: r.date, shift: r.shift, title: `${r.sectionName} — yield ${yieldPct.toFixed(1)}%`, body: `Below the 85% floor — check the mass balance for ${fmtDateLabel(r.date)} ${r.shift}.` })
        if (r.passed === false) {
          const who = r.qcName ? ` Checked by ${r.qcName}` : ''
          const when = fmtTime(r.qcCheckedAt); const at = when ? ` at ${when} SAST` : ''
          out.push({ sev: 'warn', date: r.date, shift: r.shift, title: `${r.sectionName} — QC fail`, body: `${r.variant ?? 'Unknown variant'} sample failed spec on ${fmtDateLabel(r.date)} ${r.shift}.${who}${at} — hold the batch pending re-check.` })
        }
      })
    }
    return out.sort((a, b) => b.date.localeCompare(a.date))
  }, [domain, filteredRows])

  const metrics = domain === 'floor' || domain === 'quality' || domain === 'machine' ? METRICS_BY_DOMAIN[domain] : []
  const activeMetric = metrics.find(m => m.key === metric) ?? metrics[0]

  const pivot = useMemo(() => {
    if (!activeMetric) return null
    const cols = [...new Set(filteredRows.map(r => colDim === 'date' ? r.date : (r.variant ?? 'Unspecified')))].sort()
    const activeLines = SECTION_ORDER.filter(id => lines.includes(id))
    const body = activeLines.map(id => {
      const lineRows = filteredRows.filter(r => r.sectionId === id)
      const meta = sectionMeta(id)
      const cells = cols.map(c => activeMetric.agg(lineRows.filter(r => (colDim === 'date' ? r.date : (r.variant ?? 'Unspecified')) === c)))
      return { id, name: meta.name, code: meta.code, colorHex: meta.colorHex, cells, total: activeMetric.agg(lineRows) }
    }).filter(row => filteredRows.some(r => r.sectionId === row.id))
    const colTotals = cols.map(c => activeMetric.agg(filteredRows.filter(r => (colDim === 'date' ? r.date : (r.variant ?? 'Unspecified')) === c)))
    return { cols, body, colTotals, grand: activeMetric.agg(filteredRows) }
  }, [filteredRows, activeMetric, colDim, lines])

  const kpis = useMemo(() => {
    if (domain === 'floor') {
      const i = sumOr(filteredRows, 'inputKg'), o = sumOr(filteredRows, 'outputKg'), b = sumOr(filteredRows, 'bags')
      return [
        { label: 'Input', value: i != null ? Math.round(i).toLocaleString() : '—', unit: 'kg', sub: `${filteredRows.length} line-shifts` },
        { label: 'Output', value: o != null ? Math.round(o).toLocaleString() : '—', unit: 'kg' },
        { label: 'Yield', value: (i && o) ? (o / i * 100).toFixed(1) : '—', unit: '%', sub: 'output ÷ input' },
        { label: 'Bags', value: b != null ? Math.round(b).toLocaleString() : '—' },
      ]
    }
    if (domain === 'quality') {
      const qc = filteredRows.filter(r => r.passed != null)
      const pr = qc.length ? qc.filter(r => r.passed).length / qc.length * 100 : null
      return [
        { label: 'Avg moisture', value: avgOr(filteredRows, 'moisture') != null ? avgOr(filteredRows, 'moisture')!.toFixed(1) : '—', unit: '%', sub: 'granule + pasteuriser' },
        { label: 'Avg bulk density', value: avgOr(filteredRows, 'bulkDensity') != null ? Math.round(avgOr(filteredRows, 'bulkDensity')!).toString() : '—', unit: 'cc/100g' },
        { label: 'Avg PA', value: avgOr(filteredRows, 'paLevel') != null ? avgOr(filteredRows, 'paLevel')!.toFixed(1) : '—', unit: '%', sub: 'sieving' },
        { label: 'Pass rate', value: pr != null ? pr.toFixed(0) : '—', unit: '%', sub: `${qc.length} QC-tracked runs` },
      ]
    }
    if (domain === 'machine') {
      const ok = sumOr(filteredRows, 'checkOk'), tot = sumOr(filteredRows, 'checkTotal'), fail = sumOr(filteredRows, 'checkFailed'), vsd = avgOr(filteredRows, 'vsdHz')
      return [
        { label: 'Compliance', value: tot ? ((ok ?? 0) / tot * 100).toFixed(0) : '—', unit: '%' },
        { label: 'Flagged checks', value: sumOr(filteredRows, 'checkFlagged')?.toString() ?? '—' },
        { label: 'Failed checks', value: fail?.toString() ?? '—', sub: (fail ?? 0) > 0 ? 'needs a look' : '' },
        { label: 'Sieving VSD', value: vsd != null ? vsd.toFixed(1) : '—', unit: 'Hz avg' },
      ]
    }
    if (domain === 'supply' && supply) {
      return [
        { label: 'Output supplied', value: supply.totals.totalOutputKg.toLocaleString(), unit: 'kg', sub: `against ${supply.totals.poCount} PO reference(s)` },
        { label: 'Sessions without a PO ref', value: supply.totals.sessionsWithoutPo.toLocaleString(), sub: `${supply.totals.outputWithoutPoKg.toLocaleString()} kg` },
        { label: 'Demand', value: '—', sub: 'requires material planning (not yet built)' },
        { label: 'Fulfilment', value: '—', sub: 'needs demand to compute' },
      ]
    }
    if (domain === 'solar') {
      const solar = energyDays.reduce((t, d) => t + (Number(d.solar_kwh) || 0), 0)
      const grid = energyDays.reduce((t, d) => t + (Number(d.grid_import_kwh) || 0), 0)
      const tot = solar + grid
      return [
        { label: 'Solar generated', value: Math.round(solar).toLocaleString(), unit: 'kWh', sub: `over ${energyDays.length} day(s)` },
        { label: 'Grid drawn', value: Math.round(grid).toLocaleString(), unit: 'kWh' },
        { label: 'Solar share', value: tot ? (solar / tot * 100).toFixed(1) : '—', unit: '%' },
        { label: 'Days captured', value: energyDays.length.toString() },
      ]
    }
    return []
  }, [domain, filteredRows, supply, energyDays])

  const aiAgg = useMemo(() => ({
    domain, window: { from, to }, filters: { shift, lines, variants },
    kpis, flags: flags.slice(0, 10).map(f => ({ title: f.title, body: f.body, date: f.date, shift: f.shift })),
    pivot: pivot ? { metric: activeMetric?.label, byLine: pivot.body.map(b => ({ line: b.name, total: b.total })) } : null,
  }), [domain, from, to, shift, lines, variants, kpis, flags, pivot, activeMetric])

  return (
    <div className="space-y-4">
      {/* Domain tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text">Dashboard</h1>
          <p className="text-[12px] text-text-muted">Production &amp; quality — aggregates and totals; drill in via Needs action or the AI Analyst.</p>
        </div>
        <div className="flex gap-0.5 bg-surface-dim rounded-xl p-1">
          {([['floor', 'Floor'], ['quality', 'Quality'], ['machine', 'Machine'], ['supply', 'Supply & demand'], ['balance', 'Grade balance'], ['solar', 'Solar']] as [Domain, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setDomain(k)}
              className={`text-[13px] font-medium px-4 py-2 rounded-lg ${domain === k ? 'bg-surface-card text-brand shadow-sm' : 'text-text-muted'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="card p-3.5 flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] uppercase tracking-wide font-semibold text-text-faint">Date range</span>
          <div className="flex items-center gap-1.5">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-[12.5px] border border-surface-rule rounded-lg px-2 py-1 bg-surface-card text-text" />
            <span className="text-[11px] text-text-faint">to</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="text-[12.5px] border border-surface-rule rounded-lg px-2 py-1 bg-surface-card text-text" />
            <div className="flex gap-1">
              {[7, 14, 30].map(n => (
                <button key={n} onClick={() => { setTo(today); setFrom(format(new Date(Date.now() - (n - 1) * 86_400_000), 'yyyy-MM-dd')) }}
                  className="text-[11.5px] border border-surface-rule rounded-lg px-2 py-1 text-text-muted hover:bg-surface-dim">{n}d</button>
              ))}
            </div>
          </div>
        </div>
        {(domain === 'floor' || domain === 'quality' || domain === 'machine') && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-[10.5px] uppercase tracking-wide font-semibold text-text-faint">Shift</span>
              <div className="flex gap-1">
                {(['all', 'morning', 'afternoon'] as const).map(s => (
                  <button key={s} onClick={() => setShift(s)}
                    className={`text-[11.5px] border rounded-lg px-2.5 py-1 ${shift === s ? 'bg-accent/10 text-brand border-transparent font-semibold' : 'border-surface-rule text-text-muted'}`}>
                    {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 max-w-[380px]">
              <span className="text-[10.5px] uppercase tracking-wide font-semibold text-text-faint">Line</span>
              <div className="flex flex-wrap gap-1.5">
                {SECTION_ORDER.map(id => {
                  const meta = sectionMeta(id)
                  const on = lines.includes(id)
                  return (
                    <button key={id} onClick={() => toggleIn(lines, setLines, id)}
                      className={`text-[11.5px] border rounded-lg px-2.5 py-1 flex items-center gap-1.5 ${on ? 'border-transparent font-semibold' : 'border-surface-rule text-text-muted'}`}
                      style={on ? { background: `${meta.colorHex}18`, color: meta.colorHex } : undefined}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.colorHex }} />{meta.name}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 max-w-[380px]">
              <span className="text-[10.5px] uppercase tracking-wide font-semibold text-text-faint">Variant</span>
              <div className="flex flex-wrap gap-1.5">
                {VARIANTS.map(v => (
                  <button key={v} onClick={() => toggleIn(variants, setVariants, v)}
                    className={`text-[11.5px] border rounded-lg px-2.5 py-1 ${variants.includes(v) ? 'bg-warn/10 text-warn border-transparent font-semibold' : 'border-surface-rule text-text-muted'}`}>{v}</button>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="flex-1" />
        <button onClick={() => { setFrom(format(new Date(Date.now() - 13 * 86_400_000), 'yyyy-MM-dd')); setTo(today); setShift('all'); setLines([...SECTION_ORDER]); setVariants(VARIANTS) }}
          className="self-end text-[11.5px] text-text-faint underline flex items-center gap-1"><RotateCcw size={11} />Reset filters</button>
      </div>

      {/* Floor plan strip */}
      {domain === 'floor' && (
        <div className="card p-3.5">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-[13.5px] font-semibold text-text flex items-center gap-1.5"><MapIcon size={14} className="text-text-muted" />Floor plan</h3>
            <Link href="/production/floor-plan" className="text-[11.5px] text-text-faint hover:text-brand flex items-center gap-1">Material flow, left to right — click a line to filter · full plan <ArrowRight size={11} /></Link>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto">
            {SECTION_ORDER.map((id, i) => {
              const meta = sectionMeta(id)
              const lineRows = filteredRows.filter(r => r.sectionId === id)
              const on = lines.includes(id)
              const flagged = lineRows.some(r => r.inputKg && r.outputKg / r.inputKg * 100 < 85)
              const color = flagged ? C.err : (on ? meta.colorHex : C.gray)
              return (
                <span key={id} className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleIn(lines, setLines, id)} style={{ opacity: on ? 1 : 0.5 }}
                    className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg bg-surface-dim whitespace-nowrap">
                    <span className="w-2 h-2 rounded-full" style={{ background: color }} />{meta.name}
                  </button>
                  {i < SECTION_ORDER.length - 1 && <span className="text-text-faint text-[13px] px-0.5">→</span>}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* KPI row (balance tab brings its own) */}
      {domain !== 'balance' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpis.map((k, i) => <KpiTile key={i} {...k} />)}
        </div>
      )}

      {/* Grade balance — Acumatica stock on hand + ageing vs floor output */}
      {domain === 'balance' && <GradeBalanceSection outputMix={outputMix} />}

      {/* Pivot table + chart (Floor / Quality / Machine) */}
      {(domain === 'floor' || domain === 'quality' || domain === 'machine') && pivot && activeMetric && (
        <>
          <div className="card p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="flex items-center gap-1.5">
                <h3 className="text-[14.5px] font-semibold text-text">{activeMetric.label} by line</h3>
                <InfoTip text={`${activeMetric.info} Totals are computed the same way as the cells, not summed from what's displayed.`} />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Seg options={metrics.map(m => ({ key: m.key, label: m.label }))} value={metric} onChange={setMetric} />
                <Seg options={[{ key: 'date', label: 'By date' }, { key: 'variant', label: 'By variant' }]} value={colDim} onChange={k => setColDim(k as ColDim)} />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-surface-rule">
                    <th className="text-left px-2.5 py-2 text-[10.5px] uppercase tracking-wide text-text-faint font-semibold sticky left-0 bg-surface-card">Line</th>
                    {pivot.cols.map(c => <th key={c} className="text-right px-2.5 py-2 text-[10.5px] uppercase tracking-wide text-text-faint font-semibold whitespace-nowrap">{colDim === 'date' ? fmtDateLabel(c) : c}</th>)}
                    <th className="text-right px-2.5 py-2 text-[10.5px] uppercase tracking-wide text-text-faint font-semibold border-l border-surface-rule">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-rule">
                  {pivot.body.map(row => (
                    <tr key={row.id} className="hover:bg-surface-dim/40">
                      <td className="px-2.5 py-2 flex items-center gap-1.5 font-medium text-text sticky left-0 bg-surface-card"><span className="w-2 h-2 rounded-full" style={{ background: row.colorHex }} />{row.name}</td>
                      {row.cells.map((v, i) => {
                        const f = activeMetric.fmt(v); const flagged = activeMetric.flag?.(v)
                        return <td key={i} className={`text-right px-2.5 py-2 font-mono ${f == null ? 'text-text-faint' : flagged ? 'text-warn font-semibold' : 'text-text'}`}>{f ?? '—'}</td>
                      })}
                      <td className="text-right px-2.5 py-2 font-mono font-semibold border-l border-surface-rule">{activeMetric.fmt(row.total) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-surface-rule bg-surface-dim font-semibold">
                    <td className="px-2.5 py-2 text-text sticky left-0 bg-surface-dim">Total</td>
                    {pivot.colTotals.map((v, i) => <td key={i} className="text-right px-2.5 py-2 font-mono">{activeMetric.fmt(v) ?? '—'}</td>)}
                    <td className="text-right px-2.5 py-2 font-mono border-l border-surface-rule">{activeMetric.fmt(pivot.grand) ?? '—'}</td>
                  </tr>
                </tfoot>
              </table>
              {!pivot.body.length && <div className="text-center text-[12px] text-text-faint py-6">No rows match the current filters.</div>}
            </div>
          </div>

          <PivotChart pivot={pivot} colDim={colDim} activeMetric={activeMetric} />
        </>
      )}

      {/* Quality checks — who & when, straight from the quality↔production join */}
      {domain === 'quality' && <QualityDetailTable rows={filteredRows} />}

      {/* Supply & demand */}
      {domain === 'supply' && supply && (
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <h3 className="text-[14.5px] font-semibold text-text">Output supplied, by PO reference</h3>
            <InfoTip text="Sum of bagged output kg grouped by the PO reference operators typed against the session (prod_sessions.production_orders — a free-text label, not a synced Acumatica quantity)." />
          </div>
          <p className="text-[11.5px] text-warn bg-warn/5 border border-warn/20 rounded-lg px-3 py-2 mb-3">
            Demand isn't wired in yet — there's no material planning/forecasting system to pull it from, and no real Acumatica production-order sync exists (confirmed: `production_orders` is an operator-typed reference label, never validated against a real order or quantity). This shows actual supply delivered against each PO reference; it can't show fulfilment % until demand exists.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-surface-rule">{['PO reference', 'Product', 'Output supplied', 'Sessions', 'Lines', 'First', 'Last'].map(h => <th key={h} className="text-left px-2.5 py-2 text-[10.5px] uppercase tracking-wide text-text-faint font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-surface-rule">
                {supply.orders.slice(0, 30).map((o: any) => (
                  <tr key={o.poRef} className="hover:bg-surface-dim/40">
                    <td className="px-2.5 py-2 font-mono text-text">{o.poRef}</td>
                    <td className="px-2.5 py-2 text-text-muted">{o.product ?? '—'}</td>
                    <td className="px-2.5 py-2 font-mono">{o.outputKg.toLocaleString()} kg</td>
                    <td className="px-2.5 py-2 font-mono">{o.sessions}</td>
                    <td className="px-2.5 py-2">{o.sections.map((s: any) => <span key={s.id} className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: s.colorHex }} title={s.name} />)}</td>
                    <td className="px-2.5 py-2 text-text-muted">{fmtDateLabel(o.firstDate)}</td>
                    <td className="px-2.5 py-2 text-text-muted">{fmtDateLabel(o.lastDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!supply.orders.length && <div className="text-center text-[12px] text-text-faint py-6">No sessions in this range have a PO reference.</div>}
          </div>
        </div>
      )}

      {domain === 'supply' && supply && supply.orders.length > 0 && <SupplyChart orders={supply.orders} />}

      {/* Solar */}
      {domain === 'solar' && (
        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <h3 className="text-[14.5px] font-semibold text-text">Solar vs grid, by day</h3>
            <InfoTip text="Solar % = solar kWh ÷ (solar + grid import kWh) × 100, per day. Source: maintenance.energy_daily." />
          </div>
          <SolarChart days={energyDays} />
        </div>
      )}

      {/* Output mix + Batches — Floor only */}
      {domain === 'floor' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-[14.5px] font-semibold text-text">Output mix</h3>
              <InfoTip text="Each product's share of total bagged output for the current date range. Source: v_output_stream, via /api/production/yield-analytics." />
            </div>
            {outputMix.length === 0 ? <div className="text-[12px] text-text-muted py-4">No output captured for this window.</div> : (
              <div className="space-y-1">
                {outputMix.slice(0, 10).map(m => (
                  <div key={m.productType} className="flex items-center gap-3 py-1">
                    <span className="w-[130px] text-[12.5px] text-text truncate">{m.productType}</span>
                    <div className="flex-1 h-3.5 bg-surface-dim rounded-full overflow-hidden"><div className="h-full rounded-full bg-brand" style={{ width: `${m.sharePct ?? 0}%` }} /></div>
                    <span className="w-16 text-right text-[11px] text-text-faint font-mono">{Math.round(m.kg).toLocaleString()} kg</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-[14.5px] font-semibold text-text">Batches, this window</h3>
              <InfoTip text="One row per canonical batch (production.v_batch_360). Yield = output ÷ input × 100. Line shows every section the batch touched." />
              <span className="ml-auto text-[11.5px] text-text-faint">{batches.length} batches</span>
            </div>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-[11.5px]">
                <thead className="sticky top-0 bg-surface-card"><tr className="border-b border-surface-rule">{['Batch', 'Variant', 'Output', 'Yield', 'QC'].map(h => <th key={h} className="text-left px-2 py-1.5 text-[10px] uppercase tracking-wide text-text-faint font-semibold">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-surface-rule">
                  {batches.slice(0, 25).map((b: any, i: number) => (
                    <tr key={b.batchKey || i} className="hover:bg-surface-dim/40">
                      <td className="px-2 py-1.5 font-mono text-text">{b.displayLot || b.batchKey}</td>
                      <td className="px-2 py-1.5 text-text-muted">{b.variant || '—'}</td>
                      <td className="px-2 py-1.5 font-mono">{b.totalOutputKg != null ? Math.round(b.totalOutputKg).toLocaleString() : '—'} kg</td>
                      <td className="px-2 py-1.5 font-mono" style={{ color: (b.yieldPct ?? 0) < 85 ? C.warn : undefined }}>{b.yieldPct != null ? `${b.yieldPct}%` : '—'}</td>
                      <td className="px-2 py-1.5">{b.hasQuality ? (b.allPassed === false ? <span className="text-err font-semibold">Fail</span> : <span className="text-ok font-semibold">Pass</span>) : <span className="text-text-faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!batches.length && <div className="text-center text-[12px] text-text-faint py-6">No batches in this window.</div>}
            </div>
          </div>
        </div>
      )}

      {/* Needs action */}
      <div className="card p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <h3 className="text-[14.5px] font-semibold text-text">Needs action</h3>
          <InfoTip text={
            domain === 'machine' ? 'Flags any line-shift with a failed machine check, or 2+ flagged (out-of-spec but not failed) readings.'
              : domain === 'quality' ? 'Flags any QC sample that failed spec.'
              : domain === 'supply' ? 'Not available until demand is wired in.'
              : domain === 'solar' ? 'Not tracked for Solar yet.'
              : 'Flags any line-shift with yield below 85%, or a QC sample that failed spec.'
          } />
          <span className="ml-auto text-[11.5px] text-text-faint">{flags.length} of {filteredRows.length} line-shifts in range</span>
        </div>
        {domain === 'solar' || domain === 'supply' || domain === 'balance' ? (
          <div className="text-center text-[12px] text-text-faint py-6">No action items tracked for this domain yet.</div>
        ) : flags.length === 0 ? (
          <div className="text-center text-[12px] text-text-faint py-6">Nothing flagged in the current filters.</div>
        ) : (
          <div className="divide-y divide-surface-rule">
            {flags.slice(0, 8).map((f, i) => (
              <div key={i} className="flex gap-3 py-2.5">
                <div className="w-[3px] rounded shrink-0" style={{ background: f.sev === 'crit' ? C.err : C.warn }} />
                <div>
                  <p className="text-[13px] font-medium text-text">{f.title}</p>
                  <p className="text-[12.5px] text-text-muted">{f.body}</p>
                  <p className="text-[11px] text-text-faint font-mono mt-0.5">{fmtDateLabel(f.date)}{f.shift ? ` · ${f.shift}` : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Analyst — the real, existing panel, fed the current filtered view */}
      {!loading && domain !== 'balance' && (
        <AiAnalystPanel
          agg={aiAgg}
          insightsUrl="/api/production/dashboard-insights"
          askUrl="/api/production/ask"
          title="AI Production Analyst"
          subtitle="Plain-English insights over the current filtered view"
          cacheKey={`prod-pivot-${domain}`}
        />
      )}
    </div>
  )
}

// ── Chart — SVG, sized to fill its card, with value labels + endpoints ─────
function PivotChart({ pivot, colDim, activeMetric }: { pivot: { cols: string[]; body: any[] }; colDim: ColDim; activeMetric: MetricConf }) {
  const W = 1180, H = 360, padL = 54, padB = 30, padT = 16, padR = 16
  const innerW = W - padL - padR, innerH = H - padT - padB
  const vals = pivot.body.flatMap(r => r.cells).filter((v: number | null) => v != null) as number[]
  const maxV = vals.length ? Math.max(...vals) * 1.18 : 1

  if (!pivot.cols.length) return <div className="card p-8 text-center text-[12px] text-text-muted">No data to chart.</div>

  const gridLines = [0, 1, 2, 3, 4].map(g => {
    const y = padT + innerH - innerH * g / 4
    return <g key={g}><line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--surface-rule)" /><text x={padL - 10} y={y + 4} textAnchor="end" fontSize={12} fill="var(--text-faint)">{activeMetric.fmt(maxV * g / 4)}</text></g>
  })

  let marks: ReactElement[] = []
  if (colDim === 'date') {
    const stepX = innerW / Math.max(1, pivot.cols.length - 1)
    marks = pivot.body.map((row: any) => {
      const pts: string[] = []; let last: { x: number; y: number; v: number } | null = null
      const pointMarks: ReactElement[] = []
      row.cells.forEach((v: number | null, i: number) => {
        if (v == null) return
        const x = padL + stepX * i, y = padT + innerH - v / maxV * innerH
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`); last = { x, y, v }
        pointMarks.push(
          <circle key={`pt-${row.id}-${i}`} cx={x} cy={y} r={4} fill={row.colorHex} stroke="var(--surface-card)" strokeWidth={1}>
            <title>{`${row.name} — ${fmtDateLabel(pivot.cols[i])}: ${activeMetric.fmt(v)}`}</title>
          </circle>
        )
      })
      return (
        <g key={row.id}>
          {pts.length > 0 && <polyline points={pts.join(' ')} fill="none" stroke={row.colorHex} strokeWidth={2.5} />}
          {pointMarks}
          {last && <text x={(last as any).x + 7} y={(last as any).y - 6} fontSize={12} fontWeight={600} fill={row.colorHex}>{activeMetric.fmt((last as any).v)}</text>}
        </g>
      )
    })
    const everyN = Math.ceil(pivot.cols.length / 8)
    marks.push(...pivot.cols.map((c, i) => (i % everyN !== 0 && i !== pivot.cols.length - 1) ? null : (
      <text key={'x' + c} x={padL + stepX * i} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--text-faint)">{fmtDateLabel(c)}</text>
    )).filter(Boolean) as ReactElement[])
  } else {
    const groupW = innerW / pivot.cols.length, barGap = 4
    const barW = Math.max(6, (groupW - barGap * (pivot.body.length + 1)) / pivot.body.length)
    pivot.cols.forEach((c, ci) => {
      const gx = padL + groupW * ci
      marks.push(<text key={'lbl' + c} x={gx + groupW / 2} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--text-faint)">{c.slice(0, 14)}</text>)
      pivot.body.forEach((row: any, ri: number) => {
        const v = row.cells[ci]; if (v == null) return
        const bh = v / maxV * innerH, bx = gx + barGap + ri * (barW + barGap), by = padT + innerH - bh
        marks.push(<rect key={row.id + c} x={bx} y={by} width={barW} height={bh} fill={row.colorHex} rx={2}><title>{`${row.name} — ${c}: ${activeMetric.fmt(v)}`}</title></rect>)
        if (barW >= 16) marks.push(<text key={'v' + row.id + c} x={bx + barW / 2} y={by - 5} textAnchor="middle" fontSize={10.5} fill="var(--text-muted)">{activeMetric.fmt(v)}</text>)
      })
    })
  }

  return (
    <div className="card p-4">
      <h3 className="text-[14.5px] font-semibold text-text mb-3">{activeMetric.label} {colDim === 'date' ? 'over time' : 'by variant'}</h3>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>{gridLines}{marks}</svg>
      <div className="flex flex-wrap gap-3.5 mt-3.5">
        {pivot.body.map((row: any) => <span key={row.id} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-muted"><span className="w-2.5 h-2.5 rounded-full" style={{ background: row.colorHex }} />{row.name}</span>)}
      </div>
    </div>
  )
}

// ── Supply chart — daily output trend for the top PO references by volume ──
function SupplyChart({ orders }: { orders: any[] }) {
  const top = [...orders].sort((a, b) => b.outputKg - a.outputKg).slice(0, 8)
  const allDates = [...new Set(top.flatMap(o => Object.keys(o.byDate || {})))].sort()
  if (!allDates.length) return null
  const W = 1180, H = 320, padL = 54, padB = 30, padT = 16, padR = 16
  const innerW = W - padL - padR, innerH = H - padT - padB
  const maxV = Math.max(...top.flatMap(o => allDates.map(d => o.byDate[d] || 0))) * 1.18 || 1
  const stepX = innerW / Math.max(1, allDates.length - 1)
  const everyN = Math.ceil(allDates.length / 8)
  const palette = [C.brand, C.accent, C.azure, C.warn, C.err, C.ok, C.info, C.gray]

  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <h3 className="text-[14.5px] font-semibold text-text">Output supplied over time — top PO references</h3>
        <InfoTip text="Daily bagged output (kg) for the 8 largest PO references by total output in this window. Source: prod_bagging, via /api/production/dashboard-supply." />
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
        {[0, 1, 2, 3, 4].map(g => {
          const y = padT + innerH - innerH * g / 4
          return <g key={g}><line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--surface-rule)" /><text x={padL - 10} y={y + 4} textAnchor="end" fontSize={12} fill="var(--text-faint)">{Math.round(maxV * g / 4).toLocaleString()}</text></g>
        })}
        {top.map((o, oi) => {
          const color = palette[oi % palette.length]
          const pts: string[] = []
          const pointMarks: ReactElement[] = []
          allDates.forEach((d, i) => {
            const v = o.byDate[d]
            if (v == null) return
            const x = padL + stepX * i, y = padT + innerH - v / maxV * innerH
            pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
            pointMarks.push(
              <circle key={`${o.poRef}-${i}`} cx={x} cy={y} r={3.5} fill={color}>
                <title>{`${o.poRef} — ${fmtDateLabel(d)}: ${Math.round(v).toLocaleString()} kg`}</title>
              </circle>
            )
          })
          return <g key={o.poRef}>{pts.length > 0 && <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2.5} />}{pointMarks}</g>
        })}
        {allDates.map((d, i) => (i % everyN !== 0 && i !== allDates.length - 1) ? null : (
          <text key={'x' + d} x={padL + stepX * i} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--text-faint)">{fmtDateLabel(d)}</text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-3.5 mt-3.5">
        {top.map((o, oi) => (
          <span key={o.poRef} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-muted">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: palette[oi % palette.length] }} />{o.poRef}{o.product ? ` — ${o.product}` : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Quality detail — who ran each QC-tracked line-shift, and when ──────────
function QualityDetailTable({ rows }: { rows: Row[] }) {
  const qcRows = [...rows]
    .filter(r => r.passed != null || r.moisture != null || r.bulkDensity != null || r.paLevel != null)
    .sort((a, b) => b.date.localeCompare(a.date) || a.sectionName.localeCompare(b.sectionName))

  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <h3 className="text-[14.5px] font-semibold text-text">Quality checks — who &amp; when</h3>
        <InfoTip text="Every QC-tracked line-shift in the current filters, with the reading, pass/fail result, and who recorded the check. Out-of-spec rows are highlighted." />
        <span className="ml-auto text-[11.5px] text-text-faint">{qcRows.length} QC-tracked line-shift(s)</span>
      </div>
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-surface-card">
            <tr className="border-b border-surface-rule">
              {['Date', 'Shift', 'Line', 'Variant', 'Moisture', 'Bulk density', 'PA %', 'Result', 'Checked by', 'Checked at'].map(h => (
                <th key={h} className="text-left px-2.5 py-2 text-[10.5px] uppercase tracking-wide text-text-faint font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-rule">
            {qcRows.map(r => (
              <tr key={r.sessionId} className={`hover:bg-surface-dim/40 ${r.passed === false ? 'bg-err/5' : ''}`}>
                <td className="px-2.5 py-2 text-text-muted whitespace-nowrap">{fmtDateLabel(r.date)}</td>
                <td className="px-2.5 py-2 text-text-muted">{r.shift}</td>
                <td className="px-2.5 py-2 font-medium text-text whitespace-nowrap"><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: r.colorHex }} />{r.sectionName}</td>
                <td className="px-2.5 py-2 text-text-muted">{r.variant ?? '—'}</td>
                <td className="px-2.5 py-2 font-mono">{r.moisture != null ? `${r.moisture.toFixed(1)}%` : '—'}</td>
                <td className="px-2.5 py-2 font-mono">{r.bulkDensity != null ? Math.round(r.bulkDensity) : '—'}</td>
                <td className="px-2.5 py-2 font-mono">{r.paLevel != null ? `${r.paLevel.toFixed(1)}%` : '—'}</td>
                <td className="px-2.5 py-2">{r.passed == null ? <span className="text-text-faint">—</span> : r.passed ? <span className="text-ok font-semibold">Pass</span> : <span className="text-err font-semibold">Fail</span>}</td>
                <td className="px-2.5 py-2 text-text-muted whitespace-nowrap">{r.qcName ?? '—'}</td>
                <td className="px-2.5 py-2 text-text-muted font-mono whitespace-nowrap">{fmtTime(r.qcCheckedAt) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!qcRows.length && <div className="text-center text-[12px] text-text-faint py-6">No QC-tracked line-shifts in range.</div>}
      </div>
    </div>
  )
}

function SolarChart({ days }: { days: any[] }) {
  if (!days.length) return <div className="text-center text-[12px] text-text-muted py-8">No days in range.</div>
  const W = 1180, H = 360, padL = 54, padB = 30, padT = 16, padR = 16
  const innerW = W - padL - padR, innerH = H - padT - padB
  const maxV = Math.max(...days.map(d => (Number(d.solar_kwh) || 0) + (Number(d.grid_import_kwh) || 0))) * 1.15 || 1
  const everyN = Math.ceil(days.length / 8)
  const groupW = innerW / days.length, barW = Math.max(10, groupW * 0.55)
  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
        {[0, 1, 2, 3, 4].map(g => { const y = padT + innerH - innerH * g / 4; return <g key={g}><line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--surface-rule)" /><text x={padL - 10} y={y + 4} textAnchor="end" fontSize={12} fill="var(--text-faint)">{Math.round(maxV * g / 4).toLocaleString()}</text></g> })}
        {days.map((d, i) => {
          const solar = Number(d.solar_kwh) || 0, grid = Number(d.grid_import_kwh) || 0
          const gx = padL + groupW * i + (groupW - barW) / 2
          const hSolar = solar / maxV * innerH, hGrid = grid / maxV * innerH, ySolar = padT + innerH - hSolar
          return (
            <g key={d.day}>
              <rect x={gx} y={ySolar} width={barW} height={hSolar} fill={C.warn} rx={2}><title>{`${fmtDateLabel(d.day)} — Solar: ${Math.round(solar).toLocaleString()} kWh`}</title></rect>
              <rect x={gx} y={ySolar - hGrid} width={barW} height={hGrid} fill={C.accent} rx={2}><title>{`${fmtDateLabel(d.day)} — Grid: ${Math.round(grid).toLocaleString()} kWh`}</title></rect>
              <text x={gx + barW / 2} y={ySolar - hGrid - 6} textAnchor="middle" fontSize={10.5} fill="var(--text-muted)">{Math.round(solar + grid).toLocaleString()}</text>
              {(i % everyN === 0 || i === days.length - 1) && <text x={gx + barW / 2} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--text-faint)">{fmtDateLabel(d.day)}</text>}
            </g>
          )
        })}
      </svg>
      <div className="flex gap-4 mt-3.5">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-muted"><span className="w-2.5 h-2.5 rounded-full" style={{ background: C.warn }} />Solar</span>
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-muted"><span className="w-2.5 h-2.5 rounded-full" style={{ background: C.accent }} />Grid</span>
      </div>
    </div>
  )
}
