'use client'

/**
 * "Production stopped" — logging a stoppage the moment it happens, from the
 * capture screen.
 *
 * ── Why this exists separately from the timesheet ────────────────────────────
 *
 * The timesheet is finalised on Sign-off, which is right: it runs all shift and
 * is only ever completed at the end. The one thing that genuinely cannot wait
 * for Sign-off is a stoppage happening NOW — the operator is standing at a
 * stopped machine, and the start time is only accurate if it is recorded then.
 *
 * ── What it costs the capture screen ────────────────────────────────────────
 *
 * Nothing, until it is opened. There is no effect on mount, no poll, and no
 * query — `open` starts false and the only read happens when the operator taps
 * the button. That is deliberate and worth preserving: capture is what an
 * operator is mid-shift on, and background work on this screen is latency spent
 * on something nobody asked for. An earlier version of this feature polled
 * `maintenance.job_cards` every 45 seconds from the capture screen; that is the
 * mistake this file is shaped to avoid.
 *
 * The operator picks a reason and adds a note. The line, the area, the date and
 * the shift all come from the production order they already have open — none of
 * it is asked for.
 */

import { useCallback, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Coffee, UtensilsCrossed, Sparkles, Wrench, CircleDot, AlertTriangle,
  Zap, MonitorOff, PackageX, ShieldAlert, Loader2, X, Square, OctagonAlert,
} from 'lucide-react'
import {
  STOPPAGE_KINDS, STOPPAGE_META, isOpen, stoppageMinutes,
  type Stoppage, type StoppageKind,
} from '@/lib/core/timesheet/stoppages'
import {
  loadStoppages, saveStoppage, reportStoppage,
  type StoppageScope,
} from './db'
import { primaryAreaForSection } from './areas'

const KIND_ICON: Partial<Record<StoppageKind, typeof Coffee>> = {
  tea: Coffee, lunch: UtensilsCrossed, deep_clean: Sparkles,
  breakdown: AlertTriangle, maintenance: Wrench,
  power: Zap, it_system: MonitorOff, no_material: PackageX, quality_hold: ShieldAlert,
  other: CircleDot,
}

const hhmm = (iso: string): string => {
  try { return format(parseISO(iso), 'HH:mm') } catch { return '' }
}

export interface StoppageQuickLogProps {
  open:      boolean
  onClose:   () => void
  sessionId: string | null
  operatorName: string
  operatorId: string | null
  sectionId: string
  date:      string
  shift:     string
}

