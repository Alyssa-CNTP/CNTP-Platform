'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO, startOfWeek, endOfWeek } from 'date-fns'
import {
  Clock, Users, CalendarRange, Coffee, Timer, ChevronDown, ChevronRight,
  Download, Loader2, Filter, ArrowUpDown,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { sectionMeta, SECTION_ORDER } from '@/lib/production/capture-config'
import { SHIFT_LABEL } from '@/lib/production/shifts'
import type { TimesheetBreak } from '@/lib/production/timesheet'
import { downloadCsv } from '@/lib/utils/csv-export'
import { HubHeader } from '@/components/supervisor/HubTabs'

interface Row {
  id:             string
  session_id:     string
  operator_name:  string
  section_id:     string
  date:           string
  shift:          string
  shift_start:    string | null
  shift_end:      string | null
  breaks:         TimesheetBreak[]
  worked_minutes: number | null
}

const todayStr = () => format(new Date(), 'yyyy-MM-dd')
const timeOf = (iso: string | null) => { if (!iso) return '—'; try { return format(parseISO(iso), 'HH:mm') } catch { return '—' } }
const hrsLabel = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}h ${m}m` : `${m}m` }
const breakMins = (bs: TimesheetBreak[]) =>
  (bs ?? []).reduce((s, b) => { const d = (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000; return s + (Number.isFinite(d) && d > 0 ? d : 0) }, 0)

export default function SupervisorTimesheets() {
  const { p } = useAuth()
  const canExport = p('can_export_csv')

  const [start, setStart] = useState(() => format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'))
  const [end, setEnd]     = useState(todayStr)
  const [section, setSection]   = useState<string>('all')
  const [operator, setOperator] = useState<string>('all')
  const [shift, setShift]       = useState<string>('all')
  const [view, setView]         = useState<'operator' | 'flat'>('operator')

  const [rows, setRows]     = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      const { data } = await getDb().schema('production').from('prod_timesheets')
        .select('id,session_id,operator_name,section_id,date,shift,shift_start,shift_end,breaks,worked_minutes')
        .eq('confirmed', true).gte('date', start).lte('date', end)
        .order('date', { ascending: false })
      if (!alive) return
      setRows((data as Row[]) ?? [])
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [start, end])

  // Operator options come from the loaded data (only those with timesheets in range).
  const operatorOptions = useMemo(
    () => Array.from(new Set(rows.map(r => r.operator_name))).sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  const filtered = useMemo(() => rows.filter(r =>
    (section === 'all' || r.section_id === section) &&
    (operator === 'all' || r.operator_name === operator) &&
    (shift === 'all' || r.shift === shift),
  ), [rows, section, operator, shift])

  const kpis = useMemo(() => {
    const opSet = new Set(filtered.map(r => r.operator_name))
    const totalMin = filtered.reduce((s, r) => s + (r.worked_minutes ?? 0), 0)
    const totalBreak = filtered.reduce((s, r) => s + breakMins(r.breaks), 0)
    const shifts = filtered.length
    return {
      operators: opSet.size,
      totalMin,
      shifts,
      avgMin: shifts ? Math.round(totalMin / shifts) : 0,
      breakMin: Math.round(totalBreak),
    }
  }, [filtered])

  // By-operator grouping with per-operator totals.
  const byOperator = useMemo(() => {
    const m = new Map<string, Row[]>()
    filtered.forEach(r => { const a = m.get(r.operator_name) ?? []; a.push(r); m.set(r.operator_name, a) })
    return Array.from(m.entries())
      .map(([name, list]) => ({
        name,
        list: list.sort((a, b) => b.date.localeCompare(a.date) || a.shift.localeCompare(b.shift)),
        totalMin: list.reduce((s, r) => s + (r.worked_minutes ?? 0), 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered])

  const flat = useMemo(
    () => [...filtered].sort((a, b) => b.date.localeCompare(a.date) || a.operator_name.localeCompare(b.operator_name)),
    [filtered],
  )

  function toggle(id: string) {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function exportCsv() {
    downloadCsv(flat, [
      { header: 'Operator', value: r => r.operator_name },
      { header: 'Date',     value: r => r.date },
      { header: 'Shift',    value: r => SHIFT_LABEL[r.shift as keyof typeof SHIFT_LABEL] ?? r.shift },
      { header: 'Section',  value: r => sectionMeta(r.section_id).name },
      { header: 'Start',    value: r => timeOf(r.shift_start) },
      { header: 'End',      value: r => timeOf(r.shift_end) },
      { header: 'Worked (h)', value: r => ((r.worked_minutes ?? 0) / 60).toFixed(2) },
      { header: 'Worked (min)', value: r => r.worked_minutes ?? 0 },
      { header: 'Breaks',   value: r => (r.breaks ?? []).length },
      { header: 'Break (min)', value: r => Math.round(breakMins(r.breaks)) },
    ], `timesheets_${start}_to_${end}`)
  }

  function setPreset(kind: 'today' | 'week') {
    if (kind === 'today') { setStart(todayStr()); setEnd(todayStr()) }
    else { setStart(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')); setEnd(format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')) }
  }

  const tiles = [
    { label: 'Operators', value: String(kpis.operators), icon: Users, cls: 'text-text' },
    { label: 'Total hours', value: hrsLabel(kpis.totalMin), icon: Clock, cls: 'text-brand' },
    { label: 'Shifts', value: String(kpis.shifts), icon: CalendarRange, cls: 'text-text' },
    { label: 'Avg shift', value: hrsLabel(kpis.avgMin), icon: Timer, cls: 'text-text' },
    { label: 'Break time', value: hrsLabel(kpis.breakMin), icon: Coffee, cls: 'text-text-muted' },
  ]

  const PILL = 'px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors'
  const SEL  = 'px-3 py-2 rounded-lg border border-stone-200 bg-white text-[12px] outline-none focus:border-brand cursor-pointer'

  return (
    <div className="px-4 py-6 max-w-[1000px] mx-auto space-y-5">
      <HubHeader subtitle="Operator hours, derived from capture activity" />

      {/* Date range + presets */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          <button onClick={() => setPreset('today')} className={`${PILL} ${start === todayStr() && end === todayStr() ? 'bg-brand text-white border-brand' : 'bg-white border-stone-200 text-stone-500 hover:border-brand'}`}>Today</button>
          <button onClick={() => setPreset('week')} className={`${PILL} bg-white border-stone-200 text-stone-500 hover:border-brand`}>This week</button>
        </div>
        <input type="date" value={start} onChange={e => setStart(e.target.value)} className="px-3 py-2 rounded-lg border border-stone-200 text-[12px] font-mono outline-none focus:border-brand" />
        <span className="text-[12px] text-stone-400">→</span>
        <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="px-3 py-2 rounded-lg border border-stone-200 text-[12px] font-mono outline-none focus:border-brand" />
        <div className="flex-1" />
        {canExport && (
          <button onClick={exportCsv} disabled={!flat.length}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 text-[12px] text-stone-600 hover:border-brand hover:text-brand disabled:opacity-40 transition-colors">
            <Download size={13} /> Export CSV
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={13} className="text-stone-400" />
        <select value={section} onChange={e => setSection(e.target.value)} className={SEL}>
          <option value="all">All sections</option>
          {SECTION_ORDER.map(s => <option key={s} value={s}>{sectionMeta(s).name}</option>)}
        </select>
        <select value={operator} onChange={e => setOperator(e.target.value)} className={SEL}>
          <option value="all">All operators</option>
          {operatorOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={shift} onChange={e => setShift(e.target.value)} className={SEL}>
          <option value="all">All shifts</option>
          {Object.entries(SHIFT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="flex-1" />
        <div className="flex gap-1 p-1 bg-stone-100 rounded-lg">
          {(['operator', 'flat'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${view === v ? 'bg-white text-brand shadow-sm' : 'text-stone-500'}`}>
              {v === 'operator' ? 'By operator' : 'All shifts'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {tiles.map(t => (
          <div key={t.label} className="bg-surface-card border border-surface-rule rounded-xl p-4">
            <t.icon size={14} className={`${t.cls} mb-2`} />
            <div className={`font-display font-bold text-[22px] leading-none ${t.cls}`}>{loading ? '—' : t.value}</div>
            <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide mt-1">{t.label}</div>
          </div>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
      ) : !filtered.length ? (
        <div className="text-center py-16">
          <Clock size={28} className="mx-auto mb-3 text-stone-200" />
          <p className="font-mono text-[12px] text-stone-400">No confirmed timesheets in this range</p>
          <p className="text-[11px] text-stone-400 mt-1">Operators confirm their timesheet at sign-off; sessions before 13 Jun 2026 have none.</p>
        </div>
      ) : view === 'operator' ? (
        <div className="space-y-3">
          {byOperator.map(op => (
            <div key={op.name} className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-surface-rule bg-surface">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-brand/10 text-brand flex items-center justify-center font-display font-bold text-[12px]">
                    {op.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <span className="font-body font-semibold text-[14px] text-text">{op.name}</span>
                  <span className="text-[11px] text-text-muted">· {op.list.length} shift{op.list.length !== 1 ? 's' : ''}</span>
                </div>
                <span className="font-mono font-bold text-[14px] text-brand">{hrsLabel(op.totalMin)}</span>
              </div>
              <div className="divide-y divide-surface-rule">
                {op.list.map(r => <ShiftRow key={r.id} r={r} expanded={expanded.has(r.id)} onToggle={() => toggle(r.id)} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-rule bg-surface font-mono text-[10px] text-text-muted uppercase tracking-wide">
            <ArrowUpDown size={11} /> {flat.length} shift{flat.length !== 1 ? 's' : ''} · newest first
          </div>
          <div className="divide-y divide-surface-rule">
            {flat.map(r => <ShiftRow key={r.id} r={r} showOperator expanded={expanded.has(r.id)} onToggle={() => toggle(r.id)} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function ShiftRow({ r, showOperator, expanded, onToggle }: { r: Row; showOperator?: boolean; expanded: boolean; onToggle: () => void }) {
  const m = sectionMeta(r.section_id)
  const bks = r.breaks ?? []
  const href = `/production/capture/${r.section_id}?date=${r.date}&shift=${r.shift}`
  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-surface transition-colors">
        <button onClick={onToggle} className="text-stone-300 hover:text-stone-600 shrink-0">
          {bks.length ? (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : <span className="inline-block w-[15px]" />}
        </button>
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
          <span className="font-mono font-bold text-[8px] text-white">{m.code}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {showOperator && <span className="font-body font-medium text-[13px] text-text">{r.operator_name}</span>}
            <span className={`text-[13px] ${showOperator ? 'text-text-muted' : 'text-text font-medium'}`}>{m.name}</span>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 capitalize">{r.shift}</span>
          </div>
          <div className="font-mono text-[11px] text-text-muted mt-0.5">{format(parseISO(r.date + 'T12:00:00'), 'EEE d MMM')}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-[12px] text-text">{timeOf(r.shift_start)}–{timeOf(r.shift_end)}</div>
          <div className="font-mono font-bold text-[12px] text-brand">{hrsLabel(r.worked_minutes ?? 0)}</div>
        </div>
        <Link href={href} className="text-text-muted hover:text-brand shrink-0"><ChevronRight size={15} /></Link>
      </div>
      {expanded && bks.length > 0 && (
        <div className="px-12 pb-3 flex flex-wrap gap-1.5">
          {bks.map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-stone-100 text-stone-600 capitalize">
              <Coffee size={11} /> {b.type} · {timeOf(b.start)}–{timeOf(b.end)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
