'use client'

// components/maintenance/MaintenanceDashboard.tsx
// Custom maintenance dashboard: clickable KPI tiles + recharts visuals + smart
// analytics (MTTR, reactive ratio, downtime Pareto, repeat offenders, technician
// throughput, spares, compliance) with a drill-down modal showing the underlying
// job cards. Friendly for non-technical users. Reads the shared data provider.

import { useMemo, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, ComposedChart, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { X } from 'lucide-react'
import { useMaintenanceContext } from '@/app/(app)/maintenance/layout'
import type { JobCard } from '@/lib/maintenance/types'
import { fmtD, diffM, diffDays } from '@/lib/maintenance/helpers'
import AiAnalystPanel from './AiAnalystPanel'

// Brand-aligned palette (hex for reliable SVG rendering)
const C = { brand: '#1A3A0E', accent: '#5A8A2A', azure: '#2A7CB8', warn: '#B85C0A', err: '#B81C1C', ok: '#1A7A3C', info: '#2A7CB8', gray: '#96A88A' }
const PIE = [C.err, C.azure, C.accent, C.warn, C.brand, C.ok, C.gray]
const machineOf = (j: JobCard) => j.machine || j.area || 'Unknown'
const hrs = (m: number) => Math.round((m / 60) * 10) / 10

export default function MaintenanceDashboard() {
  const { data, derived, weekKey, moKey } = useMaintenanceContext()
  const { jcs, sparesUsed, templates, completions } = data
  const [drill, setDrill] = useState<{ title: string; rows: JobCard[] } | null>(null)

  const a = useMemo(() => {
    const completed = jcs.filter(j => j.status === 'complete')
    const breakdowns = jcs.filter(j => j.workflow === 'breakdown')

    // Last 6 months
    const now = new Date()
    const months: { key: string; label: string; start: number; end: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      months.push({ key: `${s.getFullYear()}-${s.getMonth()}`, label: s.toLocaleDateString('en-ZA', { month: 'short' }), start: s.getTime(), end: e.getTime() })
    }
    const inMonth = (iso: string | null, m: { start: number; end: number }) => {
      if (!iso) return false; const t = new Date(iso).getTime(); return t >= m.start && t < m.end
    }

    // MTTR trend (hrs) — mean accepted→completed of cards completed that month
    const mttrTrend = months.map(m => {
      const cc = completed.filter(j => inMonth(j.completed_at, m) && j.accepted_at)
      const mins = cc.reduce((s, j) => s + diffM(j.accepted_at, j.completed_at), 0)
      return { label: m.label, mttr: cc.length ? hrs(mins / cc.length) : 0 }
    })
    // Reactive ratio trend — breakdown share of cards raised that month
    const reactiveTrend = months.map(m => {
      const raised = jcs.filter(j => inMonth(j.raised_at, m))
      const bd = raised.filter(j => j.workflow === 'breakdown').length
      return { label: m.label, breakdown: bd, planned: raised.length - bd, reactivePct: raised.length ? Math.round(bd / raised.length * 100) : 0 }
    })

    // Downtime by machine (Pareto) — raised→completed hours
    const dtMap: Record<string, number> = {}
    completed.forEach(j => { if (j.raised_at && j.completed_at) dtMap[machineOf(j)] = (dtMap[machineOf(j)] ?? 0) + diffM(j.raised_at, j.completed_at) })
    const dtSorted = Object.entries(dtMap).map(([machine, mins]) => ({ machine, hours: hrs(mins) })).sort((x, y) => y.hours - x.hours)
    const dtTotal = dtSorted.reduce((s, d) => s + d.hours, 0) || 1
    let cum = 0
    const downtime = dtSorted.slice(0, 10).map(d => { cum += d.hours; return { ...d, cumPct: Math.round(cum / dtTotal * 100) } })

    // Repeat offenders — breakdowns + reopens
    const roMap: Record<string, { bd: number; ro: number }> = {}
    jcs.forEach(j => { const k = machineOf(j); roMap[k] = roMap[k] ?? { bd: 0, ro: 0 }; if (j.workflow === 'breakdown') roMap[k].bd++; roMap[k].ro += j.reopen_count ?? 0 })
    const repeat = Object.entries(roMap).map(([machine, v]) => ({ machine, score: v.bd + v.ro, ...v })).filter(r => r.score > 0).sort((x, y) => y.score - x.score).slice(0, 8)

    // Technician throughput + response
    const techNames = Array.from(new Set(jcs.map(j => j.assigned_to).filter(Boolean))) as string[]
    const techMetrics = techNames.map(t => {
      const mine = jcs.filter(j => j.assigned_to === t)
      const done = mine.filter(j => j.status === 'complete')
      const resp = mine.filter(j => j.assigned_at && j.accepted_at)
      const avgRespMin = resp.length ? Math.round(resp.reduce((s, j) => s + diffM(j.assigned_at, j.accepted_at), 0) / resp.length) : 0
      const reopenRate = done.length ? Math.round(done.reduce((s, j) => s + (j.reopen_count ?? 0), 0) / done.length * 100) / 100 : 0
      return { tech: t, assigned: mine.length, completed: done.length, avgRespMin, reopenRate }
    }).sort((x, y) => y.assigned - x.assigned)

    // Spares
    const spMap: Record<string, number> = {}
    sparesUsed.forEach(s => { spMap[s.description] = (spMap[s.description] ?? 0) + (s.qty ?? 0) })
    const sparesTop = Object.entries(spMap).map(([name, qty]) => ({ name: name.length > 22 ? name.slice(0, 22) + '…' : name, qty })).sort((x, y) => y.qty - x.qty).slice(0, 8)
    const cutoff = new Date(now.getTime() - 30 * 86400000).getTime()
    const criticalLast30 = sparesUsed.filter(s => s.is_critical && new Date(s.created_at).getTime() >= cutoff).length
    const outOfNew = data.stock.filter(s => (s.qty_new ?? 0) === 0).length

    // Scheduled compliance for the current period
    const comp = (freq: 'weekly' | 'monthly', period: string) => {
      const tpls = templates.filter(t => t.frequency === freq)
      let due = 0, done = 0
      tpls.forEach(t => {
        const c = completions.find(x => x.template_id === t.id && x.period_key === period)
        due += (t.tasks?.length ?? 0)
        if (c) done += Object.values(c.task_states ?? {}).filter((s: any) => s?.done).length
      })
      return due ? Math.round(done / due * 100) : 0
    }
    const weeklyPct = comp('weekly', weekKey)
    const monthlyPct = comp('monthly', moKey)

    // Status distribution
    const statusDist = derived.statuses.map(s => ({ status: s, n: jcs.filter(j => j.status === s).length })).filter(s => s.n > 0)

    return {
      completed, breakdowns, mttrTrend, reactiveTrend, downtime, repeat, techMetrics,
      sparesTop, criticalLast30, outOfNew, weeklyPct, monthlyPct, statusDist,
      mttrNow: mttrTrend[mttrTrend.length - 1]?.mttr ?? 0,
      reactiveNow: reactiveTrend[reactiveTrend.length - 1]?.reactivePct ?? 0,
    }
  }, [jcs, sparesUsed, templates, completions, data.stock, derived.statuses, weekKey, moKey])

  // Compact aggregate blob for the AI analyst (no raw rows)
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

  return (
    <div className="space-y-5">
      {/* Smart KPI strip — clickable */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 stagger">
        <Kpi label="MTTR (this month)" value={`${a.mttrNow} hrs`} hint="Mean time to repair" tone="info"
             onClick={() => openDrill('Completed this month', a.completed)} />
        <Kpi label="Reactive ratio" value={`${a.reactiveNow}%`} hint="Breakdowns vs all raised" tone={a.reactiveNow > 30 ? 'warn' : 'ok'}
             onClick={() => openDrill('Breakdowns', a.breakdowns)} />
        <Kpi label="Top downtime asset" value={a.downtime[0]?.machine ?? '—'} hint={`${a.downtime[0]?.hours ?? 0} hrs lost`} tone="warn"
             onClick={() => openDrill(`Downtime: ${a.downtime[0]?.machine ?? '—'}`, jcs.filter(j => machineOf(j) === a.downtime[0]?.machine))} />
        <Kpi label="Chronic assets" value={String(a.repeat.filter(r => r.score >= 4).length)} hint="≥4 breakdowns+reopens" tone="err"
             onClick={() => openDrill('Repeat-offender cards', jcs.filter(j => a.repeat.some(r => r.score >= 4 && r.machine === machineOf(j))))} />
        <Kpi label="Critical spares (30d)" value={String(a.criticalLast30)} hint="Critical parts used" tone="warn" />
        <Kpi label="Weekly compliance" value={`${a.weeklyPct}%`} hint="Checklist tasks done" tone={a.weeklyPct < 80 ? 'warn' : 'ok'} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="MTTR trend" subtitle="Mean time to repair (hrs) by month">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={a.mttrTrend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
              <Tooltip /><Line type="monotone" dataKey="mttr" stroke={C.azure} strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Breakdown vs planned" subtitle="Cards raised per month (% reactive line)">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={a.reactiveTrend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="breakdown" stackId="a" fill={C.err} radius={[0, 0, 0, 0]} />
              <Bar dataKey="planned" stackId="a" fill={C.accent} radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="reactivePct" stroke={C.brand} strokeWidth={2} dot={false} />
              <ReferenceLine y={30} stroke={C.warn} strokeDasharray="4 4" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Downtime by machine" subtitle="Hours lost (Pareto) — click a bar to drill in">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={a.downtime} margin={{ top: 8, right: 12, left: -16, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
              <XAxis dataKey="machine" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} height={60} />
              <YAxis tick={{ fontSize: 11 }} /><Tooltip />
              <Bar dataKey="hours" fill={C.warn} radius={[3, 3, 0, 0]} cursor="pointer"
                   onClick={(d: any) => openDrill(`Downtime: ${d.machine}`, jcs.filter(j => machineOf(j) === d.machine))} />
              <Line type="monotone" dataKey="cumPct" stroke={C.brand} strokeWidth={2} dot={false} yAxisId={0} />
              <ReferenceLine y={80} stroke={C.gray} strokeDasharray="4 4" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Repeat-offender machines" subtitle="Breakdowns + reopens — click to drill in">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart layout="vertical" data={a.repeat} margin={{ top: 4, right: 16, left: 40, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
              <XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="machine" tick={{ fontSize: 10 }} width={90} />
              <Tooltip />
              <Bar dataKey="score" radius={[0, 3, 3, 0]} cursor="pointer"
                   onClick={(d: any) => openDrill(`Cards: ${d.machine}`, jcs.filter(j => machineOf(j) === d.machine))}>
                {a.repeat.map((r, i) => <Cell key={i} fill={r.score >= 4 ? C.err : r.score >= 2 ? C.warn : C.accent} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Technician workload" subtitle="Assigned vs completed">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={a.techMetrics} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
              <XAxis dataKey="tech" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
              <Bar dataKey="assigned" fill={C.azure} radius={[3, 3, 0, 0]} />
              <Bar dataKey="completed" fill={C.accent} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Job-card status" subtitle="Where work sits right now">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={a.statusDist} dataKey="n" nameKey="status" cx="50%" cy="50%" outerRadius={80} label={(e: any) => `${e.status} (${e.n})`} labelLine={false} fontSize={10}>
                {a.statusDist.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Spares + compliance row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Top spares consumed" subtitle="Quantity used across job cards">
          {a.sparesTop.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart layout="vertical" data={a.sparesTop} margin={{ top: 4, right: 16, left: 60, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                <XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={120} />
                <Tooltip /><Bar dataKey="qty" fill={C.brand} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Scheduled-maintenance compliance" subtitle="Checklist tasks completed this period">
          <div className="flex items-center justify-around h-[220px]">
            <Gauge pct={a.weeklyPct} label="Weekly" />
            <Gauge pct={a.monthlyPct} label="Monthly" />
            <div className="text-center">
              <div className="text-3xl font-semibold text-text tabular-nums">{a.outOfNew}</div>
              <div className="text-[11px] uppercase tracking-wider text-text-muted mt-1">Parts out of<br />new stock</div>
            </div>
          </div>
        </ChartCard>
      </div>

      {/* AI analyst */}
      <AiAnalystPanel agg={agg} />

      {/* Drill-down modal */}
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
                <tbody>
                  {drill.rows.map(j => (
                    <tr key={j.id}>
                      <td className="font-mono">{j.card_no}</td>
                      <td>{j.area}{j.machine ? ` · ${j.machine}` : ''}</td>
                      <td>{j.workflow}</td>
                      <td>{j.status}</td>
                      <td>{fmtD(j.raised_at)}</td>
                      <td className="tabular-nums">{j.completed_at ? hrs(diffM(j.raised_at, j.completed_at)) + 'h' : '—'}</td>
                      <td className="tabular-nums">{j.reopen_count ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, hint, tone, onClick }: { label: string; value: string; hint: string; tone: 'ok' | 'warn' | 'err' | 'info'; onClick?: () => void }) {
  const ring = { ok: 'border-ok/30', warn: 'border-warn/30', err: 'border-err/30', info: 'border-info/30' }[tone]
  const dot = { ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err', info: 'bg-info' }[tone]
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`card p-4 text-left border ${ring} ${onClick ? 'hover:shadow-md cursor-pointer' : 'cursor-default'} transition`}>
      <div className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${dot}`} /><span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span></div>
      <div className="text-xl font-semibold text-text mt-1 truncate">{value}</div>
      <div className="text-[10px] text-text-faint mt-0.5">{hint}</div>
    </button>
  )
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-2"><h3 className="text-sm font-semibold text-text">{title}</h3><p className="text-[11px] text-text-muted">{subtitle}</p></div>
      {children}
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
        <circle cx="45" cy="45" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={off} transform="rotate(-90 45 45)" />
        <text x="45" y="50" textAnchor="middle" fontSize="18" fontWeight="700" fill="#1A2415">{pct}%</text>
      </svg>
      <div className="text-[11px] uppercase tracking-wider text-text-muted mt-1">{label}</div>
    </div>
  )
}

function Empty() {
  return <div className="h-[200px] flex items-center justify-center text-[12px] text-text-faint">No data yet</div>
}
