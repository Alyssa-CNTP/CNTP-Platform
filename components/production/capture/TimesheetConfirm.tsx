'use client'

import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Clock, Coffee, UtensilsCrossed, Plus, Trash2, CheckCircle2, Loader2, Info } from 'lucide-react'
import {
  loadActivity, loadTimesheet, saveTimesheet, deriveTimesheet, workedMinutes,
  type DerivedTimesheet, type TimesheetBreak, type BreakType,
} from '@/lib/production/timesheet'

// ── ISO ⇄ "HH:mm" helpers (local time, anchored to the session date) ──────────
function isoToTime(iso: string | null): string {
  if (!iso) return ''
  try { return format(parseISO(iso), 'HH:mm') } catch { return '' }
}
// Build an ISO from a "HH:mm" against a base date (the original ISO's day, else
// the session `date`). Keeps the day stable while the operator nudges the time.
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

const TIME_INP = 'px-3 py-2 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'

/**
 * Auto-derived timesheet card shown in the Sign-off tab. The operator reviews the
 * shift start / end and gap-derived tea/lunch breaks, lightly edits if needed, and
 * confirms — persisting a `prod_timesheets` row. `onConfirmedChange` lets the
 * parent gate Submit on confirmation.
 */
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
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [saveWarn, setSaveWarn] = useState(false)
  const [hadActivity, setHadActivity] = useState(false)
  const [derived, setDerived]   = useState<DerivedTimesheet | null>(null)

  // Editable working copy
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime]     = useState('')
  const [startIso, setStartIso]   = useState<string | null>(null)
  const [endIso, setEndIso]       = useState<string | null>(null)
  const [breaks, setBreaks]       = useState<TimesheetBreak[]>([])

  useEffect(() => {
    let alive = true
    async function load() {
      if (!sessionId) { setLoading(false); return }
      try {
        // Already confirmed? Show the stored result.
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
        // Subsystem unreachable (e.g. migration not yet applied) — degrade to
        // manual entry so sign-off is never hard-blocked.
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
  function addBreak() {
    const base = startIso ?? new Date(`${date}T08:00:00`).toISOString()
    setBreaks(bs => [...bs, { type: 'tea', start: base, end: base }])
  }
  function removeBreak(i: number) { setBreaks(bs => bs.filter((_, j) => j !== i)) }

  async function confirm() {
    if (!sessionId) return
    setSaving(true)
    try {
      await saveTimesheet({
        sessionId, operatorId, operatorName, sectionId, date, shift,
        shiftStart: startIso, shiftEnd: endIso, breaks,
        derived: derived ?? { shiftStart: startIso, shiftEnd: endIso, breaks, workedMinutes: worked },
      })
    } catch {
      // Don't hard-block sign-off if the timesheet can't be saved — flag it and
      // let the operator continue (the heartbeat + this state are best-effort).
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
          <p className="text-[11px] text-warn flex items-center gap-1.5"><Info size={12} /> Couldn’t save the timesheet — your sign-off still went through. Mention it to your supervisor.</p>
        )}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><div className="font-mono font-bold text-[16px] text-text">{startTime || '—'}</div><div className="text-[10px] text-text-muted">start</div></div>
          <div><div className="font-mono font-bold text-[16px] text-text">{endTime || '—'}</div><div className="text-[10px] text-text-muted">end</div></div>
          <div><div className="font-mono font-bold text-[16px] text-text">{fmtWorked(worked)}</div><div className="text-[10px] text-text-muted">worked</div></div>
        </div>
        {breaks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {breaks.map((b, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-stone-100 text-stone-600">
                {b.type === 'lunch' ? <UtensilsCrossed size={11} /> : <Coffee size={11} />}
                {isoToTime(b.start)}–{isoToTime(b.end)}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
      <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide flex items-center gap-1.5">
        <Clock size={13} /> Timesheet
      </span>

      <div className="flex items-start gap-2 px-3 py-2.5 bg-info/5 border border-info/20 rounded-xl text-[12px] text-info">
        <Info size={14} className="shrink-0 mt-0.5" />
        <span>
          {hadActivity
            ? 'Auto-filled from your capture activity. Check the times and breaks, then confirm.'
            : 'No activity was recorded for this session — enter your start, end and breaks, then confirm.'}
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
        {breaks.map((b, i) => (
          <div key={i} className="flex items-center gap-2 flex-wrap bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5">
            <select value={b.type} disabled={locked} onChange={e => updateBreak(i, { type: e.target.value as BreakType })}
              className="px-2.5 py-1.5 rounded-lg border border-stone-200 bg-white text-[12px] outline-none focus:border-brand cursor-pointer">
              <option value="tea">Tea</option>
              <option value="lunch">Lunch</option>
            </select>
            <input type="time" value={isoToTime(b.start)} disabled={locked} onChange={e => setBreakTime(i, 'start', e.target.value)} className={TIME_INP + ' flex-1 min-w-[90px]'} />
            <span className="text-[12px] text-text-muted">–</span>
            <input type="time" value={isoToTime(b.end)} disabled={locked} onChange={e => setBreakTime(i, 'end', e.target.value)} className={TIME_INP + ' flex-1 min-w-[90px]'} />
            {!locked && <button onClick={() => removeBreak(i)} className="text-stone-300 hover:text-err p-1"><Trash2 size={15} /></button>}
          </div>
        ))}
        {!locked && (
          <button onClick={addBreak} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-stone-300 text-stone-500 font-medium text-[12px] hover:border-brand hover:text-brand transition-colors">
            <Plus size={15} /> Add break
          </button>
        )}
      </div>

      {/* Worked total */}
      <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-stone-100">
        <span className="text-[12px] font-medium text-stone-600">Time worked</span>
        <span className="font-mono font-bold text-[14px] text-text">{fmtWorked(worked)}</span>
      </div>

      {!locked && (
        <button onClick={confirm} disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-stone-200 bg-white font-medium text-[14px] text-text disabled:opacity-40 hover:bg-stone-50 transition-colors">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} className="text-ok" />}
          Confirm timesheet
        </button>
      )}
    </div>
  )
}
