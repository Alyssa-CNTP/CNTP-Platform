'use client'

import { useState, useEffect, useMemo } from 'react'
import { Gauge, Loader2, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { machineChecksFor, HOURLY_NUDGE_MINUTES } from '@/lib/production/checks-config'
import { loadCheckRecord, ensureCheckRecord, appendCheckEvent } from '@/lib/production/checks-db'
import { loadCheckSpecs, outOfRange, type CheckSpec } from '@/lib/production/check-specs'

const SNOOZE_MS = 10 * 60 * 1000   // "remind me shortly" pushes the prompt out 10 min

/**
 * Hourly VSD (infeed speed) prompt. Auto-pops a modal once an hourly reading is
 * due so the operator is actively asked every hour — the old status-strip nudge
 * was a passive badge that vanished the moment checks were signed, leaving no
 * way to log the reading for the rest of the shift.
 *
 * This lives at the capture-page level (not inside ChecksPanel), so it keeps
 * prompting and stays usable AFTER checks are signed off, for as long as the
 * line is running and the session hasn't been submitted. Readings append to the
 * same production.check_events trail the Checks engine uses.
 */
export function HourlyVsdPrompt({ sectionId, date, shift, sessionId, running, active, operator }: {
  sectionId: string
  date: string
  shift: string
  sessionId: string | null
  running: boolean               // machine running cue (material captured)
  active: boolean                // capture live (not locked / submitted)
  operator: { id: string; name: string } | null
}) {
  // Only sections with an hourly numeric check (Sieving → infeed_vsd) prompt.
  const vsdCheck = useMemo(
    () => machineChecksFor(sectionId).find(c => c.hourly && c.kind === 'number'),
    [sectionId],
  )

  const [spec, setSpec]       = useState<CheckSpec | null>(null)
  const [lastVsd, setLastVsd] = useState<number | null>(null)  // epoch ms of last reading
  const [now, setNow]         = useState<number>(() => Date.now())
  const [value, setValue]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [justLogged, setJustLogged] = useState(false)
  const [snoozeUntil, setSnoozeUntil] = useState(0)

  // Load the acceptable range + the last reading we already have on record.
  useEffect(() => {
    if (!vsdCheck) return
    loadCheckSpecs(sectionId).then(s => setSpec(s[vsdCheck.key] ?? null))
  }, [sectionId, vsdCheck])

  async function refreshLast() {
    if (!vsdCheck) return
    const { events } = await loadCheckRecord(sectionId, date, shift)
    const vsd = events.filter((e: any) => e.check_key === vsdCheck.key && e.value_num != null)
    setLastVsd(vsd.length ? new Date(vsd[vsd.length - 1].recorded_at).getTime() : null)
  }
  useEffect(() => { refreshLast() }, [sectionId, date, shift, running, vsdCheck])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  if (!vsdCheck) return null

  const minsSince = lastVsd ? (now - lastVsd) / 60000 : Infinity
  const due = active && running
    && now >= snoozeUntil
    && (lastVsd === null || minsSince >= HOURLY_NUDGE_MINUTES)

  if (!due) return null

  const parsed = parseFloat(value)
  const validNum = value.trim() !== '' && isFinite(parsed)
  const oor = validNum && outOfRange(parsed, spec)
  const rangeLabel = spec && (spec.min != null || spec.max != null)
    ? `Target ${spec.min ?? '—'}–${spec.max ?? '—'} ${spec.unit ?? vsdCheck.unit ?? ''}`.trim()
    : null

  async function save() {
    if (!validNum) { setError('Enter the reading in Hz'); return }
    setSaving(true); setError(null)
    try {
      const id = await ensureCheckRecord(sectionId, date, shift, sessionId)
      if (!id) { setError('Could not open the checks record'); setSaving(false); return }
      const at = new Date().toISOString()
      await appendCheckEvent(id, {
        phase: 'running', check_key: vsdCheck!.key, check_label: vsdCheck!.label, kind: 'number',
        value_num: parsed, unit: spec?.unit ?? vsdCheck!.unit ?? 'Hz',
        status: oor ? 'flagged' : 'ok', spec_min: spec?.min ?? null, spec_max: spec?.max ?? null,
        source: 'keypad', recorded_at: at,
        actor_id: operator?.id ?? null, actor_name: operator?.name ?? null,
      })
      setLastVsd(Date.now())
      setValue('')
      setJustLogged(true)
      setTimeout(() => setJustLogged(false), 2500)
    } catch (e: any) { setError(e.message ?? 'Could not save the reading') }
    setSaving(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.45)', padding: 16,
    }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-stone-100 bg-warn/8">
          <Gauge size={18} className="text-warn shrink-0" />
          <div className="flex-1">
            <div className="font-semibold text-[15px] text-text">Hourly VSD reading due</div>
            <div className="text-[11px] text-text-muted">{vsdCheck.label} — {sectionMeta(sectionId)}</div>
          </div>
        </div>

        <div className="p-5 space-y-3">
          <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
            <Clock size={13} />
            {lastVsd === null
              ? 'No reading logged yet this shift.'
              : `Last reading ${Math.floor(minsSince)} min ago.`}
          </div>

          <div className="flex items-center gap-2">
            <input
              autoFocus type="text" inputMode="decimal" value={value}
              onChange={e => { setValue(e.target.value.replace(/[^0-9.]/g, '')); setError(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && validNum && !saving) save() }}
              placeholder="0.0"
              className="flex-1 px-3 py-3 rounded-xl border border-stone-200 bg-white text-center font-mono text-[20px] outline-none focus:border-brand"
            />
            <span className="font-mono text-[14px] text-text-muted w-8">{spec?.unit ?? vsdCheck.unit ?? 'Hz'}</span>
          </div>

          {rangeLabel && (
            <p className={`text-[12px] flex items-center gap-1.5 ${oor ? 'text-warn' : 'text-text-muted'}`}>
              {oor && <AlertTriangle size={13} className="shrink-0" />}
              {oor ? `Out of range — logged as flagged. ${rangeLabel}` : rangeLabel}
            </p>
          )}
          {justLogged && (
            <p className="text-[12px] text-ok flex items-center gap-1.5"><CheckCircle2 size={13} /> Reading logged.</p>
          )}
          {error && <p className="text-[12px] text-err">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => setSnoozeUntil(Date.now() + SNOOZE_MS)}
              className="px-3 py-2.5 rounded-xl border border-stone-200 text-stone-600 text-[13px] font-medium hover:bg-stone-50">
              Remind me shortly
            </button>
            <button
              onClick={save} disabled={saving || !validNum}
              className="flex-1 px-4 py-2.5 rounded-xl bg-brand text-white text-[13px] font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Gauge size={15} />} Log reading
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Local, dependency-free section label (avoids importing the capture config here).
function sectionMeta(sectionId: string): string {
  const map: Record<string, string> = {
    sieving: 'Sieving Tower', refining1: 'Refining 1', refining2: 'Refining 2',
    granule: 'Granule Line', blender: 'Blender', pasteuriser: 'Pasteuriser',
  }
  return map[sectionId] ?? sectionId
}
