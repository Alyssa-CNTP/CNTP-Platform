'use client'

// components/production/YieldAnalytics.tsx
// Interactive Yield & Batch Analytics report. Driven by the batch-spine reporting
// views via /api/production/yield-analytics. Deeper than the live Dashboard's
// Yields tab: output mix (per-product share), yield trends by section/variant,
// machine-parameter vs yield correlation, and a batch table linking production
// output to quality (bulk density / leaf shade / PA / residue). Reuses the app's
// chart/KPI idiom and brand palette.

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  BarChart, Bar, ComposedChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, Legend,
} from 'recharts'
import {
  RefreshCw, Percent, Scale, Boxes, FlaskConical, Cpu, Info,
  TrendingUp, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { SECTION_ORDER, sectionMeta, VARIANT_OPTIONS } from '@/lib/production/capture-config'

const C = { brand: '#1A3A0E', accent: '#5A8A2A', azure: '#2A7CB8', warn: '#B85C0A', err: '#B81C1C', ok: '#1A7A3C', info: '#2A7CB8', gray: '#96A88A' }
// Categorical palette for output-mix streams — brand-anchored, distinguishable.
const MIX = ['#1A3A0E', '#5A8A2A', '#2A7CB8', '#B85C0A', '#7A5AA8', '#B81C1C', '#96A88A', '#3C8A6A']
const YIELD_TARGET = 70

// ── Info tooltip (click to reveal methodology) ────────────────────────────────
function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full text-text-muted hover:text-text hover:bg-surface-dim border border-surface-rule transition cursor-help"
        aria-label="How is this calculated?"
      ><Info size={9} /></button>
      {open && (
        <div onClick={(e) => e.stopPropagation()}
          className="absolute z-50 bottom-6 left-1/2 -translate-x-1/2 w-64 p-3 rounded-xl border border-surface-rule bg-surface-card shadow-xl text-[11px] text-text-muted leading-relaxed">
          {text}
          <button onClick={() => setOpen(false)} className="block mt-2 ml-auto text-[10px] text-text-faint hover:text-text">Close ×</button>
        </div>
      )}
    </span>
  )
}

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
      <div className="text-[22px] leading-none font-semibold mt-2" style={{ color: accent }}>{loading ? '—' : value}</div>
      <div className="flex items-center mt-1">
        <span className="text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
        {info && <InfoTip text={info} />}
      </div>
    </div>
  )
}

