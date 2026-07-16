'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO, subDays, eachDayOfInterval } from 'date-fns'
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer,
} from 'recharts'
import { Clock, Scale, Factory, AlertTriangle, Users, Loader2, TrendingUp } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { sectionMeta, SECTION_ORDER, MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'
import { HubHeader } from '@/components/supervisor/HubTabs'

const todayStr = () => format(new Date(), 'yyyy-MM-dd')
const hrsLabel = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}h ${m}m` : `${m}m` }
const AXIS = { fontSize: 11, fill: '#637056' }
const GRID = '#F0F2F5'

interface Sheet { operator_name: string; date: string; worked_minutes: number | null }
interface Sess  { id: string; section_id: string; date: string }
interface MB    { session_id: string; total_input_kg: number; total_output_b_kg: number; total_output_c_kg: number; total_output_d_kg: number }

export default function SupervisorAnalytics() {
  const [start, setStart] = useState(() => format(subDays(new Date(), 13), 'yyyy-MM-dd'))
  const [end, setEnd]     = useState(todayStr)
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [sessions, setSessions] = useState<Sess[]>([])
  const [mb, setMb] = useState<Map<string, MB>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const db = getDb()
    async function load() {
      const [ts, ss] = await Promise.all([
        db.schema('production').from('prod_timesheets').select('operator_name,date,worked_minutes').eq('confirmed', true).gte('date', start).lte('date', end),
        db.schema('production').from('prod_sessions').select('id,section_id,date').gte('date', start).lte('date', end).is('deleted_at', null),
      ])
      const sess = (ss.data as Sess[]) ?? []
      let mbRows: MB[] = []
      if (sess.length) {
        const { data } = await db.schema('production').from('prod_mass_balance')
          .select('session_id,total_input_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg')
          .in('session_id', sess.map(s => s.id))
        mbRows = (data as MB[]) ?? []
      }
      if (!alive) return
      setSheets((ts.data as Sheet[]) ?? [])
      setSessions(sess)
      setMb(new Map(mbRows.map(m => [m.session_id, m])))
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [start, end])

  const kgOut = (m?: MB) => m ? (Number(m.total_output_b_kg) || 0) + (Number(m.total_output_c_kg) || 0) + (Number(m.total_output_d_kg) || 0) : 0

  // Continuous day axis (fills gaps with zeros).
  const dayKeys = useMemo(() => {
    try { return eachDayOfInterval({ start: parseISO(start), end: parseISO(end) }).map(d => format(d, 'yyyy-MM-dd')) }
    catch { return [] }
  }, [start, end])

  const perDay = useMemo(() => {
    const hours = new Map<string, number>(), kg = new Map<string, number>()
    sheets.forEach(s => hours.set(s.date, (hours.get(s.date) ?? 0) + (s.worked_minutes ?? 0)))
    sessions.forEach(s => kg.set(s.date, (kg.get(s.date) ?? 0) + kgOut(mb.get(s.id))))
    return dayKeys.map(d => ({
      day: format(parseISO(d), 'd MMM'),
      hours: +((hours.get(d) ?? 0) / 60).toFixed(1),
      kg: Math.round(kg.get(d) ?? 0),
    }))
  }, [dayKeys, sheets, sessions, mb])

  const byOperator = useMemo(() => {
    const m = new Map<string, number>()
    sheets.forEach(s => m.set(s.operator_name, (m.get(s.operator_name) ?? 0) + (s.worked_minutes ?? 0)))
    return Array.from(m.entries()).map(([name, min]) => ({ name, hours: +(min / 60).toFixed(1) }))
      .sort((a, b) => b.hours - a.hours).slice(0, 8)
  }, [sheets])

  const bySection = useMemo(() =>
    SECTION_ORDER.map(id => ({
      id, name: sectionMeta(id).name, color: sectionMeta(id).colorHex,
      kg: Math.round(sessions.filter(s => s.section_id === id).reduce((sum, s) => sum + kgOut(mb.get(s.id)), 0)),
    })).filter(r => r.kg > 0)
  , [sessions, mb])

  const totals = useMemo(() => {
    const totalMin = sheets.reduce((s, r) => s + (r.worked_minutes ?? 0), 0)
    const totalKg = sessions.reduce((s, r) => s + kgOut(mb.get(r.id)), 0)
    const flags = sessions.filter(s => { const m = mb.get(s.id); if (!m) return false; const v = (Number(m.total_input_kg) || 0) - kgOut(m); return Number(m.total_input_kg) > 0 && Math.abs(v) > MASS_BALANCE_TOLERANCE_KG }).length
    return { totalMin, totalKg: Math.round(totalKg), productions: sessions.length, flags, operators: new Set(sheets.map(s => s.operator_name)).size }
  }, [sheets, sessions, mb])

  const tiles = [
    { label: 'Total hours', value: hrsLabel(totals.totalMin), icon: Clock, cls: 'text-brand' },
    { label: 'kg out', value: totals.totalKg.toLocaleString(), icon: Scale, cls: 'text-text' },
    { label: 'Productions', value: String(totals.productions), icon: Factory, cls: 'text-text' },
    { label: 'Operators', value: String(totals.operators), icon: Users, cls: 'text-text' },
    { label: 'Balance flags', value: String(totals.flags), icon: AlertTriangle, cls: totals.flags ? 'text-warn' : 'text-text-muted' },
  ]

  function preset(days: number) { setStart(format(subDays(new Date(), days - 1), 'yyyy-MM-dd')); setEnd(todayStr()) }
  const PILL = 'px-3 py-1.5 rounded-full text-[12px] font-medium border bg-white border-stone-200 text-stone-500 hover:border-brand transition-colors'

  return (
    <div className="px-4 py-6 max-w-[1000px] mx-auto space-y-5">
      <HubHeader subtitle="Full analytics — hours, output and balance over time" />

      {/* Range */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => preset(7)} className={PILL}>7 days</button>
        <button onClick={() => preset(14)} className={PILL}>14 days</button>
        <button onClick={() => preset(30)} className={PILL}>30 days</button>
        <input type="date" value={start} onChange={e => setStart(e.target.value)} className="px-3 py-2 rounded-lg border border-stone-200 text-[12px] font-mono outline-none focus:border-brand" />
        <span className="text-[12px] text-stone-400">→</span>
        <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="px-3 py-2 rounded-lg border border-stone-200 text-[12px] font-mono outline-none focus:border-brand" />
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {tiles.map(t => (
          <div key={t.label} className="bg-surface-card border border-surface-rule rounded-xl p-4">
            <t.icon size={14} className={`${t.cls} mb-2`} />
            <div className={`font-display font-bold text-[22px] leading-none ${t.cls}`}>{loading ? '—' : t.value}</div>
            <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide mt-1">{t.label}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
      ) : !sessions.length && !sheets.length ? (
        <div className="text-center py-16">
          <TrendingUp size={28} className="mx-auto mb-3 text-stone-200" />
          <p className="font-mono text-[12px] text-stone-400">No data in this range</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Hours worked per day" subtitle="Confirmed operator timesheets">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={perDay} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} width={32} />
                <Tooltip formatter={(v: any) => [`${v} h`, 'Hours']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E4E7EC' }} />
                <Bar dataKey="hours" fill="#1A3A0E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="kg bagged out per day" subtitle="From mass balance">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={perDay} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="kgGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2A7CB8" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#2A7CB8" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}t` : `${v}`} />
                <Tooltip formatter={(v: any) => [`${Number(v).toLocaleString()} kg`, 'Out']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E4E7EC' }} />
                <Area type="monotone" dataKey="kg" stroke="#2A7CB8" strokeWidth={2} fill="url(#kgGrad)" dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Hours by operator" subtitle="Top 8 in range">
            <ResponsiveContainer width="100%" height={Math.max(200, byOperator.length * 38)}>
              <BarChart data={byOperator} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={AXIS} axisLine={false} tickLine={false} width={110} />
                <Tooltip formatter={(v: any) => [`${v} h`, 'Hours']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E4E7EC' }} />
                <Bar dataKey="hours" fill="#1A3A0E" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="kg out by section" subtitle="In range">
            <ResponsiveContainer width="100%" height={Math.max(200, bySection.length * 40)}>
              <BarChart data={bySection} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}t` : `${v}`} />
                <YAxis type="category" dataKey="name" tick={AXIS} axisLine={false} tickLine={false} width={90} />
                <Tooltip formatter={(v: any) => [`${Number(v).toLocaleString()} kg`, 'Out']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E4E7EC' }} />
                <Bar dataKey="kg" radius={[0, 4, 4, 0]}>
                  {bySection.map(s => <Cell key={s.id} fill={s.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </div>
  )
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl p-4">
      <div className="font-display font-semibold text-[13px] text-text">{title}</div>
      {subtitle && <div className="text-[11px] text-text-muted mb-3">{subtitle}</div>}
      {children}
    </div>
  )
}
