'use client'

import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Clock, Coffee, UtensilsCrossed, Plus, Trash2, CheckCircle2, Loader2, Info, RefreshCw, Wrench, ChevronDown, AlertTriangle } from 'lucide-react'
import {
  loadActivity, loadTimesheet, saveTimesheet, deriveTimesheet, workedMinutes,
  type DerivedTimesheet, type TimesheetBreak, type BreakType,
} from '@/lib/production/timesheet'
import { getDb } from '@/lib/supabase/db'
import { sectionMeta } from '@/lib/production/capture-config'

// ── ISO ⇄ "HH:mm" helpers (local time, anchored to the session date) ──────────
function isoToTime(iso: string | null): string {
  if (!iso) return ''
  try { return format(parseISO(iso), 'HH:mm') } catch { return '' }
}
function timeToIso(time: string, baseIso: string | null, fallbackDate: string): string | null {
  if (!time) return null
  const day = baseIso ? format(parseISO(baseIso), 'yyyy-MM-dd') : fallbackDate
  const d = new Date(`${day}T${time}:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function fmtWorked(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

function breakDuration(b: TimesheetBreak): string {
  if (!b.start || !b.end) return ''
  const min = Math.round((new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000)
  if (min <= 0) return ''
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`
}

const BREAK_LABELS: Record<BreakType, string> = {
  tea:         'Tea',
  lunch:       'Lunch',
  changeover:  'Changeover',
  maintenance: 'Maintenance',
  other:       'Other',
}

const TIME_INP = 'px-3 py-2 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'

export function TimesheetConfirm({
  sessionId, operatorName, operatorId, sectionId, date, shift, locked, onConfirmedChange,
}: {
  sessionId: string | null
  operatorName: string
  operatorId: string | null
  sectionId: string
  date: string
  shift: string
  locked: boolean
  onConfirmedChange?: (confirmed: boolean) => void
}) {
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [confirmed, setConfirmed]   = useState(false)
  const [saveWarn, setSaveWarn]     = useState(false)
  const [hadActivity, setHadActivity] = useState(false)
  const [derived, setDerived]       = useState<DerivedTimesheet | null>(null)

  const [startTime, setStartTime]   = useState('')
  const [endTime, setEndTime]       = useState('')
  const [startIso, setStartIso]     = useState<string | null>(null)
  const [endIso, setEndIso]         = useState<string | null>(null)
  const [breaks, setBreaks]         = useState<TimesheetBreak[]>([])

  useEffect(() => {
    let alive = true
    async function load() {
      if (!sessionId) { setLoading(false); return }
      try {
        const existing = await loadTimesheet(sessionId, operatorName)
        if (existing?.confirmed) {
          if (!alive) return
          setConfirmed(true)
          setStartIso(existing.shift_start); setEndIso(existing.shift_end)
          setStartTime(isoToTime(existing.shift_start)); setEndTime(isoToTime(existing.shift_end))
          setBreaks(existing.breaks ?? [])
          setHadActivity(!!existing.shift_start)
          setLoading(false)
          onConfirmedChange?.(true)
          return
        }
        const stamps = await loadActivity(sessionId)
        const d = deriveTimesheet(stamps)
        if (!alive) return
        setDerived(d)
        setHadActivity(stamps.length > 0)
        setStartIso(d.shiftStart); setEndIso(d.shiftEnd)
        setStartTime(isoToTime(d.shiftStart)); setEndTime(isoToTime(d.shiftEnd))
        setBreaks(d.breaks)
      } catch {
        if (!alive) return
        setHadActivity(false)
      }
      if (alive) setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [sessionId, operatorName])

  const worked = workedMinutes(startIso, endIso, breaks)

  function setStart(t: string) { setStartTime(t); setStartIso(timeToIso(t, startIso, date)) }
  function setEnd(t: string)   { setEndTime(t);   setEndIso(timeToIso(t, endIso, date)) }

  function updateBreak(i: number, patch: Partial<TimesheetBreak>) {
    setBreaks(bs => bs.map((b, j) => j === i ? { ...b, ...patch } : b))
  }
  function setBreakTime(i: number, field: 'start' | 'end', t: string) {
    const b = breaks[i]
    const iso = timeToIso(t, b[field] || startIso, date)
    if (iso) updateBreak(i, { [field]: iso } as Partial<TimesheetBreak>)
  }

  function addBreak(type: BreakType = 'tea', defaultTime?: string) {
    const base = defaultTime
      ? new Date(`${date}T${defaultTime}:00`).toISOString()
      : startIso ?? new Date(`${date}T08:00:00`).toISOString()
    const defaultDuration: Record<BreakType, number> = { tea: 15, lunch: 60, changeover: 30, maintenance: 30, other: 15 }
    const endMs = new Date(base).getTime() + defaultDuration[type] * 60000
    setBreaks(bs => [...bs, { type, start: base, end: new Date(endMs).toISOString() }])
  }

  function removeBreak(i: number) { setBreaks(bs => bs.filter((_, j) => j !== i)) }

  const maintenanceMissingNotes = breaks.some(b => b.type === 'maintenance' && !b.notes?.trim())

  async function confirm() {
    if (!sessionId || maintenanceMissingNotes) return
    setSaving(true)
    try {
      await saveTimesheet({
        sessionId, operatorId, operatorName, sectionId, date, shift,
        shiftStart: startIso, shiftEnd: endIso, breaks,
        derived: derived ?? { shiftStart: startIso, shiftEnd: endIso, breaks, workedMinutes: worked },
      })
      // Escalate maintenance stoppages to supervisor via line_messages
      const maintenanceBreaks = breaks.filter(b => b.type === 'maintenance')
      if (maintenanceBreaks.length > 0) {
        const db = getDb()
        const meta = sectionMeta(sectionId)
        for (const b of maintenanceBreaks) {
          const dur = breakDuration(b)
          const body = `🔧 Maintenance stoppage reported by ${operatorName} (${meta.name}, ${shift} shift): ${b.notes?.trim()}${dur ? ` — ${dur}` : ''}`
          await db.from('line_messages').insert({
            section_id: sectionId,
            sender_name: operatorName,
            sender_id: operatorId,
            body,
            type: 'alert',
          }).throwOnError()
        }
      }
    } catch {
      setSaveWarn(true)
    } finally {
      setConfirmed(true)
      onConfirmedChange?.(true)
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl p-4 flex items-center gap-2 text-[12px] text-text-muted">
        <Loader2 size={14} className="animate-spin" /> Deriving timesheet…
      </div>
    )
  }

  if (confirmed) {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide flex items-center gap-1.5">
            <Clock size={13} /> Timesheet
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-ok/10 text-ok">
            <CheckCircle2 size={13} /> Confirmed
          </span>
        </div>
        {saveWarn && (
          <p className="text-[11px] text-warn flex items-center gap-1.5"><Info size={12} /> Couldn't save the timesheet — your sign-off still went through. Mention it to your supervisor.</p>
        )}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><div className="font-mono font-bold text-[16px] text-text">{startTime || '—'}</div><div className="text-[10px] text-text-muted">start</div></div>
          <div><div className="font-mono font-bold text-[16px] text-text">{endTime || '—'}</div><div className="text-[10px] text-text-muted">end</div></div>
          <div><div className="font-mono font-bold text-[16px] text-text">{fmtWorked(worked)}</div><div className="text-[10px] text-text-muted">worked</div></div>
        </div>
        {breaks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {breaks.map((b, i) => {
              const dur = breakDuration(b)
              return (
                <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-stone-100 text-stone-600">
                  {b.type === 'lunch' ? <UtensilsCrossed size={11} /> : b.type === 'maintenance' ? <Wrench size={11} /> : <Coffee size={11} />}
                  {BREAK_LABELS[b.type]} {isoToTime(b.start)}{dur ? ` · ${dur}` : ''}
                  {b.notes ? <span className="text-stone-400"> · {b.notes}</span> : null}
                </span>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-4">
      <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide flex items-center gap-1.5">
        <Clock size={13} /> Timesheet
      </span>

      <div className="flex items-start gap-2 px-3 py-2.5 bg-info/5 border border-info/20 rounded-xl text-[12px] text-info">
        <Info size={14} className="shrink-0 mt-0.5" />
        <span>
          {hadActivity
            ? 'Auto-filled from your capture activity. Check the times and breaks, then confirm.'
            : 'No activity was recorded — enter your start, end and breaks, then confirm.'}
        </span>
      </div>

      {/* Start / end */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Shift start</label>
          <input type="time" value={startTime} disabled={locked} onChange={e => setStart(e.target.value)} className={TIME_INP + ' w-full'} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Shift end</label>
          <input type="time" value={endTime} disabled={locked} onChange={e => setEnd(e.target.value)} className={TIME_INP + ' w-full'} />
        </div>
      </div>

      {/* Breaks */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-widest">Breaks &amp; stoppages</span>
        </div>

        {breaks.map((b, i) => {
          const dur = breakDuration(b)
          const needsNotes = b.type === 'changeover' || b.type === 'maintenance' || b.type === 'other'
          return (
            <div key={i} className="bg-stone-50 border border-stone-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <select value={b.type} disabled={locked} onChange={e => updateBreak(i, { type: e.target.value as BreakType })}
                  className="px-2.5 py-1.5 rounded-lg border border-stone-200 bg-white text-[12px] font-medium outline-none focus:border-brand cursor-pointer">
                  {(Object.entries(BREAK_LABELS) as [BreakType, string][]).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
                <input type="time" value={isoToTime(b.start)} disabled={locked}
                  onChange={e => setBreakTime(i, 'start', e.target.value)} className={TIME_INP + ' flex-1 min-w-[88px]'} />
                <span className="text-[12px] text-text-muted">–</span>
                <input type="time" value={isoToTime(b.end)} disabled={locked}
                  onChange={e => setBreakTime(i, 'end', e.target.value)} className={TIME_INP + ' flex-1 min-w-[88px]'} />
                {dur && <span className="text-[11px] font-mono text-stone-500 shrink-0">{dur}</span>}
                {!locked && <button onClick={() => removeBreak(i)} className="text-stone-300 hover:text-err p-1 shrink-0"><Trash2 size={15} /></button>}
              </div>
              {(needsNotes || b.notes) && (
                <input
                  type="text" value={b.notes ?? ''} disabled={locked}
                  onChange={e => updateBreak(i, { notes: e.target.value })}
                  placeholder={b.type === 'maintenance' ? 'Part / machine stopped…' : b.type === 'changeover' ? 'What changed over…' : 'Notes…'}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand"
                />
              )}
            </div>
          )
        })}

        {!locked && (
          <div className="space-y-2">
            {/* Quick-add buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => addBreak('tea', '10:00')}
                className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-stone-200 bg-white text-[12px] font-medium text-stone-600 hover:border-brand hover:text-brand transition-colors">
                <Coffee size={13} /> Tea ~10:00
              </button>
              <button onClick={() => addBreak('lunch', '12:30')}
                className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-stone-200 bg-white text-[12px] font-medium text-stone-600 hover:border-brand hover:text-brand transition-colors">
                <UtensilsCrossed size={13} /> Lunch ~12:30
              </button>
            </div>
            <button onClick={() => addBreak('other')}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-stone-300 text-stone-500 font-medium text-[12px] hover:border-brand hover:text-brand transition-colors">
              <Plus size={15} /> Add stoppage (changeover, maintenance, other…)
            </button>
          </div>
        )}
      </div>

      {/* Worked total */}
      <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-stone-100">
        <span className="text-[12px] font-medium text-stone-600">Time worked</span>
        <span className="font-mono font-bold text-[14px] text-text">{fmtWorked(worked)}</span>
      </div>

      {maintenanceMissingNotes && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-err/5 border border-err/20 rounded-xl text-[12px] text-err">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Maintenance stoppages require a description before you can confirm.</span>
        </div>
      )}

      {!locked && (
        <button onClick={confirm} disabled={saving || maintenanceMissingNotes}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-stone-200 bg-white font-medium text-[14px] text-text disabled:opacity-40 hover:bg-stone-50 transition-colors">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} className="text-ok" />}
          Confirm timesheet
        </button>
      )}
    </div>
  )
}