function Card({ title, subtitle, info, children }: { title: string; subtitle?: string; info?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-surface-rule bg-surface-card p-4">
      <div className="mb-3 flex items-start gap-1">
        <div>
          <div className="flex items-center gap-0.5">
            <h3 className="text-sm font-semibold text-text">{title}</h3>
            {info && <InfoTip text={info} />}
          </div>
          {subtitle && <p className="text-[11px] text-text-muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

// ── Types matching the API response ───────────────────────────────────────────
interface Kpis { totalInputKg: number; totalOutputKg: number; avgYieldPct: number | null; batchCount: number; sessionCount: number; withinTolPct: number | null }
interface Daily { date: string; label: string; inputKg: number; outputKg: number; sessions: number; yieldPct: number | null }
interface Grouped { key: string; inputKg: number; outputKg: number; sessions: number; yieldPct: number | null }
interface Mix { productType: string; kg: number; bags: number; sharePct: number | null }
interface MachinePoint { date: string; sectionId: string; batchKey: string; yieldPct: number | null; outputKg: number | null; indentSpeedRpm: number | null; indentAngleDeg: number | null; vsdHzAvg: number | null; vsdHzMin: number | null; vsdHzMax: number | null; sievingConfig: string | null }
interface Batch { batchKey: string; displayLot: string; variant: string | null; sections: string[]; sessionCount: number; totalInputKg: number; totalOutputKg: number; yieldPct: number | null; firstDate: string; lastDate: string; bulkDensity: number | null; leafShade: string | null; paLevel: number | null; residueGrade: string | null; allPassed: boolean | null; sdRunCount: number; hasQuality: boolean }
interface Resp { window: { days: number; startDate: string }; kpis: Kpis; dailyYield: Daily[]; yieldBySection: Grouped[]; yieldByVariant: Grouped[]; outputMix: Mix[]; machineVsYield: MachinePoint[]; batches: Batch[]; completeness: { batches: number; withQuality: number; withoutQuality: number } }

const secName = (id: string) => sectionMeta(id).name
const fmtKg = (n: number) => `${n.toLocaleString()} kg`

export default function YieldAnalytics() {
  const [days, setDays] = useState(30)
  const [section, setSection] = useState<string>('')
  const [variant, setVariant] = useState<string>('')
  const [batch, setBatch] = useState<string>('')
  const [xParam, setXParam] = useState<'vsdHzAvg' | 'indentSpeedRpm' | 'indentAngleDeg'>('vsdHzAvg')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<Resp | null>(null)

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ days: String(days) })
      if (section) qs.set('section', section)
      if (variant) qs.set('variant', variant)
      if (batch) qs.set('batch', batch)
      const res = await fetch(`/api/production/yield-analytics?${qs.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load analytics')
      setData(json)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load')
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [days, section, variant, batch])

  useEffect(() => { load() }, [load])

  const X_META: Record<typeof xParam, { label: string; unit: string }> = {
    vsdHzAvg: { label: 'Infeed VSD (avg)', unit: 'Hz' },
    indentSpeedRpm: { label: 'Indent screen speed', unit: 'rpm' },
    indentAngleDeg: { label: 'Indent screen angle', unit: '°' },
  }
  const scatterData = useMemo(() =>
    (data?.machineVsYield ?? [])
      .filter(p => p.yieldPct != null && (p as any)[xParam] != null)
      .map(p => ({ x: (p as any)[xParam] as number, y: p.yieldPct as number, batchKey: p.batchKey, date: p.date, config: p.sievingConfig })),
    [data, xParam])

  return (
    <div className="space-y-5">
      {/* ── Filters ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-surface-rule bg-surface-card overflow-hidden">
          {[14, 30, 90, 180].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-[12px] font-medium transition ${days === d ? 'bg-brand text-white' : 'text-text-muted hover:text-text'}`}>
              {d}d
            </button>
          ))}
        </div>
        <select value={section} onChange={e => setSection(e.target.value)}
          className="rounded-lg border border-surface-rule bg-surface-card px-3 py-1.5 text-[12px] text-text">
          <option value="">All sections</option>
          {SECTION_ORDER.map(s => <option key={s} value={s}>{secName(s)}</option>)}
        </select>
        <select value={variant} onChange={e => setVariant(e.target.value)}
          className="rounded-lg border border-surface-rule bg-surface-card px-3 py-1.5 text-[12px] text-text">
          <option value="">All variants</option>
          {VARIANT_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
        {batch && (
          <button onClick={() => setBatch('')}
            className="inline-flex items-center gap-1 rounded-lg border border-brand/40 bg-brand/5 px-2.5 py-1.5 text-[12px] text-brand">
            Batch: {batch} <span className="font-bold">×</span>
          </button>
        )}
        <button onClick={() => load(true)} disabled={refreshing}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-surface-rule bg-surface-card px-3 py-1.5 text-[12px] text-text-muted hover:text-text transition">
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-err/30 bg-err/5 p-4 text-[13px] text-err flex items-center gap-2">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {/* ── KPI row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Avg yield" tone={(data?.kpis.avgYieldPct ?? 0) >= YIELD_TARGET ? 'ok' : 'warn'} loading={loading}
          value={data?.kpis.avgYieldPct != null ? `${data.kpis.avgYieldPct}%` : '—'} icon={Percent}
          info={`Total output ÷ total input over the window, ×100. Target ${YIELD_TARGET}%.`} />
        <Kpi label="Total output" tone="info" loading={loading} value={data ? fmtKg(data.kpis.totalOutputKg) : '—'} icon={Boxes} />
        <Kpi label="Total input" tone="info" loading={loading} value={data ? fmtKg(data.kpis.totalInputKg) : '—'} icon={Scale} />
        <Kpi label="Batches" tone="info" loading={loading} value={data ? String(data.kpis.batchCount) : '—'} icon={FlaskConical} />
        <Kpi label="Sessions" tone="info" loading={loading} value={data ? String(data.kpis.sessionCount) : '—'} icon={TrendingUp} />
        <Kpi label="Within tolerance" tone={(data?.kpis.withinTolPct ?? 0) >= 90 ? 'ok' : 'warn'} loading={loading}
          value={data?.kpis.withinTolPct != null ? `${data.kpis.withinTolPct}%` : '—'} icon={CheckCircle2}
          info="Share of sessions whose mass-balance |A−B−C−D| is within the ±tolerance (default 15 kg)." />
      </div>

      {/* ── Output mix + Daily yield ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Output mix" subtitle="Each product's share of total bagged output"
          info="From v_output_stream: bagged kg per product type ÷ total bagged output over the window. This is the Fine Leaf / total ratio, generalized.">
          {data && data.outputMix.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.outputMix} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eee" />
                <XAxis type="number" tick={{ fontSize: 11 }} unit="kg" />
                <YAxis type="category" dataKey="productType" width={130} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any, n: any, p: any) => [`${Number(v).toLocaleString()} kg · ${p.payload.sharePct ?? '—'}% · ${p.payload.bags} bags`, p.payload.productType]} />
                <Bar dataKey="kg" radius={[0, 4, 4, 0]}>
                  {data.outputMix.map((_, i) => <Cell key={i} fill={MIX[i % MIX.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty loading={loading} />}
        </Card>

        <Card title="Daily yield" subtitle="Output vs input with yield %"
          info={`Bars: daily output & input (kg). Line: yield % against the ${YIELD_TARGET}% target reference.`}>
          {data && data.dailyYield.some(d => d.sessions > 0) ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={data.dailyYield} margin={{ left: 4, right: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis yAxisId="kg" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="kg" dataKey="inputKg" name="Input" fill={C.gray} radius={[3, 3, 0, 0]} />
                <Bar yAxisId="kg" dataKey="outputKg" name="Output" fill={C.accent} radius={[3, 3, 0, 0]} />
                <Line yAxisId="pct" dataKey="yieldPct" name="Yield %" stroke={C.brand} strokeWidth={2} dot={false} connectNulls />
                <ReferenceLine yAxisId="pct" y={YIELD_TARGET} stroke={C.warn} strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty loading={loading} />}
        </Card>
      </div>

      {/* ── Yield by section + variant ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Yield by section" subtitle="Output-weighted yield per section">
          {data && data.yieldBySection.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.yieldBySection.map(g => ({ ...g, name: secName(g.key) }))} margin={{ left: 4, right: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                <Tooltip formatter={(v: any, _n, p: any) => [`${v}% (${p.payload.outputKg.toLocaleString()} kg)`, 'Yield']} />
                <ReferenceLine y={YIELD_TARGET} stroke={C.warn} strokeDasharray="4 4" />
                <Bar dataKey="yieldPct" radius={[4, 4, 0, 0]}>
                  {data.yieldBySection.map((g, i) => <Cell key={i} fill={(g.yieldPct ?? 0) >= YIELD_TARGET ? C.ok : C.warn} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty loading={loading} />}
        </Card>

        <Card title="Yield by variant" subtitle="Output-weighted yield per variant">
          {data && data.yieldByVariant.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.yieldByVariant} margin={{ left: 4, right: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="key" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                <Tooltip formatter={(v: any, _n, p: any) => [`${v}% (${p.payload.outputKg.toLocaleString()} kg)`, 'Yield']} />
                <ReferenceLine y={YIELD_TARGET} stroke={C.warn} strokeDasharray="4 4" />
                <Bar dataKey="yieldPct" fill={C.azure} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty loading={loading} />}
        </Card>
      </div>

      {/* ── Machine parameter vs yield ───────────────────────────── */}
      <Card title="Machine setting vs yield"
        subtitle="Each point is a shift; does the setting move yield?"
        info="Joins v_machine_params to session yield (by session, else section+date+shift). Correlation is exploratory — confounders (variant, grade, mesh) apply.">
        <div className="mb-3 flex items-center gap-2">
          {(['vsdHzAvg', 'indentSpeedRpm', 'indentAngleDeg'] as const).map(k => (
            <button key={k} onClick={() => setXParam(k)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${xParam === k ? 'bg-brand text-white' : 'border border-surface-rule text-text-muted hover:text-text'}`}>
              {X_META[k].label}
            </button>
          ))}
        </div>
        {scatterData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ left: 4, right: 12, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis type="number" dataKey="x" name={X_META[xParam].label} unit={X_META[xParam].unit} tick={{ fontSize: 10 }} />
              <YAxis type="number" dataKey="y" name="Yield" unit="%" domain={[0, 100]} tick={{ fontSize: 10 }} />
              <ZAxis range={[60, 60]} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }}
                formatter={(v: any, n: any) => [n === 'Yield' ? `${v}%` : `${v} ${X_META[xParam].unit}`, n]}
                labelFormatter={() => ''} />
              <ReferenceLine y={YIELD_TARGET} stroke={C.warn} strokeDasharray="4 4" />
              <Scatter data={scatterData} fill={C.accent} />
            </ScatterChart>
          </ResponsiveContainer>
        ) : <Empty loading={loading} note="No machine readings joined to yield in this window." />}
      </Card>

      {/* ── Data completeness ────────────────────────────────────── */}
      {data && data.completeness.batches > 0 && (
        <div className="rounded-xl border border-surface-rule bg-surface-dim/40 p-3 text-[12px] text-text-muted flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-medium text-text">Data completeness</span>
          <span><b className="text-ok">{data.completeness.withQuality}</b> of {data.completeness.batches} batches have linked quality records</span>
          {data.completeness.withoutQuality > 0 && (
            <span className="text-warn">{data.completeness.withoutQuality} batches have no quality match — check lot spelling or missing lab entry.</span>
          )}
        </div>
      )}

      {/* ── Batch table (drill-down) ─────────────────────────────── */}
      <Card title="Batches" subtitle="Click a batch to filter the whole report. Production output linked to quality."
        info="From v_batch_360: production rollup joined to quality by canonical batch key.">
        {data && data.batches.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-text-muted border-b border-surface-rule text-left">
                  <th className="py-2 pr-3 font-medium">Batch</th>
                  <th className="py-2 pr-3 font-medium">Variant</th>
                  <th className="py-2 pr-3 font-medium">Sections</th>
                  <th className="py-2 pr-3 font-medium text-right">Input</th>
                  <th className="py-2 pr-3 font-medium text-right">Output</th>
                  <th className="py-2 pr-3 font-medium text-right">Yield</th>
                  <th className="py-2 pr-3 font-medium text-right">Bulk dens.</th>
                  <th className="py-2 pr-3 font-medium">Leaf shade</th>
                  <th className="py-2 pr-3 font-medium text-right">PA</th>
                  <th className="py-2 pr-3 font-medium">Residue</th>
                  <th className="py-2 pr-3 font-medium">QC</th>
                </tr>
              </thead>
              <tbody>
                {data.batches.map(b => (
                  <tr key={b.batchKey}
                    onClick={() => setBatch(b.batchKey === batch ? '' : b.batchKey)}
                    className={`border-b border-surface-rule/60 cursor-pointer hover:bg-surface-dim/50 transition ${batch === b.batchKey ? 'bg-brand/5' : ''}`}>
                    <td className="py-2 pr-3 font-medium text-text">{b.displayLot || b.batchKey}</td>
                    <td className="py-2 pr-3 text-text-muted">{b.variant || '—'}</td>
                    <td className="py-2 pr-3 text-text-muted">{(b.sections || []).map(secName).join(', ') || '—'}</td>
                    <td className="py-2 pr-3 text-right">{b.totalInputKg.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right">{b.totalOutputKg.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right font-semibold" style={{ color: (b.yieldPct ?? 0) >= YIELD_TARGET ? C.ok : C.warn }}>
                      {b.yieldPct != null ? `${b.yieldPct}%` : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right">{b.bulkDensity ?? '—'}</td>
                    <td className="py-2 pr-3 text-text-muted">{b.leafShade || '—'}</td>
                    <td className="py-2 pr-3 text-right">{b.paLevel ?? '—'}</td>
                    <td className="py-2 pr-3 text-text-muted">{b.residueGrade || '—'}</td>
                    <td className="py-2 pr-3">
                      {b.hasQuality
                        ? (b.allPassed === false
                            ? <span className="text-err inline-flex items-center gap-1"><AlertTriangle size={12} /> Fail</span>
                            : <span className="text-ok inline-flex items-center gap-1"><CheckCircle2 size={12} /> Pass</span>)
                        : <span className="text-text-faint">No data</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty loading={loading} note="No batches captured in this window." />}
      </Card>
    </div>
  )
}

function Empty({ loading, note }: { loading: boolean; note?: string }) {
  return (
    <div className="h-[200px] flex items-center justify-center text-[12px] text-text-faint">
      {loading ? 'Loading…' : (note || 'No data for this selection')}
    </div>
  )
}
