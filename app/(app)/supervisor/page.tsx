'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO, subDays, eachDayOfInterval } from 'date-fns'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Users, Clock, Factory, Wrench, HardHat, Scale, AlertTriangle,
  ChevronRight, RefreshCw, PenLine, CheckCircle2, Loader2, Pen, Play, Lock, ArrowRight,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { resolveOnDutyTechnician } from '@/lib/maintenance/roster'
import { currentShift, SHIFT_LABEL } from '@/lib/production/shifts'
import { sectionMeta, SECTION_ORDER, MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'
import type { Shift } from '@/lib/supabase/database.types'
import { HubHeader } from '@/components/supervisor/HubTabs'

const todayStr = () => format(new Date(), 'yyyy-MM-dd')
const hrsLabel = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}h ${m}m` : `${m}m` }
const AXIS = { fontSize: 11, fill: '#637056' }
const GRID = '#F0F2F5'

const LINE_STATUS: Record<string, { label: string; cls: string; dot: string; icon: any }> = {
  none:      { label: 'Not started',    cls: 'bg-stone-100 text-stone-500',  dot: 'bg-stone-300', icon: Play },
  draft:     { label: 'In progress',    cls: 'bg-warn/10 text-warn',         dot: 'bg-warn',      icon: Pen },
  submitted: { label: 'Awaiting sign-off', cls: 'bg-info/10 text-info',      dot: 'bg-info',      icon: Clock },
  approved:  { label: 'Signed off',     cls: 'bg-ok/10 text-ok',             dot: 'bg-ok',        icon: CheckCircle2 },
}

interface Sess { id: string; section_id: string; date: string; shift: string; status: string; operator_names: string[] | null }
interface MB   { session_id: string; total_input_kg: number; total_output_b_kg: number; total_output_c_kg: number; total_output_d_kg: number }
interface Sheet { date: string; worked_minutes: number | null }

interface Pending { id: string; section_id: string; date: string; shift: string; operators: string[]; submitted_at: string | null }

interface Line { sectionId: string; status: string; operators: string[]; kg: number }

export default function SupervisorOverview() {
  const today = todayStr()
  const shift = currentShift()
  const start7 = format(subDays(new Date(), 6), 'yyyy-MM-dd')

  const [sess, setSess]   = useState<Sess[]>([])
  const [mb, setMb]       = useState<Map<string, MB>>(new Map())
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [opMap, setOpMap] = useState<Record<string, string>>({})
  const [roster, setRoster] = useState<{ section_id: string; operator_ids: string[] }[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [breakdowns, setBreakdowns] = useState(0)
  const [dutyTech, setDutyTech] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const db = getDb()
    const [assigns, sess7, sheets7, bd, duty, submitted, ops] = await Promise.all([
      db.schema('production').from('shift_assignments').select('section_id,operator_ids').eq('date', today).eq('shift', shift),
      db.schema('production').from('prod_sessions').select('id,section_id,date,shift,status,operator_names').gte('date', start7).lte('date', today),
      db.schema('production').from('prod_timesheets').select('date,worked_minutes').eq('confirmed', true).gte('date', start7).lte('date', today),
      db.schema('maintenance').from('job_cards').select('id').eq('workflow', 'breakdown').neq('status', 'complete'),
      resolveOnDutyTechnician(db as any),
      db.schema('production').from('prod_sessions')
        .select('id,section_id,date,shift,operator_names,submitted_at')
        .eq('status', 'submitted').order('submitted_at', { ascending: true }),
      db.schema('production').from('operators').select('id,name,display_name').eq('active', true),
    ])

    const sessRows = (sess7.data as Sess[]) ?? []
    let mbRows: MB[] = []
    if (sessRows.length) {
      const { data } = await db.schema('production').from('prod_mass_balance')
        .select('session_id,total_input_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg')
        .in('session_id', sessRows.map(s => s.id))
      mbRows = (data as MB[]) ?? []
    }

    const m: Record<string, string> = {}
    ;((ops.data as any[]) ?? []).forEach(o => { m[o.id] = o.display_name || o.name })

    setSess(sessRows)
    setMb(new Map(mbRows.map(r => [r.session_id, r])))
    setSheets((sheets7.data as Sheet[]) ?? [])
    setOpMap(m)
    setRoster(((assigns.data as any[]) ?? []).map(a => ({ section_id: a.section_id, operator_ids: a.operator_ids ?? [] })))
    setPending(((submitted.data as any[]) ?? []).map(s => ({
      id: s.id, section_id: s.section_id, date: s.date, shift: s.shift,
      operators: s.operator_names ?? [], submitted_at: s.submitted_at,
    })))
    setBreakdowns(((bd.data as any[]) ?? []).length)
    setDutyTech(duty?.name ?? null)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const kgOut = (s: Sess) => { const r = mb.get(s.id); return r ? (Number(r.total_output_b_kg) || 0) + (Number(r.total_output_c_kg) || 0) + (Number(r.total_output_d_kg) || 0) : 0 }

  // Today only, derived from the 7-day pull.
  const todaySess = useMemo(() => sess.filter(s => s.date === today), [sess, today])

  const kpis = useMemo(() => {
    const operators = new Set<string>()
    roster.forEach(r => r.operator_ids.forEach(id => operators.add(id)))
    const kg = todaySess.reduce((sum, s) => sum + kgOut(s), 0)
    const hoursMin = sheets.filter(s => s.date === today).reduce((sum, s) => sum + (s.worked_minutes ?? 0), 0)
    const signedOff = todaySess.filter(s => s.status === 'approved').length
    return { productions: todaySess.length, kg: Math.round(kg), hoursMin, operators: operators.size, signedOff }
  }, [todaySess, roster, sheets, mb, today])

  // Live status of every line rostered for this shift.
  const lines: Line[] = useMemo(() => {
    return roster
      .slice()
      .sort((a, b) => SECTION_ORDER.indexOf(a.section_id as any) - SECTION_ORDER.indexOf(b.section_id as any))
      .map(r => {
        const s = todaySess.find(x => x.section_id === r.section_id && x.shift === shift)
        return {
          sectionId: r.section_id,
          status: s?.status ?? 'none',
          operators: r.operator_ids.map(id => opMap[id] ?? '—'),
          kg: s ? Math.round(kgOut(s)) : 0,
        }
      })
  }, [roster, todaySess, opMap, shift, mb])

  // 7-day trend — continuous day axis, gaps filled with zeros.
  const trend = useMemo(() => {
    const kgByDay = new Map<string, number>(), minByDay = new Map<string, number>()
    sess.forEach(s => kgByDay.set(s.date, (kgByDay.get(s.date) ?? 0) + kgOut(s)))
    sheets.forEach(s => minByDay.set(s.date, (minByDay.get(s.date) ?? 0) + (s.worked_minutes ?? 0)))
    let days: string[] = []
    try { days = eachDayOfInterval({ start: parseISO(start7), end: parseISO(today) }).map(d => format(d, 'yyyy-MM-dd')) } catch { days = [] }
    return days.map(d => ({
      day: format(parseISO(d), 'EEE'),
      kg: Math.round(kgByDay.get(d) ?? 0),
      hours: +((minByDay.get(d) ?? 0) / 60).toFixed(1),
    }))
  }, [sess, sheets, mb, start7, today])

  const v = (n: string | number) => loading ? '—' : String(n)
  const kpiTiles = [
    { label: 'Pending sign-off', value: v(pending.length), icon: PenLine, cls: pending.length ? 'text-info' : 'text-text-muted', href: undefined },
    { label: 'Operators on shift', value: v(kpis.operators), icon: Users, cls: 'text-text' },
    { label: 'Productions today', value: v(kpis.productions), icon: Factory, cls: 'text-text' },
    { label: 'kg out today', value: loading ? '—' : kpis.kg.toLocaleString(), icon: Scale, cls: 'text-brand' },
    { label: 'Hours logged', value: loading ? '—' : hrsLabel(kpis.hoursMin), icon: Clock, cls: 'text-text' },
    { label: 'Open breakdowns', value: v(breakdowns), icon: Wrench, cls: breakdowns ? 'text-warn' : 'text-text-muted' },
    { label: 'Tech on duty', value: loading ? '—' : (dutyTech ?? 'None'), icon: HardHat, cls: dutyTech ? 'text-text' : 'text-text-muted', small: true },
  ]

  return (
    <div className="px-4 py-6 max-w-[1100px] mx-auto space-y-5">
      <HubHeader
        subtitle={`${format(new Date(), 'EEEE d MMM')} · ${SHIFT_LABEL[shift]} shift`}
        action={
          <button onClick={load} className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {kpiTiles.map(t => (
          <div key={t.label} className="bg-surface-card border border-surface-rule rounded-xl p-3.5">
            <t.icon size={14} className={`${t.cls} mb-2`} />
            <div className={`font-display font-bold leading-none ${t.cls} ${(t as any).small ? 'text-[14px]' : 'text-[22px]'}`}>{t.value}</div>
            <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide mt-1">{t.label}</div>
          </div>
        ))}
      </div>

      {/* Live shift + approvals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ShiftLines lines={lines} loading={loading} shift={shift} today={today} signedOff={kpis.signedOff} />
        </div>
        <div>
          <SignOffQueue pending={pending} loading={loading} />
        </div>
      </div>

      {/* Trends */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-bold text-[13px] text-text-muted uppercase tracking-wide">Last 7 days</h3>
          <Link href="/supervisor/analytics" className="flex items-center gap-1 text-[11px] font-medium text-brand hover:underline">
            Full analytics <ArrowRight size={12} />
          </Link>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="kg bagged out" subtitle="From mass balance">
            {loading ? <ChartLoading /> : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="ovKg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2A7CB8" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#2A7CB8" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} tickFormatter={(x: number) => x >= 1000 ? `${(x / 1000).toFixed(0)}t` : `${x}`} />
                  <Tooltip formatter={(x: any) => [`${Number(x).toLocaleString()} kg`, 'Out']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E4E7EC' }} />
                  <Area type="monotone" dataKey="kg" stroke="#2A7CB8" strokeWidth={2} fill="url(#ovKg)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
          <ChartCard title="Hours worked" subtitle="Confirmed timesheets">
            {loading ? <ChartLoading /> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={32} />
                  <Tooltip formatter={(x: any) => [`${x} h`, 'Hours']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E4E7EC' }} />
                  <Bar dataKey="hours" fill="#1A3A0E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  )
}

// ── Live shift lines ───────────────────────────────────────────────────────────
function ShiftLines({ lines, loading, shift, today, signedOff }: { lines: Line[]; loading: boolean; shift: Shift; today: string; signedOff: number }) {
  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-rule bg-surface">
        <div className="flex items-center gap-2">
          <Factory size={15} className="text-text-muted" />
          <span className="font-display font-bold text-[14px] text-text">Lines this shift</span>
        </div>
        {!loading && lines.length > 0 && (
          <span className="font-mono text-[11px] text-text-muted">{signedOff}/{lines.length} signed off</span>
        )}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-stone-300" /></div>
      ) : !lines.length ? (
        <div className="text-center py-14 px-4">
          <Factory size={24} className="mx-auto mb-3 text-stone-200" />
          <p className="font-mono text-[12px] text-stone-400">No sections rostered for the {SHIFT_LABEL[shift]} shift</p>
          <Link href="/production/capture/assign" className="text-[12px] text-brand hover:underline mt-1 inline-block">Assign sections →</Link>
        </div>
      ) : (
        <div className="divide-y divide-surface-rule">
          {lines.map(l => {
            const m = sectionMeta(l.sectionId)
            const st = LINE_STATUS[l.status] ?? LINE_STATUS.none
            const Icon = st.icon
            const href = `/production/capture/${l.sectionId}?date=${today}&shift=${shift}${l.status === 'submitted' ? '&tab=signoff' : ''}`
            return (
              <Link key={l.sectionId} href={href}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface transition-colors group">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
                  <span className="font-mono font-bold text-[10px] text-white">{m.code}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-body font-semibold text-[14px] text-text truncate">{m.name}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-text-muted font-mono truncate">
                    <Users size={11} className="shrink-0" /> {l.operators.join(', ') || 'No operators'}
                  </div>
                </div>
                {l.kg > 0 && (
                  <div className="text-right shrink-0 hidden sm:block">
                    <div className="font-mono text-[12px] text-text">{l.kg.toLocaleString()}</div>
                    <div className="font-mono text-[9px] text-text-muted uppercase">kg out</div>
                  </div>
                )}
                <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg shrink-0 ${st.cls}`}>
                  <Icon size={11} /> {st.label}
                </span>
                <ChevronRight size={15} className="text-stone-300 group-hover:text-brand transition-colors shrink-0" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Pending sign-off queue ─────────────────────────────────────────────────────
