'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO, startOfWeek, addDays, isToday } from 'date-fns'
import {
  ChevronLeft, ChevronRight, HardHat, Loader2, Plus, Users, Sun, Moon, X, Pencil,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { sectionMeta, SECTION_ORDER } from '@/lib/production/capture-config'
import { HubHeader } from '@/components/supervisor/HubTabs'

interface Assignment {
  date: string; shift: string; section_id: string
  operator_ids: string[] | null; variant: string | null; lot_number: string | null
}
interface DutySlot { technician: string; start_at: string; end_at: string }

// The calendar standardises on the Shift Roster's two shifts (Day / Night) so the
// whole app reads the same way. Capture stores the same two shifts: 'morning'
// (07h00–16h00 = Day) and 'afternoon' (16h00–01h00 = Night; 'night' is a legacy
// alias). Rostering the Night column writes capture shift 'afternoon'.
type RosterShift = 'day' | 'night'
const SHIFT_VIEW: Record<RosterShift, { label: string; time: string; icon: typeof Sun; dot: string; chip: string; text: string }> = {
  day:   { label: 'Day Shift',   time: '07h00–16h00', icon: Sun,  dot: 'bg-amber-400',  chip: 'bg-amber-50 border-amber-200',   text: 'text-amber-600' },
  night: { label: 'Night Shift', time: '16h00–01h00', icon: Moon, dot: 'bg-indigo-400', chip: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-600' },
}
const ROSTER_SHIFTS: RosterShift[] = ['day', 'night']
const toRoster = (s: string): RosterShift => (s === 'night' || s === 'afternoon' ? 'night' : 'day')
const fmtDay = (d: Date) => format(d, 'yyyy-MM-dd')

interface SectionRoster { sectionId: string; operatorIds: string[]; variant: string | null; lot: string | null }

export default function ShiftCalendar() {
  const router = useRouter()
  const [view, setView]   = useState<'week' | 'day'>('week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [modalDate, setModalDate] = useState<string | null>(null)

  const [ops, setOps]         = useState<Map<string, string>>(new Map())
  const [assigns, setAssigns] = useState<Assignment[]>([])
  const [duty, setDuty]       = useState<DutySlot[]>([])
  const [loading, setLoading] = useState(true)

  const weekStart = useMemo(() => startOfWeek(anchor, { weekStartsOn: 1 }), [anchor])
  const days = useMemo(() =>
    view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [anchor],
  [view, weekStart, anchor])
  const rangeStart = fmtDay(days[0])
  const rangeEnd   = fmtDay(days[days.length - 1])

  useEffect(() => {
    getDb().schema('production').from('operators').select('id,name,display_name')
      .then(({ data }: any) => setOps(new Map(((data as any[]) ?? []).map(o => [o.id, o.display_name || o.name]))))
  }, [])

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

  function dutyForDay(dateStr: string): string[] {
    const ds = `${dateStr}T00:00:00`, de = `${dateStr}T23:59:59`
    return Array.from(new Set(duty.filter(s => s.start_at <= de && s.end_at >= ds).map(s => s.technician)))
  }

  // Day's assignments grouped into Day/Night, then merged per section (morning +
  // afternoon operators combined, deduped) so each line is one section.
  function rosterFor(dateStr: string, shift: RosterShift): SectionRoster[] {
    const rows = assigns.filter(a => a.date === dateStr && toRoster(a.shift) === shift && (a.operator_ids ?? []).length)
    const m = new Map<string, SectionRoster>()
    rows.forEach(a => {
      const cur = m.get(a.section_id) ?? { sectionId: a.section_id, operatorIds: [], variant: null, lot: null }
      ;(a.operator_ids ?? []).forEach(id => { if (!cur.operatorIds.includes(id)) cur.operatorIds.push(id) })
      cur.variant = cur.variant ?? a.variant
      cur.lot = cur.lot ?? a.lot_number
      m.set(a.section_id, cur)
    })
    return SECTION_ORDER.filter(id => m.has(id)).map(id => m.get(id)!)
  }

  function goAssign(dateStr: string, shift: RosterShift) {
    // Night column rosters the capture 'afternoon' shift (16h00–01h00).
    router.push(`/production/capture/assign?date=${dateStr}&shift=${shift === 'night' ? 'afternoon' : 'morning'}`)
  }

  const step = (dir: -1 | 1) => setAnchor(a => addDays(a, dir * (view === 'week' ? 7 : 1)))

  return (
    <div className="px-4 py-6 max-w-[1100px] mx-auto space-y-5">
      <HubHeader subtitle="Master shift calendar — who's rostered, and the technician on duty" />

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
        <WeekGrid days={days} dutyForDay={dutyForDay} rosterFor={rosterFor} onOpen={setModalDate} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-4 py-3 bg-surface-card border border-surface-rule rounded-2xl">
            <HardHat size={16} className={dutyForDay(fmtDay(anchor)).length ? 'text-brand' : 'text-text-muted'} />
            <span className="text-[12px] text-text-muted">Technician on duty:</span>
            <span className="font-body font-semibold text-[13px] text-text">{dutyForDay(fmtDay(anchor)).join(', ') || 'None rostered'}</span>
          </div>
          {ROSTER_SHIFTS.map(sh => (
            <ShiftCard key={sh} shift={sh} roster={rosterFor(fmtDay(anchor), sh)} opNames={opNames} onEdit={() => goAssign(fmtDay(anchor), sh)} />
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-[11px] text-text-muted flex-wrap">
        <span className="font-medium">Shifts:</span>
        {ROSTER_SHIFTS.map(sh => {
          const v = SHIFT_VIEW[sh]; const Icon = v.icon
          return <span key={sh} className="inline-flex items-center gap-1.5"><Icon size={12} className={v.text} /> {v.label} <span className="text-stone-300">·</span> {v.time}</span>
        })}
        <span className="inline-flex items-center gap-1.5 ml-1"><HardHat size={12} /> Technician on duty</span>
      </div>

      {/* Day review modal */}
      {modalDate && (
        <DayReviewModal
          date={modalDate}
          techs={dutyForDay(modalDate)}
          rosterFor={rosterFor}
          opNames={opNames}
          onEdit={goAssign}
          onClose={() => setModalDate(null)}
        />
      )}
    </div>
  )
}

// ── Week grid: sections (rows) × days (columns), Day/Night coverage per cell ────
function WeekGrid({ days, dutyForDay, rosterFor, onOpen }: {
  days: Date[]
  dutyForDay: (d: string) => string[]
  rosterFor: (d: string, s: RosterShift) => SectionRoster[]
  onOpen: (d: string) => void
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
                <th key={ds} className="px-2 py-2 align-top">
                  <button onClick={() => onOpen(ds)} className="w-full text-left rounded-lg px-1.5 py-1 hover:bg-stone-100 transition-colors group">
                    <div className={`font-display font-bold text-[12px] ${today ? 'text-brand' : 'text-text'}`}>{format(d, 'EEE')}</div>
                    <div className="font-mono text-[10px] text-text-muted">{format(d, 'd MMM')}</div>
                    {techs.length > 0 && (
                      <div className="mt-1 inline-flex items-center gap-1 text-[9px] text-text-muted bg-stone-100 group-hover:bg-white rounded-full px-1.5 py-0.5" title={`On duty: ${techs.join(', ')}`}>
                        <HardHat size={9} /> {techs.map(t => t.split(' ')[0]).join(', ')}
                      </div>
                    )}
                  </button>
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
                  const ds = fmtDay(d), today = isToday(d)
                  const present = ROSTER_SHIFTS
                    .map(sh => ({ sh, count: rosterFor(ds, sh).find(r => r.sectionId === sectionId)?.operatorIds.length ?? 0 }))
                    .filter(x => x.count > 0)
                  return (
                    <td key={ds} className={`px-1.5 py-1.5 align-top ${today ? 'bg-brand/[0.03]' : ''}`}>
                      <button onClick={() => onOpen(ds)} className="w-full flex flex-col gap-1 min-h-[28px] group">
                        {present.length ? present.map(({ sh, count }) => {
                          const v = SHIFT_VIEW[sh]; const Icon = v.icon
                          return (
                            <span key={sh} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium ${v.chip} ${v.text}`}>
                              <Icon size={10} /> {count}
                            </span>
                          )
                        }) : (
                          <span className="inline-flex items-center justify-center text-stone-200 group-hover:text-brand transition-colors py-0.5"><Plus size={12} /></span>
                        )}
                      </button>
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

// ── One shift's roster (Day or Night): sections with full operator names ────────
function ShiftCard({ shift, roster, opNames, onEdit }: {
  shift: RosterShift; roster: SectionRoster[]; opNames: (ids: string[] | null) => string[]; onEdit: () => void
}) {
  const v = SHIFT_VIEW[shift]; const Icon = v.icon
  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-rule bg-surface">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${v.chip} border`}>
          <Icon size={14} className={v.text} />
        </span>
        <div className="flex-1">
          <div className="font-display font-bold text-[14px] text-text">{v.label}</div>
          <div className="font-mono text-[10px] text-text-muted">{v.time}</div>
        </div>
        <button onClick={onEdit} className="flex items-center gap-1.5 text-[12px] font-medium text-brand hover:underline">
          <Pencil size={12} /> Edit
        </button>
      </div>
      {roster.length === 0 ? (
        <button onClick={onEdit} className="w-full flex items-center justify-center gap-1.5 py-6 text-[12px] text-stone-400 hover:text-brand transition-colors">
          <Plus size={14} /> No one rostered — tap to roster the {v.label.toLowerCase()}
        </button>
      ) : (
        <div className="divide-y divide-surface-rule">
          {roster.map(r => {
            const m = sectionMeta(r.sectionId); const names = opNames(r.operatorIds)
            return (
              <div key={r.sectionId} className="flex items-start gap-3 px-4 py-3">
                <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5" style={{ background: m.colorHex }}>
                  <span className="font-mono font-bold text-[8px] text-white">{m.code}</span>
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-body font-semibold text-[13px] text-text">{m.name}</span>
                    {(r.variant || r.lot) && (
                      <span className="font-mono text-[10px] text-text-muted">{[r.variant, r.lot].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {names.map((n, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-brand/8 text-brand font-medium">
                        <Users size={10} /> {n}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Day review modal — opened from the week grid ────────────────────────────────
function DayReviewModal({ date, techs, rosterFor, opNames, onEdit, onClose }: {
  date: string
  techs: string[]
  rosterFor: (d: string, s: RosterShift) => SectionRoster[]
  opNames: (ids: string[] | null) => string[]
  onEdit: (d: string, s: RosterShift) => void
  onClose: () => void
}) {
  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-rule sticky top-0 bg-white z-10">
          <div>
            <div className="font-display font-bold text-[16px] text-text">{format(parseISO(date + 'T12:00:00'), 'EEEE d MMMM yyyy')}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted mt-0.5">
              <HardHat size={11} className={techs.length ? 'text-brand' : 'text-text-muted'} />
              {techs.length ? `On duty: ${techs.join(', ')}` : 'No technician on duty'}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-text"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          {ROSTER_SHIFTS.map(sh => {
            const v = SHIFT_VIEW[sh]; const Icon = v.icon
            const roster = rosterFor(date, sh)
            return (
              <div key={sh}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={14} className={v.text} />
                  <span className="font-display font-semibold text-[13px] text-text">{v.label}</span>
                  <span className="font-mono text-[10px] text-text-muted">{v.time}</span>
                  <div className="flex-1" />
                  <button onClick={() => onEdit(date, sh)} className="flex items-center gap-1 text-[11px] font-medium text-brand hover:underline">
                    <Pencil size={11} /> Edit
                  </button>
                </div>
                {roster.length === 0 ? (
                  <p className="text-[12px] text-stone-400 px-1 py-2">No one rostered for the {v.label.toLowerCase()}.</p>
                ) : (
                  <div className="space-y-1.5">
                    {roster.map(r => {
                      const m = sectionMeta(r.sectionId); const names = opNames(r.operatorIds)
                      return (
                        <div key={r.sectionId} className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-surface-rule">
                          <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5" style={{ background: m.colorHex }}>
                            <span className="font-mono font-bold text-[8px] text-white">{m.code}</span>
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-body font-semibold text-[13px] text-text">{m.name}</span>
                              {(r.variant || r.lot) && <span className="font-mono text-[10px] text-text-muted">{[r.variant, r.lot].filter(Boolean).join(' · ')}</span>}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {names.map((n, i) => (
                                <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-brand/8 text-brand font-medium" title={n}>
                                  <Users size={10} /> {n}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
