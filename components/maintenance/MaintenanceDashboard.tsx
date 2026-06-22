'use client'

// components/maintenance/MaintenanceDashboard.tsx
// Focused maintenance analytics: one curated KPI row, charts organised behind a
// segmented control (so only two show at once — depth via drill-down, not
// density), and the Gemini AI analyst. Reads the shared data provider.

import { useMemo, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, ComposedChart, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { X } from 'lucide-react'
import { useMaintenanceContext } from '@/app/(app)/maintenance/layout'
import type { JobCard } from '@/lib/maintenance/types'
import { fmtD, diffM } from '@/lib/maintenance/helpers'
import AiAnalystPanel from './AiAnalystPanel'

const C = { brand: '#1A3A0E', accent: '#5A8A2A', azure: '#2A7CB8', warn: '#B85C0A', err: '#B81C1C', ok: '#1A7A3C', info: '#2A7CB8', gray: '#96A88A' }
const PIE = [C.err, C.azure, C.accent, C.warn, C.brand, C.ok, C.gray]
const machineOf = (j: JobCard) => j.machine || j.area || 'Unknown'
const hrs = (m: number) => Math.round((m / 60) * 10) / 10
type Tab = 'reliability' | 'people' | 'spares'

export default function MaintenanceDashboard() {
  const { data, derived, weekKey, moKey } = useMaintenanceContext()
  const { jcs, sparesUsed, templates, completions } = data
  const [drill, setDrill] = useState<{ title: string; rows: JobCard[] } | null>(null)
  const [tab, setTab] = useState<Tab>('reliability')

  const a = useMemo(() => {
    const completed = jcs.filter(j => j.status === 'complete')
    const breakdowns = jcs.filter(j => j.workflow === 'breakdown')
    const now = new Date()
    const months: { label: string; start: number; end: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      months.push({ label: s.toLocaleDateString('en-ZA', { month: 'short' }), start: s.getTime(), end: e.getTime() })
    }
    const inMonth = (iso: string | null, m: { start: number; end: number }) => { if (!iso) return false; const t = new Date(iso).getTime(); return t >= m.start && t < m.end }

    const mttrTrend = months.map(m => {
      const cc = completed.filter(j => inMonth(j.completed_at, m) && j.accepted_at)
      const mins = cc.reduce((s, j) => s + diffM(j.accepted_at, j.completed_at), 0)
      return { label: m.label, mttr: cc.length ? hrs(mins / cc.length) : 0 }
    })
    const reactiveTrend = months.map(m => {
      const raised = jcs.filter(j => inMonth(j.raised_at, m))
      const bd = raised.filter(j => j.workflow === 'breakdown').length
      return { label: m.label, breakdown: bd, planned: raised.length - bd, reactivePct: raised.length ? Math.round(bd / raised.length * 100) : 0 }
    })
    const dtMap: Record<string, number> = {}
    completed.forEach(j => { if (j.raised_at && j.completed_at) dtMap[machineOf(j)] = (dtMap[machineOf(j)] ?? 0) + diffM(j.raised_at, j.completed_at) })
    const dtSorted = Object.entries(dtMap).map(([machine, mins]) => ({ machine, hours: hrs(mins) })).sort((x, y) => y.hours - x.hours)
    const dtTotal = dtSorted.reduce((s, d) => s + d.hours, 0) || 1
    let cum = 0
    const downtime = dtSorted.slice(0, 10).map(d => { cum += d.hours; return { ...d, cumPct: Math.round(cum / dtTotal * 100) } })

    const roMap: Record<string, { bd: number; ro: number }> = {}
    jcs.forEach(j => { const k = machineOf(j); roMap[k] = roMap[k] ?? { bd: 0, ro: 0 }; if (j.workflow === 'breakdown') roMap[k].bd++; roMap[k].ro += j.reopen_count ?? 0 })
    const repeat = Object.entries(roMap).map(([machine, v]) => ({ machine, score: v.bd + v.ro, ...v })).filter(r => r.score > 0).sort((x, y) => y.score - x.score).slice(0, 8)

    const techNames = Array.from(new Set(jcs.map(j => j.assigned_to).filter(Boolean))) as string[]
    const techMetrics = techNames.map(t => {
      const mine = jcs.filter(j => j.assigned_to === t)
      const done = mine.filter(j => j.status === 'complete')
      const resp = mine.filter(j => j.assigned_at && j.accepted_at)
      const avgRespMin = resp.length ? Math.round(resp.reduce((s, j) => s + diffM(j.assigned_at, j.accepted_at), 0) / resp.length) : 0
      return { tech: t, assigned: mine.length, completed: done.length, avgRespMin }
    }).sort((x, y) => y.assigned - x.assigned)

    const spMap: Record<string, number> = {}
    sparesUsed.forEach(s => { spMap[s.description] = (spMap[s.description] ?? 0) + (s.qty ?? 0) })
    const sparesTop = Object.entries(spMap).map(([name, qty]) => ({ name: name.length > 22 ? name.slice(0, 22) + '…' : name, qty })).sort((x, y) => y.qty - x.qty).slice(0, 8)
    const cutoff = now.getTime() - 30 * 86400000
    const criticalLast30 = sparesUsed.filter(s => s.is_critical && new Date(s.created_at).getTime() >= cutoff).length
    const outOfNew = data.stock.filter(s => (s.qty_new ?? 0) === 0).length

    const comp = (freq: 'weekly' | 'monthly', period: string) => {
      const tpls = templates.filter(t => t.frequency === freq)
      let due = 0, done = 0
      tpls.forEach(t => { const c = completions.find(x => x.template_id === t.id && x.period_key === period); due += (t.tasks?.length ?? 0); if (c) done += Object.values(c.task_states ?? {}).filter((s: any) => s?.done).length })
      return due ? Math.round(done / due * 100) : 0
    }
    const weeklyPct = comp('weekly', weekKey), monthlyPct = comp('monthly', moKey)
    const statusDist = derived.statuses.map(s => ({ status: s, n: jcs.filter(j => j.status === s).length })).filter(s => s.n > 0)
    const openCards = jcs.filter(j => j.status !== 'complete')

    return {
      completed, breakdowns, openCards, mttrTrend, reactiveTrend, downtime, repeat, techMetrics,
      sparesTop, criticalLast30, outOfNew, weeklyPct, monthlyPct, statusDist,
      mttrNow: mttrTrend[mttrTrend.length - 1]?.mttr ?? 0,
      reactiveNow: reactiveTrend[reactiveTrend.length - 1]?.reactivePct ?? 0,
    }
  }, [jcs, sparesUsed, templates, completions, data.stock, derived.statuses, weekKey, moKey])

  const agg = useMemo(() => ({
    period: `${weekKey} / ${moKey}`,
    totals: { cards: jcs.length, breakdowns: a.breakdowns.length, planned: jcs.length - a.breakdowns.length, completed: a.completed.length, completionRate: derived.completionRate, reopens: derived.reopens },
    mttrHours: a.mttrNow, mttrTrend: a.mttrTrend,
    reactiveRatioPct: a.reactiveNow, reactiveTrend: a.reactiveTrend,
    downtimeByMachineTopHours: a.downtime.map(d => ({ machine: d.machine, hours: d.hours })),
    repeatOffenders: a.repeat.map(r => ({ machine: r.machine, breakdowns: r.bd, reopens: r.ro })),
    technicians: a.techMetrics,
    spares: { criticalLast30: a.criticalLast30, outOfNewStock: a.outOfNew, topConsumed: a.sparesTop },
    compliance: { weeklyPct: a.weeklyPct, monthlyPct: a.monthlyPct },
  }), [a, jcs.length, weekKey, moKey, derived.completionRate, derived.reopens])

  const openDrill = (title: string, rows: JobCard[]) => setDrill({ title, rows })
  const topAsset = a.downtime[0]

  return (
    <div className="space-y-5">
      {/* Curated KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Open cards" value={String(a.openCards.length)} hint="Not yet complete" tone="info" onClick={() => openDrill('Open job cards', a.openCards)} />
        <Kpi label="MTTR" value={`${a.mttrNow}h`} hint="Mean time to repair" tone="info" onClick={() => openDrill('Completed this month', a.completed)} />
        <Kpi label="Reactive" value={`${a.reactiveNow}%`} hint="Breakdowns vs raised" tone={a.reactiveNow > 30 ? 'warn' : 'ok'} onClick={() => openDrill('Breakdowns', a.breakdowns)} />
        <Kpi label="Top downtime" value={topAsset?.machine ?? '—'} hint={`${topAsset?.hours ?? 0}h lost`} tone="warn" onClick={() => topAsset && openDrill(`Downtime: ${topAsset.machine}`, jcs.filter(j => machineOf(j) === topAsset.machine))} />
        <Kpi label="Chronic assets" value={String(a.repeat.filter(r => r.score >= 4).length)} hint="≥4 breakdowns+reopens" tone="err" onClick={() => openDrill('Repeat-offender cards', jcs.filter(j => a.repeat.some(r => r.score >= 4 && r.machine === machineOf(j))))} />
        <Kpi label="Weekly compliance" value={`${a.weeklyPct}%`} hint="Checklist tasks done" tone={a.weeklyPct < 80 ? 'warn' : 'ok'} />
      </div>

      {/* Charts — segmented to avoid overload */}
      <div className="rounded-xl border border-surface-rule bg-surface-card p-4">
        <div className="flex items-center gap-1 mb-4 bg-surface-dim rounded-lg p-1 w-fit">
          {([['reliability', 'Reliability'], ['people', 'People'], ['spares', 'Spares & compliance']] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition ${tab === k ? 'bg-brand text-white shadow-sm' : 'text-text-muted hover:text-text'}`}>{label}</button>
          ))}
        </div>

        {tab === 'reliability' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Chart title="Breakdown vs planned" subtitle="Cards raised per month · target ≤30% reactive">
              <ComposedChart data={a.reactiveTrend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                <Bar dataKey="breakdown" stackId="a" fill={C.err} /><Bar dataKey="planned" stackId="a" fill={C.accent} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="reactivePct" stroke={C.brand} strokeWidth={2} dot={false} /><ReferenceLine y={30} stroke={C.warn} strokeDasharray="4 4" />
              </ComposedChart>
            </Chart>
            <Chart title="Downtime by machine" subtitle="Hours lost (Pareto) · click a bar to drill in">
              <ComposedChart data={a.downtime} margin={{ top: 8, right: 8, left: -18, bottom: 44 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                <XAxis dataKey="machine" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} height={64} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                <Bar dataKey="hours" fill={C.warn} radius={[3, 3, 0, 0]} cursor="pointer" onClick={(d: any) => openDrill(`Downtime: ${d.machine}`, jcs.filter(j => machineOf(j) === d.machine))} />
                <Line type="monotone" dataKey="cumPct" stroke={C.brand} strokeWidth={2} dot={false} /><ReferenceLine y={80} stroke={C.gray} strokeDasharray="4 4" />
              </ComposedChart>
            </Chart>
          </div>
        )}

        {tab === 'people' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Chart title="Technician workload" subtitle="Assigned vs completed">
              <BarChart data={a.techMetrics} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                <XAxis dataKey="tech" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                <Bar dataKey="assigned" fill={C.azure} radius={[3, 3, 0, 0]} /><Bar dataKey="completed" fill={C.accent} radius={[3, 3, 0, 0]} />
              </BarChart>
            </Chart>
            <Chart title="Where work sits" subtitle="Job cards by status">
              <PieChart>
                <Pie data={a.statusDist} dataKey="n" nameKey="status" cx="50%" cy="50%" outerRadius={80} label={(e: any) => `${e.status} (${e.n})`} labelLine={false} fontSize={10}>
                  {a.statusDist.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                </Pie><Tooltip />
              </PieChart>
            </Chart>
          </div>
        )}

        {tab === 'spares' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
            <Chart title="Top spares consumed" subtitle="Quantity used across job cards">
              {a.sparesTop.length === 0 ? <Empty /> : (
                <BarChart layout="vertical" data={a.sparesTop} margin={{ top: 4, right: 12, left: 60, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={120} /><Tooltip />
                  <Bar dataKey="qty" fill={C.brand} radius={[0, 3, 3, 0]} />
                </BarChart>
              )}
            </Chart>
            <div className="flex items-center justify-around py-6">
              <Gauge pct={a.weeklyPct} label="Weekly" /><Gauge pct={a.monthlyPct} label="Monthly" />
              <div className="text-center">
                <div className="text-3xl font-semibold text-err tabular-nums">{a.outOfNew}</div>
                <div className="text-[11px] uppercase tracking-wider text-text-muted mt-1">Out of<br />new stock</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <AiAnalystPanel agg={agg} />

      {drill && (
        <div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setDrill(null)}>
          <div className="card p-5 w-[760px] max-w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-text">{drill.title} <span className="text-text-muted font-normal">({drill.rows.length})</span></h3>
              <button onClick={() => setDrill(null)} className="text-text-muted hover:text-text"><X className="w-4 h-4" /></button>
            </div>
            {drill.rows.length === 0 ? <Empty /> : (
              <table className="data-table w-full text-[12px]">
                <thead><tr><th>Card</th><th>Area / Machine</th><th>Type</th><th>Status</th><th>Raised</th><th>Downtime</th><th>Reopens</th></tr></thead>
                <tbody>{drill.rows.map(j => (
                  <tr key={j.id}>
                    <td className="font-mono">{j.card_no}</td><td>{j.area}{j.machine ? ` · ${j.machine}` : ''}</td><td>{j.workflow}</td><td>{j.status}</td>
                    <td>{fmtD(j.raised_at)}</td><td className="tabular-nums">{j.completed_at ? hrs(diffM(j.raised_at, j.completed_at)) + 'h' : '—'}</td><td className="tabular-nums">{j.reopen_count ?? 0}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, hint, tone, onClick }: { label: string; value: string; hint: string; tone: 'ok' | 'warn' | 'err' | 'info'; onClick?: () => void }) {
  const dot = { ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err', info: 'bg-info' }[tone]
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`rounded-xl border border-surface-rule bg-surface-card p-4 text-left transition ${onClick ? 'shadow-sm hover:border-text/25 hover:shadow-md cursor-pointer' : 'cursor-default'}`}>
      <div className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${dot}`} /><span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span></div>
      <div className="text-xl font-semibold text-text mt-1.5 truncate">{value}</div>
      <div className="text-[10px] text-text-faint mt-0.5">{hint}</div>
    </button>
  )
}

function Chart({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactElement }) {
  return (
    <div>
      <div className="mb-2"><h3 className="text-sm font-semibold text-text">{title}</h3><p className="text-[11px] text-text-muted">{subtitle}</p></div>
      <ResponsiveContainer width="100%" height={240}>{children}</ResponsiveContainer>
    </div>
  )
}

function Gauge({ pct, label }: { pct: number; label: string }) {
  const color = pct >= 80 ? '#1A7A3C' : pct >= 50 ? '#B85C0A' : '#B81C1C'
  const r = 34, circ = 2 * Math.PI * r, off = circ - (pct / 100) * circ
  return (
    <div className="text-center">
      <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r={r} fill="none" stroke="#E4E7EC" strokeWidth="9" />
        <circle cx="45" cy="45" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} transform="rotate(-90 45 45)" />
        <text x="45" y="50" textAnchor="middle" fontSize="18" fontWeight="700" fill="#1A2415">{pct}%</text>
      </svg>
      <div className="text-[11px] uppercase tracking-wider text-text-muted mt-1">{label}</div>
    </div>
  )
}

function Empty() { return <div className="h-[200px] flex items-center justify-center text-[12px] text-text-faint">No data yet</div> }
