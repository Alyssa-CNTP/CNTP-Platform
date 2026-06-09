'use client'
import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { Clock, Coffee, UtensilsCrossed, ArrowLeftRight, LogIn, LogOut, Trash2, CheckCircle2 } from 'lucide-react'
import { uid, nowTime } from '@/components/production/shared/ui'
import { getDb } from '@/lib/supabase/db'
import * as React from 'react'

// ══════════════════════════════════════════════════════════════════════════════
// TIMESHEET TAB — persists to Supabase public.timesheet_events
// ══════════════════════════════════════════════════════════════════════════════
export type TsEventType = 'clock_in'|'tea_start'|'tea_end'|'lunch_start'|'lunch_end'|'changeover'|'clock_out'|'note'
export type TsEvent = { id:string; type:TsEventType; time:string; iso:string; note?:string }

export function TimesheetTab({ locked, sectionId, dateParam, shift }: {
  locked:boolean; sectionId:string; dateParam:string; shift:string
}) {
  const [events, setEvents] = useState<TsEvent[]>([])
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState(false)
  const pendingInserts = useRef<TsEvent[]>([])

  // Load events from Supabase on mount
  useEffect(() => {
    async function load() {
      try {
        const db = getDb()
        const { data: { user } } = await db.auth.getUser()
        if (!user) return
        const { data } = await db
          .from('timesheet_events')
          .select('id,type,time,iso,note')
          .eq('user_id', user.id)
          .eq('section_id', sectionId)
          .eq('date', dateParam)
          .eq('shift', shift)
          .order('iso', { ascending: true })
        setEvents((data ?? []) as TsEvent[])
      } catch {}
      setLoaded(true)
    }
    load()
  }, [sectionId, dateParam, shift])

  // Auto clock-in on first mount if no clock-in exists
  useEffect(() => {
    if (!loaded || locked) return
    setEvents(prev => {
      if (prev.some(e => e.type === 'clock_in')) return prev
      const autoIn: TsEvent = {
        id: uid(), type: 'clock_in', time: nowTime(),
        iso: new Date().toISOString(), note: 'Auto-logged on form open',
      }
      pendingInserts.current.push(autoIn)
      return [autoIn]
    })
  }, [loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  async function persistEvent(ev: TsEvent) {
    try {
      const db = getDb()
      const { data: { user } } = await db.auth.getUser()
      if (!user) return
      await db.from('timesheet_events').insert({
        id: ev.id,
        user_id: user.id,
        section_id: sectionId,
        date: dateParam,
        shift,
        type: ev.type,
        time: ev.time,
        iso: ev.iso,
        note: ev.note ?? null,
      })
    } catch (e) { console.warn('[TimesheetTab] persist failed:', e) }
  }

  // Flush any pending inserts from auto clock-in
  useEffect(() => {
    if (!loaded) return
    const toInsert = pendingInserts.current.splice(0)
    toInsert.forEach(ev => persistEvent(ev))
  }, [loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasIn   = events.some(e => e.type === 'clock_in')
  const hasOut  = events.some(e => e.type === 'clock_out')
  const inTea   = events.filter(e => e.type === 'tea_start').length > events.filter(e => e.type === 'tea_end').length
  const inLunch = events.some(e => e.type === 'lunch_start') && !events.some(e => e.type === 'lunch_end')

  function log(type: TsEventType) {
    const ev: TsEvent = { id: uid(), type, time: nowTime(), iso: new Date().toISOString(), note: note.trim() || undefined }
    setEvents(prev => [...prev, ev])
    persistEvent(ev)
    setNote('')
  }

  async function removeEvent(id: string) {
    setEvents(es => es.filter(x => x.id !== id))
    try {
      const db = getDb()
      await db.from('timesheet_events').delete().eq('id', id)
    } catch {}
  }

  async function clearAll() {
    if (!confirm('Clear all timesheet events for this shift?')) return
    setEvents([])
    try {
      const db = getDb()
      const { data: { user } } = await db.auth.getUser()
      if (!user) return
      await db.from('timesheet_events')
        .delete()
        .eq('user_id', user.id)
        .eq('section_id', sectionId)
        .eq('date', dateParam)
        .eq('shift', shift)
    } catch {}
  }

  const productive = (() => {
    const ci = events.find(e => e.type === 'clock_in'); if (!ci) return null
    const co = events.find(e => e.type === 'clock_out')
    let mins = (new Date(co?.iso ?? new Date()).getTime() - new Date(ci.iso).getTime()) / 60000
    events.filter(e => e.type === 'tea_start').forEach((s, i) => {
      const end = events.filter(e => e.type === 'tea_end')[i]
      if (end) mins -= (new Date(end.iso).getTime() - new Date(s.iso).getTime()) / 60000
    })
    const ls = events.find(e => e.type === 'lunch_start'), le = events.find(e => e.type === 'lunch_end')
    if (ls && le) mins -= (new Date(le.iso).getTime() - new Date(ls.iso).getTime()) / 60000
    return Math.max(0, Math.round(mins))
  })()

  const EV_CFG: Record<TsEventType, { label:string; pill:string; icon:React.ReactNode }> = {
    clock_in:    { label:'Clock in',           pill:'bg-ok/10 text-ok border-ok/30',           icon:<LogIn size={13}/>           },
    clock_out:   { label:'Clock out',          pill:'bg-err/10 text-err border-err/30',         icon:<LogOut size={13}/>          },
    tea_start:   { label:'Tea break start',    pill:'bg-info/10 text-info border-info/30',      icon:<Coffee size={13}/>          },
    tea_end:     { label:'Tea break end',      pill:'bg-info/10 text-info border-info/30',      icon:<Coffee size={13}/>          },
    lunch_start: { label:'Lunch start',        pill:'bg-warn/10 text-warn border-warn/30',      icon:<UtensilsCrossed size={13}/> },
    lunch_end:   { label:'Lunch end',          pill:'bg-warn/10 text-warn border-warn/30',      icon:<UtensilsCrossed size={13}/> },
    changeover:  { label:'Section changeover', pill:'bg-surface text-text border-surface-rule', icon:<ArrowLeftRight size={13}/>  },
    note:        { label:'Note',               pill:'bg-stone-100 text-stone-600 border-stone-200', icon:<span className="text-[10px]">📝</span> },
  }

  return (
    <div className="space-y-4">
      {hasIn && (
        <div className="rounded-2xl bg-brand/5 border border-brand/20 px-5 py-4 flex items-center justify-between">
          <div>
            <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide block">Productive time</span>
            <span className="font-display font-bold text-[26px] text-brand">
              {productive !== null ? `${Math.floor(productive/60)}h ${productive%60}m` : '—'}
            </span>
          </div>
          <div className="text-right text-[11px] font-mono text-text-muted space-y-0.5">
            <div>{events.find(e=>e.type==='clock_in')?.time} → {hasOut ? events.find(e=>e.type==='clock_out')?.time : 'ongoing'}</div>
            {inTea   && <div className="text-info font-semibold">☕ On tea break</div>}
            {inLunch && <div className="text-warn font-semibold">🍽 At lunch</div>}
          </div>
        </div>
      )}
      {hasIn && events[0]?.note?.includes('Auto-logged') && (
        <div className="flex items-center gap-2 px-3 py-2 bg-ok/5 border border-ok/20 rounded-xl">
          <CheckCircle2 size={12} className="text-ok"/>
          <p className="text-[11px] text-ok">Shift auto-started at {events[0].time} when you opened this form.</p>
        </div>
      )}
      {!locked && (
        <div className="space-y-1">
          <label className="font-mono text-[10px] text-text-muted uppercase tracking-wide">Note (optional — attaches to next event)</label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Feed belt jammed briefly"
            className="w-full px-3 py-2.5 rounded-xl border border-surface-rule bg-surface font-body text-[13px] text-text outline-none focus:border-brand"/>
        </div>
      )}
      {!locked && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => log(inTea ? 'tea_end' : 'tea_start')}
            className={`flex items-center justify-center gap-2 py-3.5 rounded-xl border font-bold text-[14px] transition-colors ${
              inTea ? 'border-info/60 bg-info text-white' : 'border-info/40 bg-info/10 text-info'
            }`}>
            <Coffee size={15}/>{inTea ? 'End tea break' : 'Tea break'}
          </button>
          <button onClick={() => log(inLunch ? 'lunch_end' : 'lunch_start')}
            className={`flex items-center justify-center gap-2 py-3.5 rounded-xl border font-bold text-[14px] transition-colors ${
              inLunch ? 'border-warn/60 bg-warn text-white' : 'border-warn/40 bg-warn/10 text-warn'
            }`}>
            <UtensilsCrossed size={15}/>{inLunch ? 'End lunch' : 'Lunch'}
          </button>
          <button onClick={() => log('changeover')}
            className="flex items-center justify-center gap-2 py-3 rounded-xl border border-surface-rule bg-surface font-medium text-[13px] text-text hover:bg-stone-50 transition-colors">
            <ArrowLeftRight size={14}/> Changeover
          </button>
          {note.trim() && (
            <button onClick={() => log('note')}
              className="flex items-center justify-center gap-2 py-3 rounded-xl border border-stone-200 bg-stone-50 font-medium text-[13px] text-stone-600 hover:bg-stone-100 transition-colors">
              📝 Log note
            </button>
          )}
          {hasIn && !hasOut && (
            <button onClick={() => log('clock_out')}
              className="col-span-2 flex items-center justify-center gap-2 py-4 rounded-2xl border border-err/40 bg-err/10 text-err font-bold text-[15px] hover:bg-err/20 transition-colors">
              <LogOut size={16}/> Clock out — end shift
            </button>
          )}
        </div>
      )}
      {events.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide">Event log — {events.length} events</p>
            {!locked && (
              <button onClick={clearAll} className="font-mono text-[10px] text-stone-400 hover:text-err transition-colors">
                Clear all
              </button>
            )}
          </div>
          {events.map(ev => {
            const cfg = EV_CFG[ev.type]
            return (
              <div key={ev.id}>
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${cfg.pill}`}>
                  {cfg.icon}
                  <span className="font-display font-bold text-[13px] flex-1">{cfg.label}</span>
                  <span className="font-mono text-[12px]">{ev.time}</span>
                  {!locked && <button onClick={() => removeEvent(ev.id)} className="opacity-40 hover:opacity-100"><Trash2 size={12}/></button>}
                </div>
                {ev.note && <p className="font-mono text-[10px] text-text-faint ml-12 mt-0.5">{ev.note}</p>}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-12">
          <Clock size={36} className="mx-auto mb-3 text-text-faint opacity-30"/>
          <p className="font-mono text-[12px] text-text-faint">Timesheet auto-starts when you open this form</p>
        </div>
      )}
      {hasIn && hasOut && (
        <div className="rounded-xl bg-stone-50 border border-stone-200 p-4 space-y-2">
          <p className="font-mono text-[10px] text-stone-400 uppercase tracking-wide">Shift summary</p>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div className="flex justify-between"><span className="text-stone-500">Clock in</span><span className="font-mono">{events.find(e=>e.type==='clock_in')?.time}</span></div>
            <div className="flex justify-between"><span className="text-stone-500">Clock out</span><span className="font-mono">{events.find(e=>e.type==='clock_out')?.time}</span></div>
            <div className="flex justify-between col-span-2">
              <span className="text-stone-500">Productive time</span>
              <span className="font-mono font-bold text-brand">{productive !== null ? `${Math.floor(productive/60)}h ${productive%60}m` : '—'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