export function StoppageQuickLog({
  open, onClose, sessionId, operatorName, operatorId, sectionId, date, shift,
}: StoppageQuickLogProps) {
  const [running, setRunning] = useState<Stoppage[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [picked, setPicked]   = useState<StoppageKind | null>(null)
  const [note, setNote]       = useState('')
  const [done, setDone]       = useState<string | null>(null)

  const scope: StoppageScope | null = sessionId
    ? { sessionId, operatorId, operatorName, sectionId, date, shift }
    : null

  // Read only when the dialog actually opens — never on mount.
  const refresh = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const all = await loadStoppages(sessionId, operatorName)
      setRunning(all.filter(isOpen))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read your timesheet.')
    } finally {
      setLoading(false)
    }
  }, [sessionId, operatorName])

  // `open` going true is the trigger. A callback ref on the overlay would be
  // cleaner still, but this keeps the read in one place and it only ever runs
  // for a dialog the operator opened.
  const [loadedFor, setLoadedFor] = useState(false)
  if (open && !loadedFor) { setLoadedFor(true); refresh() }
  if (!open && loadedFor) { setLoadedFor(false) }

  if (!open) return null

  const close = () => {
    setPicked(null); setNote(''); setDone(null); setError(null)
    onClose()
  }

  /** Write the stoppage, then tell whoever owns it. */
  const log = async () => {
    if (!scope || !picked) return
    setBusy(true)
    const meta = STOPPAGE_META[picked]
    const stoppage: Stoppage = {
      id: crypto.randomUUID(),
      kind: picked,
      // NOW. The operator stopped the machine, so this is the real time — not a
      // job card's timestamp, which is always later and sometimes hours later.
      startedAt: new Date().toISOString(),
      endedAt: null,
      notes: note.trim() || null,
      machine: null,
      area: primaryAreaForSection(sectionId),
      jobCardId: null,
      source: 'operator',
      voidedAt: null,
      attestation: null,
      notifiedAt: null,
      supervisorRequestedAt: null,
      supervisorRequestCount: 0,
    }
    try {
      await saveStoppage(scope, stoppage)
      // Fire and forget: the stoppage is saved, and a notification failure
      // retries later because `notified_at` is still null. Blocking the
      // operator on it would leave them at a stopped machine watching a
      // spinner.
      if (meta.notify) {
        void reportStoppage({
          stoppageId:   stoppage.id,
          sectionId,
          kind:         picked,
          area:         stoppage.area,
          description:  stoppage.notes ?? '',
          operatorName,
          startedAt:    stoppage.startedAt,
        })
      }
      setDone(
        meta.attested
          ? 'Logged. Maintenance is being told — get your supervisor to confirm it on Sign-off.'
          : meta.notify
            ? 'Logged, and the right people are being told.'
            : 'Logged. Finish your timesheet on Sign-off.',
      )
      setRunning(prev => [...prev, stoppage])
      setPicked(null); setNote(''); setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that stoppage.')
    } finally {
      setBusy(false)
    }
  }

  /** End a stoppage that is still running — production is back up. */
  const end = async (s: Stoppage) => {
    if (!scope) return
    setBusy(true)
    try {
      const closed = { ...s, endedAt: new Date().toISOString() }
      await saveStoppage(scope, closed)
      setRunning(prev => prev.filter(x => x.id !== s.id))
      setDone('Back up. The time is on your timesheet.')
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not close that stoppage.')
    } finally {
      setBusy(false)
    }
  }

  const needsNote = picked ? STOPPAGE_META[picked].needsNotes : false
  const canLog = !!picked && !busy && (!needsNote || !!note.trim())

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={close}>
      <div onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4">

        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-[18px] text-text">Production stopped</h2>
            <p className="text-[12px] text-text-muted">
              {primaryAreaForSection(sectionId) ?? 'This line'} · logged from now
            </p>
          </div>
          <button onClick={close} className="text-stone-400 hover:text-text p-1 shrink-0">
            <X size={20} />
          </button>
        </div>

        {!sessionId && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border bg-warn/5 border-warn/25 text-warn text-[12px]">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>No production session yet — assign the section first.</span>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border bg-err/5 border-err/25 text-err text-[12px]">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {done && (
          <div className="px-3 py-2.5 rounded-xl border bg-ok/5 border-ok/25 text-ok text-[12px]">
            {done}
          </div>
        )}

        {/* Anything already running — ending it is usually why they came back. */}
        {loading ? (
          <p className="text-[12px] text-text-muted flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" /> Checking…
          </p>
        ) : running.length > 0 && (
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
              Still stopped
            </span>
            {running.map(s => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-err/5 border border-err/25">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-err truncate">
                    {STOPPAGE_META[s.kind]?.label ?? s.kind}
                  </p>
                  <p className="text-[11px] text-text-muted font-mono tabular-nums">
                    since {hhmm(s.startedAt)} · {stoppageMinutes(s)} min
                  </p>
                </div>
                <button onClick={() => end(s)} disabled={busy}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-err text-white text-[12px] font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity">
                  <Square size={11} /> Back up
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Pick a reason. Every cause of a stopped line is here, so nothing has
            to be filed as "other" — including the ones that are nobody's
            machine: the system being down, no material, a quality hold. */}
        <div className="space-y-2">
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
            Why?
          </span>
          <div className="grid grid-cols-2 gap-2">
            {STOPPAGE_KINDS.map(k => {
              const Icon = KIND_ICON[k] ?? CircleDot
              const active = picked === k
              return (
                <button key={k} onClick={() => { setPicked(k); setDone(null) }}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[13px] font-semibold transition-colors ${
                    active
                      ? 'bg-brand text-white border-brand'
                      : 'bg-white text-text border-stone-200 hover:border-brand'
                  }`}>
                  <Icon size={14} className="shrink-0" />
                  <span className="truncate">{STOPPAGE_META[k].short}</span>
                </button>
              )
            })}
          </div>
        </div>

        {picked && (
          <div className="space-y-2">
            <input
              type="text" value={note} autoFocus
              onChange={e => setNote(e.target.value)}
              placeholder={STOPPAGE_META[picked].needsNotes ? 'What happened? (required)' : 'Note (optional)'}
              className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand" />
            {STOPPAGE_META[picked].attested && (
              <p className="text-[11px] text-text-muted">
                A supervisor will need to confirm this on Sign-off. Maintenance is told straight away.
              </p>
            )}
            <button onClick={log} disabled={!canLog}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-err text-white font-bold text-[15px] disabled:opacity-40 hover:opacity-90 transition-opacity">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <OctagonAlert size={16} />}
              Log it
            </button>
          </div>
        )}

        <p className="text-[11px] text-text-muted text-center">
          Times and notes can be adjusted on Sign-off before you submit.
        </p>
      </div>
    </div>
  )
}
