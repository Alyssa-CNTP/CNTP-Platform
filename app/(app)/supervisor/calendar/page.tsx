'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO, startOfWeek, addDays, isToday } from 'date-fns'
import {
  ChevronLeft, ChevronRight, HardHat, Loader2, Plus, Users,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { sectionMeta, SECTION_ORDER } from '@/lib/production/capture-config'
import { SHIFT_LABEL } from '@/lib/production/shifts'
import { HubTabs } from '@/components/supervisor/HubTabs'
import type { Shift } from '@/lib/supabase/database.types'

interface Assignment {
  date: string; shift: string; section_id: string
  operator_ids: string[] | null; variant: string | null; lot_number: string | null
}
interface DutySlot { technician: string; start_at: string; end_at: string }

const SHIFTS: Shift[] = ['morning', 'afternoon', 'night']
const SHIFT_DOT: Record<string, string> = { morning: 'bg-amber-400', afternoon: 'bg-sky-400', night: 'bg-indigo-400' }
const fmtDay = (d: Date) => format(d, 'yyyy-MM-dd')

export default function ShiftCalendar() {
  const router = useRouter()
  const [view, setView]   = useState<'week' | 'day'>('week')
  const [anchor, setAnchor] = useState(() => new Date())

  const [ops, setOps]         = useState<Map<string, string>>(new Map())
  const [assigns, setAssigns] = useState<Assignment[]>([])
  const [duty, setDuty]       = useState<DutySlot[]>([])
  const [loading, setLoading] = useState(true)

  // The visible date range: a Mon–Sun week, or a single day.
  const weekStart = useMemo(() => startOfWeek(anchor, { weekStartsOn: 1 }), [anchor])
  const days = useMemo(() =>
    view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [anchor],
  [view, weekStart, anchor])
  const rangeStart = fmtDay(days[0])
  const rangeEnd   = fmtDay(days[days.length - 1])

  // Operators once.
  useEffect(() => {
    getDb().schema('production').from('operators').select('id,name,display_name')
      .then(({ data }: any) => setOps(new Map(((data as any[]) ?? []).map(o => [o.id, o.display_name || o.name]))))
  }, [])

  // Assignments + duty roster for the visible range.
  useEffect(() => {
    let alive = true
    setLoading(true)
    const db = getDb()
    Promise.all([
      db.schema('production').from('shift_assignments')
        .select('date,shift,section_id,operator_ids,variant,lot_number')
        .gte('date', rangeStart).lte('date', rangeEnd),
      db.schema('maintenance').from('duty_roster').select('technician,start_at,end_at')
        .lte('start_at', `${rangeEnd}T23:59:59`).gte('end_at', `${rangeStart}T00:00:00`),
    ]).then(([a, d]) => {
      if (!alive) return
      setAssigns((a.data as Assignment[]) ?? [])
      setDuty((d.data as DutySlot[]) ?? [])
      setLoading(false)
    })
    return () => { alive = false }
  }, [rangeStart, rangeEnd])

  const opNames = (ids: string[] | null) => (ids ?? []).map(id => ops.get(id) ?? '?')
  const initials = (name: string) => name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  function assignmentsFor(sectionId: string, dateStr: string) {
    return assigns.filter(a => a.section_id === sectionId && a.date === dateStr)
  }
  function dutyForDay(dateStr: string): string[] {
    const ds = `${dateStr}T00:00:00`, de = `${dateStr}T23:59:59`
    return Array.from(new Set(duty.filter(s => s.start_at <= de && s.end_at >= ds).map(s => s.technician)))
  }
  function goAssign(dateStr: string, shift: string) {
    router.push(`/production/capture/assign?date=${dateStr}&shift=${shift}`)
  }

  const step = (dir: -1 | 1) => setAnchor(a => addDays(a, dir * (view === 'week' ? 7 : 1)))

  return (
    <div className="px-4 py-6 max-w-[1100px] mx-auto space-y-5">
      <div>
        <h1 className="font-display font-bold text-[22px] text-text">Supervisor Hub</h1>
        <p className="text-[12px] text-stone-400 mt-0.5">Master shift calendar — who's rostered, and the technician on duty</p>
      </div>
      <HubTabs />

      {/* Nav + view toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => step(-1)} className="p-2 rounded-lg border border-stone-200 text-stone-500 hover:border-brand hover:text-brand"><ChevronLeft size={15} /></button>
        <button onClick={() => setAnchor(new Date())} className="px-3 py-2 rounded-lg border border-stone-200 text-[12px] font-medium text-stone-600 hover:border-brand hover:text-brand">Today</button>
        <button onClick={() => step(1)} className="p-2 rounded-lg border border-stone-200 text-stone-500 hover:border-brand hover:text-brand"><ChevronRight size={15} /></button>
        <span className="font-display font-semibold text-[14px] text-text ml-1">
          {view === 'week'
            ? `${format(days[0], 'd MMM')} – ${format(days[6], 'd MMM yyyy')}`
            : format(anchor, 'EEEE d MMM yyyy')}
        </span>
        <div className="flex-1" />
        <div className="flex gap-1 p-1 bg-stone-100 rounded-lg">
          {(['week', 'day'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium capitalize transition-colors ${view === v ? 'bg-white text-brand shadow-sm' : 'text-stone-500'}`}>{v}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
      ) : view === 'week' ? (
        <WeekGrid days={days} dutyForDay={dutyForDay} assignmentsFor={assignmentsFor} opNames={opNames} initials={initials} goAssign={goAssign} />
      ) : (
        <DayBoard date={anchor} dutyForDay={dutyForDay} assignmentsFor={assignmentsFor} opNames={opNames} goAssign={goAssign} />
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-[11px] text-text-muted">
        <span className="font-medium">Shifts:</span>
        {SHIFTS.map(s => (
          <span key={s} className="inline-flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full ${SHIFT_DOT[s]}`} /> {SHIFT_LABEL[s]}</span>
        ))}
        <span className="inline-flex items-center gap-1.5 ml-2"><HardHat size={12} /> Technician on duty</span>
      </div>
    </div>
  )
}

// ── Week grid: sections (rows) × days (columns), shift chips per cell ──────────
function WeekGrid({ days, dutyForDay, assignmentsFor, opNames, initials, goAssign }: {
  days: Date[]
  dutyForDay: (d: string) => string[]
  assignmentsFor: (s: string, d: string) => Assignment[]
  opNames: (ids: string[] | null) => string[]
  initials: (n: string) => string
  goAssign: (d: string, s: string) => void
}) {
  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-x-auto">
      <table className="w-full border-collapse min-w-[820px]">
        <thead>
          <tr className="border-b border-surface-rule bg-surface">
            <th className="px-3 py-2.5 text-left font-mono text-[10px] text-text-muted uppercase tracking-wide w-[120px] sticky left-0 bg-surface z-10">Section</th>
            {days.map(d => {
              const ds = fmtDay(d), techs = dutyForDay(ds), today = isToday(d)
              return (
                <th key={ds} className={`px-2 py-2 text-left align-top ${today ? 'bg-brand/5' : ''}`}>
                  <div className={`font-display font-bold text-[12px] ${today ? 'text-brand' : 'text-text'}`}>{format(d, 'EEE')}</div>
                  <div className="font-mono text-[10px] text-text-muted">{format(d, 'd MMM')}</div>
                  {techs.length > 0 && (
                    <div className="mt-1 inline-flex items-center gap-1 text-[9px] text-text-muted bg-stone-100 rounded-full px-1.5 py-0.5" title={`On duty: ${techs.join(', ')}`}>
                      <HardHat size={9} /> {techs.map(t => t.split(' ')[0]).join(', ')}
                    </div>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-rule">
          {SECTION_ORDER.map(sectionId => {
            const m = sectionMeta(sectionId)
            return (
              <tr key={sectionId}>
                <td className="px-3 py-2 sticky left-0 bg-surface-card z-10 border-r border-surface-rule">
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
                      <span className="font-mono font-bold text-[7px] text-white">{m.code}</span>
                    </span>
                    <span className="font-body font-medium text-[11px] text-text leading-tight">{m.name}</span>
                  </div>
                </td>
                {days.map(d => {
                  const ds = fmtDay(d)
                  const dayAssigns = assignmentsFor(sectionId, ds)
                  return (
                    <td key={ds} className={`px-1.5 py-1.5 align-top ${isToday(d) ? 'bg-brand/[0.03]' : ''}`}>
                      <div className="space-y-1">
                        {SHIFTS.map(sh => {
                          const a = dayAssigns.find(x => x.shift === sh)
                          if (!a || !(a.operator_ids ?? []).length) return null
                          const names = opNames(a.operator_ids)
                          return (
                            <button key={sh} onClick={() => goAssign(ds, sh)}
                              title={`${SHIFT_LABEL[sh]} · ${names.join(', ')}${a.variant ? ` · ${a.variant}` : ''}`}
                              className="w-full flex items-center gap-1 px-1.5 py-1 rounded-md bg-stone-50 hover:bg-stone-100 border border-stone-100 text-left transition-colors">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SHIFT_DOT[sh]}`} />
                              <span className="font-mono text-[9px] text-text-muted">{sh[0].toUpperCase()}</span>
                              <span className="flex gap-0.5 flex-wrap">
                                {names.map((n, i) => (
                                  <span key={i} className="font-mono text-[9px] font-semibold text-text">{initials(n)}</span>
                                ))}
                              </span>
                            </button>
                          )
                        })}
                        {!dayAssigns.some(a => (a.operator_ids ?? []).length) && (
                          <button onClick={() => goAssign(ds, 'morning')}
                            className="w-full flex items-center justify-center py-1 rounded-md text-stone-200 hover:text-brand hover:bg-stone-50 transition-colors">
                            <Plus size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Day board: sections (rows) × shifts (columns), full operator names ─────────
function DayBoard({ date, dutyForDay, assignmentsFor, opNames, goAssign }: {
  date: Date
  dutyForDay: (d: string) => string[]
  assignmentsFor: (s: string, d: string) => Assignment[]
  opNames: (ids: string[] | null) => string[]
  goAssign: (d: string, s: string) => void
}) {
  const ds = fmtDay(date)
  const techs = dutyForDay(ds)
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-4 py-3 bg-surface-card border border-surface-rule rounded-2xl">
        <HardHat size={16} className={techs.length ? 'text-brand' : 'text-text-muted'} />
        <span className="text-[12px] text-text-muted">Technician on duty:</span>
        <span className="font-body font-semibold text-[13px] text-text">{techs.length ? techs.join(', ') : 'None rostered'}</span>
      </div>

      <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-x-auto">
        <table className="w-full border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b border-surface-rule bg-surface">
              <th className="px-4 py-2.5 text-left font-mono text-[10px] text-text-muted uppercase tracking-wide w-[160px]">Section</th>
              {SHIFTS.map(sh => (
                <th key={sh} className="px-4 py-2.5 text-left font-mono text-[10px] text-text-muted uppercase tracking-wide">
                  <span className={`inline-flex items-center gap-1.5`}><span className={`w-2 h-2 rounded-full ${SHIFT_DOT[sh]}`} /> {SHIFT_LABEL[sh]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-rule">
            {SECTION_ORDER.map(sectionId => {
              const m = sectionMeta(sectionId)
              const dayAssigns = assignmentsFor(sectionId, ds)
              return (
                <tr key={sectionId}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
                        <span className="font-mono font-bold text-[8px] text-white">{m.code}</span>
                      </span>
                      <span className="font-body font-medium text-[13px] text-text">{m.name}</span>
                    </div>
                  </td>
                  {SHIFTS.map(sh => {
                    const a = dayAssigns.find(x => x.shift === sh)
                    const names = a ? opNames(a.operator_ids) : []
                    return (
                      <td key={sh} className="px-4 py-3 align-top">
                        {names.length ? (
                          <button onClick={() => goAssign(ds, sh)} className="text-left group">
                            <div className="flex flex-wrap gap-1">
                              {names.map((n, i) => (
                                <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-brand/8 text-brand font-medium">
                                  <Users size={10} /> {n}
                                </span>
                              ))}
                            </div>
                            {(a?.variant || a?.lot_number) && (
                              <div className="font-mono text-[10px] text-text-muted mt-1">{[a?.variant, a?.lot_number].filter(Boolean).join(' · ')}</div>
                            )}
                          </button>
                        ) : (
                          <button onClick={() => goAssign(ds, sh)} className="inline-flex items-center gap-1 text-[11px] text-stone-300 hover:text-brand transition-colors">
                            <Plus size={12} /> Roster
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
