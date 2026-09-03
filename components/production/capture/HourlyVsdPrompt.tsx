'use client'

import { useState, useEffect, useMemo } from 'react'
import { Gauge, Loader2, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { machineChecksFor, HOURLY_NUDGE_MINUTES } from '@/lib/production/checks-config'
import { loadCheckRecord, ensureCheckRecord, appendCheckEvent } from '@/lib/production/checks-db'
import { loadCheckSpecs, outOfRange, type CheckSpec } from '@/lib/production/check-specs'

const SNOOZE_MS = 10 * 60 * 1000   // "remind me shortly" pushes the prompt out 10 min

/**
 * Hourly VSD (infeed speed) hint.
 *
 * ── Why this is a bar and not a modal ───────────────────────────────────────
 *
 * It was a full-screen modal with a backdrop and an autofocused input, shown
 * the moment a reading came due. Because the FIRST reading was never asked for
 * anywhere — infeed_vsd sat in the 'running' phase with nothing prompting it —
 * "due" was true as soon as material was captured. On the floor that meant it
 * appeared part-way through adding a bulk bag, over the form the operator was
 * filling in, and took the keyboard with it.
 *
 * The first reading is now a start-up check (checks-config.ts), asked once with
 * the rest of the round. What is left here is the hourly reminder, and a
 * reminder must not be able to interrupt work in progress: no backdrop, no
 * autoFocus, `pointerEvents: none` on the wrapper so only the bar itself is
 * clickable, and a dismiss that snoozes it.
 *
 * It still lives at the capture-page level rather than inside ChecksPanel, for
 * the original reason: the status-strip badge vanished the moment checks were
 * signed, leaving no way to log a reading for the rest of the shift. This stays
 * usable after sign-off, for as long as the line is running and the session has
 * not been submitted. Readings append to the same production.check_events trail
 * the Checks engine uses.
 */
export function HourlyVsdPrompt({ sectionId, date, shift, sessionId, running, active, operator, visible = true }: {
  sectionId: string
  date: string
  shift: string
  sessionId: string | null
  running: boolean               // machine running cue (material captured)
  active: boolean                // capture live (not locked / submitted)
  operator: { id: string; name: string } | null
  visible?: boolean              // false on tabs (e.g. Overview) where the modal shouldn't pop —
                                  // stays a prop, not a parent-side unmount, so the "last reading"
                                  // fetch and the hour timer survive switching tabs and back
}) {
  // Only sections with an hourly numeric check (Sieving → infeed_vsd) prompt.
  const vsdCheck = useMemo(
    () => machineChecksFor(sectionId).find(c => c.hourly && c.kind === 'number'),
    [sectionId],
  )

  const [spec, setSpec]       = useState<CheckSpec | null>(null)
  const [lastVsd, setLastVsd] = useState<number | null>(null)  // epoch ms of last reading
  const [loaded, setLoaded]   = useState(false)                 // has the DB read for lastVsd resolved yet
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
    setLoaded(true)
  }
  // Re-fetching resets `loaded` first — otherwise, while sectionId/date/shift
  // change (e.g. a changeover) but before the new record has loaded, `due`
  // would briefly judge readiness against the PREVIOUS shift's lastVsd.
  useEffect(() => { setLoaded(false); refreshLast() }, [sectionId, date, shift, running, vsdCheck])

  // ChecksPanel has its own, separate "Live: hourly VSD reading" widget on the
  // Checks tab that writes to the same check_events trail — a reading logged
  // there never touched this component's own lastVsd state, so this modal kept
  // treating it as still-due (or popping up again almost immediately) even
  // though a reading had genuinely just been logged elsewhere. Poll the DB
  // periodically, not just once on mount, so a reading logged via EITHER path
  // is picked up here within a tick.
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); refreshLast() }, 30_000)
    return () => clearInterval(t)
  }, [sectionId, date, shift, vsdCheck])

  if (!vsdCheck) return null

  const minsSince = lastVsd ? (now - lastVsd) / 60000 : Infinity
  const due = visible && loaded && active && running
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
    <div
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60,
        padding: '0 12px 12px', pointerEvents: 'none',
      }}
    >
      <div
        className="mx-auto w-full max-w-md bg-white border border-warn/30 rounded-2xl shadow-lg overflow-hidden"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-stone-100 bg-warn/8">
          <Gauge size={15} className="text-warn shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[13px] text-text truncate">
              {lastVsd === null ? 'Log the first VSD reading' : 'VSD reading due'}
            </div>
            <div className="text-[11px] text-text-muted truncate">
              {lastVsd === null
                ? `${vsdCheck.label} — ${sectionMeta(sectionId)}`
                : `Last reading ${Math.floor(minsSince)} min ago`}
            </div>
          </div>
          <button
            onClick={() => setSnoozeUntil(Date.now() + SNOOZE_MS)}
            aria-label="Dismiss for now"
            className="shrink-0 p-1.5 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100">
            <X size={15} />
          </button>
        </div>

        <div className="px-3.5 py-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text" inputMode="decimal" value={value}
              onChange={e => { setValue(e.target.value.replace(/[^0-9.]/g, '')); setError(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && validNum && !saving) save() }}
              placeholder="0.0"
              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-center font-mono text-[17px] outline-none focus:border-brand"
            />
            <span className="font-mono text-[13px] text-text-muted w-7 shrink-0">{spec?.unit ?? vsdCheck.unit ?? 'Hz'}</span>
            <button
              onClick={save} disabled={saving || !validNum}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-brand text-white text-[13px] font-semibold disabled:opacity-40 flex items-center gap-1.5">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Gauge size={14} />} Log
            </button>
          </div>

          {rangeLabel && (
            <p className={`text-[11px] flex items-center gap-1.5 ${oor ? 'text-warn' : 'text-text-muted'}`}>
              {oor && <AlertTriangle size={12} className="shrink-0" />}
              {oor ? `Out of range — will be logged as flagged. ${rangeLabel}` : rangeLabel}
            </p>
          )}
          {justLogged && (
            <p className="text-[11px] text-ok flex items-center gap-1.5"><CheckCircle2 size={12} /> Reading logged.</p>
          )}
          {error && <p className="text-[11px] text-err">{error}</p>}
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