function SignOffQueue({ pending, loading }: { pending: Pending[]; loading: boolean }) {
  if (loading) {
    return <div className="bg-surface-card border border-surface-rule rounded-2xl p-6 flex items-center justify-center h-full"><Loader2 size={18} className="animate-spin text-stone-300" /></div>
  }
  if (!pending.length) {
    return (
      <div className="flex flex-col items-center justify-center text-center gap-2 bg-ok/5 border border-ok/25 rounded-2xl p-6 h-full">
        <CheckCircle2 size={22} className="text-ok" />
        <div className="font-body font-semibold text-[14px] text-text">All caught up</div>
        <div className="text-[12px] text-text-muted">Nothing waiting for your sign-off.</div>
      </div>
    )
  }
  return (
    <div className="bg-info/5 border border-info/30 rounded-2xl overflow-hidden h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-info/20">
        <span className="w-6 h-6 rounded-full bg-info text-white flex items-center justify-center font-display font-bold text-[12px] shrink-0">{pending.length}</span>
        <PenLine size={15} className="text-info" />
        <span className="font-body font-semibold text-[14px] text-info">Needs your sign-off</span>
      </div>
      <div className="divide-y divide-info/15 max-h-[340px] overflow-y-auto">
        {pending.map(s => {
          const m = sectionMeta(s.section_id)
          const href = `/production/capture/${s.section_id}?date=${s.date}&shift=${s.shift}&tab=signoff`
          return (
            <Link key={s.id} href={href} className="flex items-center gap-3 px-4 py-3 bg-white/40 hover:bg-white transition-colors group">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
                <span className="font-mono font-bold text-[9px] text-white">{m.code}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-body font-semibold text-[13px] text-text truncate">{m.name}</div>
                <div className="font-mono text-[10px] text-text-muted truncate">
                  {format(parseISO(s.date + 'T12:00:00'), 'EEE d MMM')} · {s.shift}
                  {s.operators.length ? ` · ${s.operators.join(', ')}` : ''}
                </div>
              </div>
              <ChevronRight size={15} className="text-info shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          )
        })}
      </div>
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

function ChartLoading() {
  return <div className="flex items-center justify-center" style={{ height: 200 }}><Loader2 size={20} className="animate-spin text-stone-300" /></div>
}
