'use client'

// components/production/ProductionDashboard.tsx
// The production manager's cockpit. Live KPIs + interactive charts driven by the
// structured capture tables (prod_sessions, prod_mass_balance, bag_tags), plus
// factory weather, solar (Home Assistant), open breakdowns affecting production,
// and a Gemini AI analyst. OEE / downtime / scrap need data we don't capture yet
// — they're flagged as "coming with capture", not faked.

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  BarChart, Bar, LineChart, Line, ComposedChart, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'
import {
  RefreshCw, Package, Scale, Percent, Activity, CheckCircle2, AlertTriangle,
  Wrench, CalendarRange, ClipboardList, Users, ChevronRight, Gauge as GaugeIcon, Map as MapIcon,
} from 'lucide-react'
import { format, subMonths } from 'date-fns'
import { getDb } from '@/lib/supabase/db'
import { sectionMeta, SECTION_ORDER, MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'
import { EnergyWidget } from '@/components/maintenance/EnergyWidget'
import AiAnalystPanel from '@/components/maintenance/AiAnalystPanel'
import OperationalTrends from '@/components/management/OperationalTrends'

const C = { brand: '#1A3A0E', accent: '#5A8A2A', azure: '#2A7CB8', warn: '#B85C0A', err: '#B81C1C', ok: '#1A7A3C', info: '#2A7CB8', gray: '#96A88A' }
const PIE = [C.accent, C.azure, C.ok, C.warn, C.err, C.gray]
const round1 = (n: number) => Math.round(n * 10) / 10

const SESSION_STATUS: Record<string, { label: string; cls: string }> = {
  none:      { label: 'Idle',       cls: 'bg-stone-100 text-stone-500' },
  draft:     { label: 'Capturing',  cls: 'bg-warn/10 text-warn' },
  submitted: { label: 'Submitted',  cls: 'bg-info/10 text-info' },
  approved:  { label: 'Signed off', cls: 'bg-ok/10 text-ok' },
}

interface SessionRow { id: string; section_id: string; status: string; date: string }
interface MB { session_id: string; total_input_kg: number; total_output_b_kg: number; total_output_c_kg: number; total_output_d_kg: number }
interface Breakdown { card_no: string; area: string; machine: string | null; status: string; raised_at: string }

export default function ProductionDashboard() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [mb, setMb] = useState<Map<string, MB>>(new Map())
  const [bagsToday, setBagsToday] = useState<{ section_id: string; weight_kg: number }[]>([])
  const [breakdowns, setBreakdowns] = useState<Breakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<'output' | 'yield' | 'flow'>('output')
  const [windowDays, setWindowDays] = useState(14)

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true)
    const db = getDb()
    const start = new Date(); start.setDate(start.getDate() - (windowDays - 1))
    const startStr = format(start, 'yyyy-MM-dd')
    const todayStart = `${today}T00:00:00`

    const [{ data: sess }, { data: bags }, { data: bd }] = await Promise.all([
      db.schema('production').from('prod_sessions').select('id,section_id,status,date').gte('date', startStr),
      db.schema('production').from('bag_tags').select('section_id,weight_kg,created_at').gte('created_at', todayStart),
      db.schema('maintenance').from('job_cards').select('card_no,area,machine,status,raised_at,workflow').eq('workflow', 'breakdown').neq('status', 'complete'),
    ])
    const sessions = (sess as SessionRow[]) ?? []
    const sessIds = sessions.map(s => s.id)
    let mbRows: MB[] = []
    if (sessIds.length) {
      // chunk to stay clear of URL length limits on large windows
      for (let i = 0; i < sessIds.length; i += 200) {
        const { data } = await db.schema('production').from('prod_mass_balance')
          .select('session_id,total_input_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg')
          .in('session_id', sessIds.slice(i, i + 200))
        mbRows = mbRows.concat((data as MB[]) ?? [])
      }
    }
    setSessions(sessions)
    setMb(new Map(mbRows.map(m => [m.session_id, m])))
    setBagsToday(((bags as any[]) ?? []).map(b => ({ section_id: b.section_id, weight_kg: Number(b.weight_kg) || 0 })))
    setBreakdowns((bd as Breakdown[]) ?? [])
    setLoading(false); setRefreshing(false)
  }, [today, windowDays])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(() => load(true), 120_000); return () => clearInterval(t) }, [load])

  const a = useMemo(() => {
    const outOf = (s: SessionRow) => { const m = mb.get(s.id); return m ? (Number(m.total_output_b_kg) || 0) + (Number(m.total_output_c_kg) || 0) + (Number(m.total_output_d_kg) || 0) : 0 }
    const inOf  = (s: SessionRow) => { const m = mb.get(s.id); return m ? Number(m.total_input_kg) || 0 : 0 }

    // Daily trend over the window
    const days: { date: string; label: string; outputKg: number; sessions: number; yieldPct: number }[] = []
    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const ds = format(d, 'yyyy-MM-dd')
      const ss = sessions.filter(s => s.date === ds)
      const out = ss.reduce((t, s) => t + outOf(s), 0)
      const inp = ss.reduce((t, s) => t + inOf(s), 0)
      days.push({ date: ds, label: format(d, 'EEE d'), outputKg: Math.round(out), sessions: ss.length, yieldPct: inp ? round1(out / inp * 100) : 0 })
    }

    // Yield by section over the window
    const bySection = SECTION_ORDER.map(id => {
      const ss = sessions.filter(s => s.section_id === id)
      const out = ss.reduce((t, s) => t + outOf(s), 0)
      const inp = ss.reduce((t, s) => t + inOf(s), 0)
      return { id, name: sectionMeta(id).name, code: sectionMeta(id).code, color: sectionMeta(id).colorHex, outputKg: Math.round(out), yieldPct: inp ? round1(out / inp * 100) : 0 }
    })

    // Today, per section (live status table)
    const rank = (s: string) => ({ approved: 3, submitted: 2, draft: 1 } as Record<string, number>)[s] ?? 0
    const todayRows = SECTION_ORDER.map(id => {
      const ss = sessions.filter(s => s.section_id === id && s.date === today)
      const status = ss.reduce((acc, s) => rank(s.status) > rank(acc) ? s.status : acc, 'none')
      const kgIn = ss.reduce((t, s) => t + inOf(s), 0)
      const kgOut = ss.reduce((t, s) => t + outOf(s), 0)
      const bags = bagsToday.filter(b => b.section_id === id).length
      return { id, status, kgIn, kgOut, variance: kgIn - kgOut, bags }
    })

    const todaySessions = sessions.filter(s => s.date === today)
    const outputToday = Math.round(todaySessions.reduce((t, s) => t + outOf(s), 0))
    const inputToday  = todaySessions.reduce((t, s) => t + inOf(s), 0)
    const yieldToday  = inputToday ? round1(outputToday / inputToday * 100) : 0
    const running     = new Set(todaySessions.filter(s => s.status === 'draft').map(s => s.section_id)).size
    const pending     = todaySessions.filter(s => s.status === 'submitted').length
    const flags       = todayRows.filter(r => r.kgIn > 0 && Math.abs(r.variance) > MASS_BALANCE_TOLERANCE_KG).length
    const bagsCount   = bagsToday.length

    const statusDist = (['draft', 'submitted', 'approved'] as const)
      .map(st => ({ status: SESSION_STATUS[st].label, n: sessions.filter(s => s.status === st).length }))
      .filter(s => s.n > 0)

    const variBySection = bySection.filter(s => s.outputKg > 0)

    return { days, bySection, todayRows, outputToday, yieldToday, running, pending, flags, bagsCount, statusDist, variBySection }
  }, [sessions, mb, bagsToday, today, windowDays])

  const agg = useMemo(() => ({
    windowDays: windowDays,
    today: { date: today, outputKg: a.outputToday, bags: a.bagsCount, yieldPct: a.yieldToday, sectionsRunning: a.running, signOffsPending: a.pending, balanceFlags: a.flags },
    dailyTrend: a.days.map(d => ({ date: d.date, outputKg: d.outputKg, sessions: d.sessions, yieldPct: d.yieldPct })),
    yieldBySection: a.bySection.map(s => ({ section: s.name, outputKg: s.outputKg, yieldPct: s.yieldPct })),
    openBreakdowns: breakdowns.map(b => ({ card: b.card_no, area: b.area, machine: b.machine, status: b.status })),
  }), [a, breakdowns, today, windowDays])

  const kpis = [
    { label: 'Output today', value: a.outputToday.toLocaleString() + ' kg', icon: Scale, tone: 'info' as const },
    { label: 'Bags today', value: String(a.bagsCount), icon: Package, tone: 'info' as const },
    { label: 'Yield today', value: a.yieldToday ? a.yieldToday + '%' : '—', icon: Percent, tone: a.yieldToday && a.yieldToday < 70 ? 'warn' as const : 'ok' as const },
    { label: 'Sections running', value: String(a.running), icon: Activity, tone: 'info' as const },
    { label: 'Sign-offs pending', value: String(a.pending), icon: CheckCircle2, tone: a.pending ? 'warn' as const : 'ok' as const },
    { label: 'Balance flags', value: String(a.flags), icon: AlertTriangle, tone: a.flags ? 'warn' as const : 'ok' as const },
    { label: 'Open breakdowns', value: String(breakdowns.length), icon: Wrench, tone: breakdowns.length ? 'err' as const : 'ok' as const },
  ]

  return (
    <div className="space-y-5">
      {/* Dashboard leads with the metrics + graphs */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Today · {format(new Date(), 'EEE d MMM')}</h2>
        <button onClick={() => load(true)} className="inline-flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {kpis.map(k => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      {/* Trends — segmented + window filter */}
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-1 bg-surface-dim rounded-lg p-1 w-fit">
            {([['output', 'Output'], ['yield', 'Yield'], ['flow', 'Flow & status']] as ['output' | 'yield' | 'flow', string][]).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition ${tab === k ? 'bg-brand text-white shadow-sm' : 'text-text-muted hover:text-text'}`}>{label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-muted">Window</span>
            <div className="flex items-center gap-1 bg-surface-dim rounded-lg p-1">
              {[7, 14, 30].map(d => (
                <button key={d} onClick={() => setWindowDays(d)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${windowDays === d ? 'bg-brand text-white' : 'text-text-muted hover:text-text'}`}>{d}d</button>
              ))}
            </div>
          </div>
        </div>

        {tab === 'output' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Chart title="Daily output" subtitle={`Kg bagged per day · last ${windowDays} days`}>
              <BarChart data={a.days} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                <Bar dataKey="outputKg" name="kg out" fill={C.accent} radius={[3, 3, 0, 0]} />
              </BarChart>
            </Chart>
            <Chart title="Sessions per day" subtitle="Capture sessions opened">
              <LineChart data={a.days} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip />
                <Line type="monotone" dataKey="sessions" stroke={C.azure} strokeWidth={2} dot={false} />
              </LineChart>
            </Chart>
          </div>
        )}

        {tab === 'yield' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Chart title="Yield by section" subtitle={`Output ÷ input · last ${windowDays} days`}>
              <BarChart data={a.bySection} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                <XAxis dataKey="code" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} unit="%" /><Tooltip />
                <Bar dataKey="yieldPct" name="yield %" radius={[3, 3, 0, 0]}>
                  {a.bySection.map((s, i) => <Cell key={i} fill={s.color} />)}
                </Bar>
              </BarChart>
            </Chart>
            <Chart title="Overall yield trend" subtitle="Daily yield % across all sections">
              <ComposedChart data={a.days} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} /><YAxis tick={{ fontSize: 11 }} unit="%" /><Tooltip />
                <Line type="monotone" dataKey="yieldPct" name="yield %" stroke={C.brand} strokeWidth={2} dot={false} />
                <ReferenceLine y={70} stroke={C.warn} strokeDasharray="4 4" />
              </ComposedChart>
            </Chart>
          </div>
        )}

        {tab === 'flow' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Chart title="Where sessions sit" subtitle={`By status · last ${windowDays} days`}>
              <PieChart>
                <Pie data={a.statusDist} dataKey="n" nameKey="status" cx="50%" cy="50%" outerRadius={80} label={(e: any) => `${e.status} (${e.n})`} labelLine={false} fontSize={10}>
                  {a.statusDist.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                </Pie><Tooltip />
              </PieChart>
            </Chart>
            <Chart title="Output by section" subtitle={`Kg bagged · last ${windowDays} days`}>
              <BarChart data={a.variBySection} margin={{ top: 8, right: 8, left: -2, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" />
                <XAxis dataKey="code" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                <Bar dataKey="outputKg" name="kg out" radius={[3, 3, 0, 0]}>
                  {a.variBySection.map((s, i) => <Cell key={i} fill={s.color} />)}
                </Bar>
              </BarChart>
            </Chart>
          </div>
        )}
      </div>

      {/* Quick links — compact, below the graphs */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-text-muted mr-1">Quick links</span>
        <QuickChip href="/production/capture" icon={ClipboardList} label="Capture" />
        <QuickChip href="/supervisor" icon={Users} label="Supervisor Hub" />
        <QuickChip href="/production/roster" icon={CalendarRange} label="Shift Rosters" />
        <QuickChip href="/production/floor-plan" icon={MapIcon} label="Floor Plan" />
      </div>

      {/* Solar + breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EnergyWidget />
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wrench size={15} className="text-text-muted" />
            <h3 className="text-sm font-semibold text-text">Breakdowns affecting production</h3>
          </div>
          {breakdowns.length === 0 ? (
            <div className="text-[12px] text-text-faint py-6 text-center">No open breakdowns. All clear.</div>
          ) : (
            <div className="space-y-2">
              {breakdowns.slice(0, 8).map(b => (
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

      {/* Operational trends — folded-in Analytics (yield · reliability · velocity) */}
      <div className="card p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-text">Operational trends</h3>
          <p className="text-[11px] text-text-muted">Yield, count reliability &amp; inventory velocity · last 6 months</p>
        </div>
        <OperationalTrends dateFrom={format(subMonths(new Date(), 6), 'yyyy-MM-dd')} dateTo={today} />
      </div>

      {/* OEE / downtime / scrap — honest placeholder until capture exists */}
      <div className="card p-4 border-dashed">
        <div className="flex items-center gap-2 mb-1.5">
          <GaugeIcon size={15} className="text-text-muted" />
          <h3 className="text-sm font-semibold text-text">OEE, downtime &amp; scrap rate</h3>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-info/10 text-info">Coming next</span>
        </div>
        <p className="text-[12px] text-text-muted leading-relaxed">
          Overall Equipment Effectiveness, machine downtime/stoppages and scrap &amp; defect rates need data the floor
          doesn&apos;t capture yet (machine run-time, stoppage reasons, reject weights). The next phase adds a quick
          stoppage log and scrap field to the capture screens — then these light up here automatically.
        </p>
      </div>

      {/* Section status — at the very bottom */}
      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-surface-rule"><h3 className="text-sm font-semibold text-text">Section status · today</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-rule bg-surface-dim text-left">
                {['Section', 'Status', 'kg in', 'kg out', 'Variance', 'Bags', ''].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-rule">
              {a.todayRows.map(r => {
                const m = sectionMeta(r.id)
                const st = SESSION_STATUS[r.status] ?? SESSION_STATUS.none
                const flag = r.kgIn > 0 && Math.abs(r.variance) > MASS_BALANCE_TOLERANCE_KG
                const href = `/production/capture/${r.id}?date=${today}`
                return (
                  <tr key={r.id} className="hover:bg-surface-dim/60 transition-colors cursor-pointer" onClick={() => { window.location.href = href }}>
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
        <div className="px-4 py-2 border-t border-surface-rule text-[10px] text-text-muted">Auto-refreshes every 2 min · {format(new Date(), 'HH:mm')}</div>
      </div>
    </div>
  )
}

function Kpi({ label, value, icon: Icon, tone, loading }: { label: string; value: string; icon: typeof Package; tone: 'ok' | 'warn' | 'err' | 'info'; loading: boolean }) {
  const accent = { ok: '#1A7A3C', warn: '#B85C0A', err: '#B81C1C', info: '#2A7CB8' }[tone]
  const tint   = { ok: 'rgba(26,122,60,0.06)', warn: 'rgba(184,92,10,0.06)', err: 'rgba(184,28,28,0.06)', info: 'rgba(42,124,184,0.05)' }[tone]
  return (
    <div className="rounded-xl border border-surface-rule p-4" style={{ borderLeft: `3px solid ${accent}`, background: tint }}>
      <div className="flex items-center justify-between">
        <Icon size={14} style={{ color: accent }} />
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
      </div>
      <div className="text-[22px] leading-none font-semibold mt-2" style={{ color: accent }}>{loading ? '—' : value}</div>
      <div className="text-[10px] uppercase tracking-wide text-text-muted mt-1">{label}</div>
    </div>
  )
}

function QuickChip({ href, icon: Icon, label }: { href: string; icon: typeof Package; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-rule bg-surface-card px-2.5 py-1.5 text-[12px] text-text hover:border-brand/40 hover:text-brand transition">
      <Icon size={13} /> {label}
    </Link>
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
