'use client'

/**
 * The operator timesheet — finalised on Sign-off, but written all shift.
 *
 * ── Where it lives, and why ─────────────────────────────────────────────────
 *
 * Mounted by the SIGN-OFF step. It briefly had a step of its own, on the
 * reasoning that something used all shift should not be buried in the last one.
 * The practical answer is the other way round: the timesheet runs all shift but
 * is only ever COMPLETED at the end, which is what Sign-off is for, and a
 * seventh step is one more thing to walk past.
 *
 * The one thing that cannot wait for Sign-off is a stoppage happening now. That
 * is `StoppageQuickLog`, opened from the capture header — see its own note.
 *
 * ── What was wrong before, and what fixed it ────────────────────────────────
 *
 * The previous component held every stoppage in React state and wrote the lot
 * once, when the operator tapped "Confirm timesheet". Its load effect depended
 * on `operatorName` — and the capture page feeds that from the sign-off name
 * INPUT, so typing a name re-ran the effect and reset the list to the standard
 * tea/lunch schedule. Start and end re-derived to the same values, so the sheet
 * looked right while every logged stoppage was gone. That is precisely the
 * floor's report: "start and end are fine, the other stoppages don't save."
 *
 * Two things fix it, and both matter:
 *
 *   1. Every edit writes its own row immediately (`saveStoppage`, per-row upsert
 *      on a stable uuid). Reloading mid-shift shows the same sheet.
 *   2. The loader is keyed on the SESSION and reads its identity from a ref, so
 *      it cannot depend on a prop that changes per keystroke. Being back inside
 *      Sign-off is exactly why that has to hold structurally rather than by
 *      being careful — see `identity` below.
 *
 * `queue()` is the pattern to keep: optimistic local state, then a write, and
 * on failure a visible banner rather than a silent revert. An operator who has
 * just logged a two-hour breakdown must not be told it saved when it did not.
 *
 * ── What this does NOT do ───────────────────────────────────────────────────
 *
 * It never reads the maintenance schema, and it polls nothing. An earlier
 * version read `job_cards` every 45 seconds from the capture screen to offer
 * stoppages maintenance already knew about; that was both latency the capture
 * screen should not pay and the wrong direction — the operator stops the
 * machine, so the operator is who knows when. See prompts.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Clock, Coffee, UtensilsCrossed, Sparkles, Wrench, ArrowLeftRight, CircleDot,
  Plus, Trash2, CheckCircle2, Loader2, Info, AlertTriangle, Play, Square,
  Activity, X, Zap, MonitorOff, PackageX, ShieldAlert, BellRing,
} from 'lucide-react'
import {
  STOPPAGE_KINDS, ALL_STOPPAGE_KINDS, STOPPAGE_META, isLive, isOpen, isRetiredKind,
  stoppageMinutes, workedMinutes, downtimeMinutes, validateStoppages, deepCleanDue,
  pendingAttestations, pendingNotifications,
  type Stoppage, type StoppageKind, type SupervisorVerdict,
} from '@/lib/core/timesheet/stoppages'
import {
  loadStoppages, saveStoppage, voidStoppage, seedScheduledStoppages,
  loadTimesheet, confirmTimesheet, saveTimesheetNote,
  attestStoppage, reportStoppage, callSupervisor,
  type StoppageScope,
} from './db'
import { getMySignatureStatus, type MySignatureStatus } from '@/lib/production/employee-signature'
import { derivePrompts, type PromptKind, type TimesheetPrompt } from './prompts'
import { primaryAreaForSection } from './areas'

// ── formatting ───────────────────────────────────────────────────────────────

/**
 * A message from a thrown value, or null when there is nothing useful to show.
 *
 * `catch (e)` gives `unknown`, which is correct — a throw can be anything. This
 * narrows it once, instead of every call site writing `catch (e: any)`, which
 * is the `as any` habit ARCHITECTURE.md §1A is about wearing a smaller costume.
 */
function errMessage(e: unknown): string | null {
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'string' && e) return e
  return null
}

const hhmm = (iso: string | null): string => {
  if (!iso) return ''
  try { return format(parseISO(iso), 'HH:mm') } catch { return '' }
}
const fmtMin = (min: number): string => {
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return h ? `${h}h ${m}m` : `${m}m`
}
/** "HH:mm" typed by the operator → ISO, anchored to the day the stoppage is on. */
function timeToIso(time: string, anchorIso: string | null, fallbackDate: string): string | null {
  if (!time) return null
  let day = fallbackDate
  if (anchorIso) { try { day = format(parseISO(anchorIso), 'yyyy-MM-dd') } catch { /* fallback */ } }
  const d = new Date(`${day}T${time}:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const KIND_ICON: Record<StoppageKind, typeof Coffee> = {
  tea: Coffee, lunch: UtensilsCrossed, deep_clean: Sparkles,
  breakdown: AlertTriangle, maintenance: Wrench,
  power: Zap, it_system: MonitorOff, no_material: PackageX, quality_hold: ShieldAlert,
  other: CircleDot,
  changeover: ArrowLeftRight,   // retired — rendered only where a row carries it
}

/**
 * Chip colour per kind. Downtime reads red, breaks read as breaks.
 *
 * Driven off the same `downtime` flag the KPI uses, so the screen and the
 * figure cannot disagree about which stoppages cost production.
 */
const KIND_TONE: Record<StoppageKind, string> = {
  tea:          'bg-info/10 text-info border-info/25',
  lunch:        'bg-warn/10 text-warn border-warn/25',
  deep_clean:   'bg-brand/10 text-brand border-brand/25',
  breakdown:    'bg-err/10 text-err border-err/25',
  maintenance:  'bg-err/10 text-err border-err/25',
  power:        'bg-err/10 text-err border-err/25',
  it_system:    'bg-err/10 text-err border-err/25',
  no_material:  'bg-err/10 text-err border-err/25',
  quality_hold: 'bg-err/10 text-err border-err/25',
  other:        'bg-stone-100 text-stone-600 border-stone-300',
  changeover:   'bg-stone-100 text-stone-600 border-stone-300',
}

/**
 * What to ask for in the note, per kind.
 *
 * The section and the line are already known from the open production order, so
 * the note is the ONLY thing the operator adds — which makes the prompt worth
 * getting right. A generic "What happened?" on a power failure gets "power
 * off"; asking what was affected gets something a report can use.
 */
const NOTE_HINT: Partial<Record<StoppageKind, string>> = {
  breakdown:    'What broke, and what stopped?',
  maintenance:  'What was worked on?',
  power:        'Whole factory, or just this line?',
  it_system:    'What is down — the tablet, the network, Acumatica?',
  no_material:  'Waiting on what, from where?',
  quality_hold: 'What is on hold, and who called it?',
  other:        'What happened?',
  changeover:   'What changed over?',
}

const CARD  = 'bg-white border border-stone-200 rounded-2xl'
const LABEL = 'text-[11px] font-semibold text-stone-500 uppercase tracking-wide'
const TIME  = 'px-2.5 py-2 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand tabular-nums'
const TEXT  = 'w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand'

/**
 * Quick-log buttons — every offerable kind, in the order an operator reaches
 * for them.
 *
 * Derived from `STOPPAGE_KINDS` rather than listed again, so a kind added to
 * core cannot be missing from the screen. Retired kinds are excluded by
 * construction: they are not in `STOPPAGE_KINDS`.
 */
const QUICK: readonly StoppageKind[] = STOPPAGE_KINDS

export interface OperatorTimesheetProps {
  sessionId:     string | null
  operatorName:  string
  operatorId:    string | null
  sectionId:     string
  date:          string
  shift:         string
  locked:        boolean
  /** True on the sign-off step — turns on the "still running" prompt. */
  atSignOff?:    boolean
  /**
   * May the current user sign a breakdown off? The capture page's `canApprove`
   * (supervisor / IT / admin). An operator sees the pending panel but cannot
   * sign their own breakdown — that is the entire point of the attestation.
   */
  canAttest?:    boolean
  onConfirmedChange?: (confirmed: boolean) => void
  /** Lets the page badge the tab with how many breakdowns await a signature. */
  onPendingAttestationsChange?: (count: number) => void
}

export function OperatorTimesheet({
  sessionId, operatorName, operatorId, sectionId, date, shift, locked,
  atSignOff = false, canAttest = false, onConfirmedChange, onPendingAttestationsChange,
}: OperatorTimesheetProps) {
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const [stoppages, setStoppages] = useState<Stoppage[]>([])
  const [startIso, setStartIso]   = useState<string | null>(null)
  const [endIso, setEndIso]       = useState<string | null>(null)
  const [note, setNote]           = useState('')

  const [dismissedKinds, setDismissedKinds] = useState<ReadonlySet<PromptKind>>(new Set())

  // Supervisor attestation
  const [sigStatus, setSigStatus] = useState<MySignatureStatus | null>(null)
  const [signing, setSigning]     = useState<string | null>(null)
  const [disputeFor, setDisputeFor] = useState<string | null>(null)
  const [calling, setCalling]     = useState<string | null>(null)
  /**
   * Stoppages whose notification reached NOBODY — no maintenance manager, no IT
   * user, nobody holding the role for that team.
   *
   * Session-scoped rather than a column, deliberately: the operator is standing
   * at the machine when it happens and the action needed is immediate (go and
   * tell someone). The stoppage itself is on the record either way, and the
   * shift report still shows it.
   */
  const [reachedNobody, setReachedNobody] = useState<ReadonlySet<string>>(new Set())
  const [disputeNote, setDisputeNote] = useState('')

  // A ticking clock so an OPEN stoppage's minutes climb on screen instead of
  // sitting at whatever they were when the component last rendered.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const scope: StoppageScope | null = useMemo(
    () => sessionId ? { sessionId, operatorId, operatorName, sectionId, date, shift } : null,
    [sessionId, operatorId, operatorName, sectionId, date, shift],
  )

  // The scope the LEDGER is keyed on. Deliberately pinned to the operator name
  // this component first loaded with, so a keystroke in the sign-off name field
  // cannot re-key the sheet mid-shift and orphan every row already written.
  const ledgerScope = useRef<StoppageScope | null>(null)
  /** The note as last written, so blur only writes when it actually changed. */
  const savedNote = useRef<string>('')

  // The identity fields the loader needs, held in a ref rather than named in
  // the load effect's dependency list.
  //
  // This is the fix for the bug, expressed in the type system rather than in a
  // comment: the effect CANNOT depend on `operatorName`, because the capture
  // page feeds that from the sign-off name input and every keystroke would
  // re-run the loader and re-seed the sheet over the operator's own edits. A
  // ref makes the effect genuinely depend on `sessionId` alone, so
  // exhaustive-deps is satisfied honestly instead of being silenced.
  const identity = useRef({ operatorId, operatorName, sectionId, date, shift })
  identity.current = { operatorId, operatorName, sectionId, date, shift }

  // The callbacks go in a ref for the same reason. The capture page happens to
  // pass stable useState setters, but a caller passing an inline arrow would
  // otherwise make the load effect re-run on every render — an infinite reload
  // of the operator's timesheet, which is a worse failure than the one being
  // fixed. A feature's contract should not depend on how its caller spells a
  // prop.
  const cb = useRef({ onConfirmedChange, onPendingAttestationsChange })
  cb.current = { onConfirmedChange, onPendingAttestationsChange }

  // ── Load ──────────────────────────────────────────────────────────────────
  //
  // Keyed on the SESSION only — see the `identity` ref above for why that is
  // the whole point and not an oversight.
  useEffect(() => {
    let alive = true
    if (!sessionId) { setLoading(false); return }

    async function load() {
      setLoading(true); setLoadError(null)
      const s: StoppageScope = { sessionId: sessionId!, ...identity.current }
      ledgerScope.current = s
      try {
        const [existing, sheet] = await Promise.all([
          loadStoppages(s.sessionId, s.operatorName),
          loadTimesheet(s.sessionId, s.operatorName),
        ])
        const rows = await seedScheduledStoppages(s, existing)
        if (!alive) return

        setStoppages(rows)
        setNote(sheet?.notes ?? '')
        savedNote.current = sheet?.notes ?? ''
        setConfirmed(!!sheet?.confirmed)
        cb.current.onConfirmedChange?.(!!sheet?.confirmed)

        // Shift start is the operator's login (the first capture heartbeat),
        // recorded on the confirmed sheet once it exists. Until then, fall back
        // to the earliest thing we know happened.
        const firstStop = rows.filter(isLive).map(r => r.startedAt).sort()[0] ?? null
        setStartIso(sheet?.shiftStart ?? firstStop)
        setEndIso(sheet?.shiftEnd ?? null)
      } catch (e) {
        if (!alive) return
        setLoadError(errMessage(e) ?? 'Could not load your timesheet.')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [sessionId])

  useEffect(() => { if (canAttest) getMySignatureStatus().then(setSigStatus) }, [canAttest])

  // ── Writes ────────────────────────────────────────────────────────────────

  /**
   * Apply an edit optimistically, then persist that one row.
   *
   * On failure the local state is KEPT and a banner appears. Reverting would
   * be worse: the operator would watch the stoppage they just logged vanish and
   * assume they mis-tapped, which is how the original bug went unreported for
   * so long.
   */
  const queue = useCallback(async (next: Stoppage) => {
    setStoppages(prev => {
      const i = prev.findIndex(s => s.id === next.id)
      return i === -1 ? [...prev, next] : prev.map(s => s.id === next.id ? next : s)
    })
    const s = ledgerScope.current
    if (!s) { setSaveError('No production session — your timesheet cannot be saved yet.'); return }
    try {
      await saveStoppage(s, next)
      setSaveError(null)
    } catch (e) {
      setSaveError(errMessage(e) ?? 'Could not save that stoppage.')
    }
  }, [])

  /**
   * Apply an operator edit to one stoppage.
   *
   * If the edit moves an ATTESTED breakdown's window or its kind, the
   * attestation is cleared and the supervisor has to sign again. A signature
   * that survived the times it was given for would be a signature on facts the
   * supervisor never saw — which is worse than no signature, because the KPI
   * would treat it as verified.
   */
  const patch = useCallback((id: string, p: Partial<Stoppage>) => {
    const current = stoppages.find(s => s.id === id)
    if (!current) return
    const next = { ...current, ...p }
    const windowMoved =
      next.startedAt !== current.startedAt ||
      next.endedAt !== current.endedAt ||
      next.kind !== current.kind
    if (current.attestation && windowMoved) next.attestation = null
    queue(next)
  }, [stoppages, queue])

  /** Start a stoppage NOW, open-ended. The tracker's primary action. */
  const startNow = useCallback((kind: StoppageKind, from?: Partial<Stoppage>) => {
    queue({
      id: crypto.randomUUID(),
      kind,
      startedAt: new Date().toISOString(),
      endedAt: null,
      notes: null,
      machine: null,
      area: primaryAreaForSection(sectionId),
      jobCardId: null,
      source: 'operator',
      voidedAt: null,
      attestation: null,
      notifiedAt: null,
      supervisorRequestedAt: null,
      supervisorRequestCount: 0,
      ...from,
    })
  }, [queue, sectionId])

  /** Add one with a start AND an end, for logging after the fact. */
  const addClosed = useCallback((kind: StoppageKind) => {
    const start = new Date()
    const end = new Date(start.getTime() + STOPPAGE_META[kind].defaultMinutes * 60_000)
    queue({
      id: crypto.randomUUID(), kind,
      startedAt: start.toISOString(), endedAt: end.toISOString(),
      notes: null, machine: null, area: primaryAreaForSection(sectionId),
      jobCardId: null, source: 'operator', voidedAt: null,
      attestation: null, notifiedAt: null,
      supervisorRequestedAt: null, supervisorRequestCount: 0,
    })
  }, [queue, sectionId])

  const closeAt = useCallback((id: string, iso: string) => patch(id, { endedAt: iso }), [patch])

  const remove = useCallback(async (id: string) => {
    setStoppages(prev => prev.map(s => s.id === id ? { ...s, voidedAt: new Date().toISOString() } : s))
    try {
      await voidStoppage(id, operatorName, 'Removed by the operator')
      setSaveError(null)
    } catch (e) {
      setSaveError(errMessage(e) ?? 'Could not remove that stoppage.')
    }
  }, [operatorName])

  // ── Telling whoever can act ───────────────────────────────────────────────
  //
  // Fires for any live stoppage with no `notified_at` stamp whose kind names a
  // team. The stamp is the de-dupe: written only after the route accepts, so a
  // failure retries on the next render and a success never sends twice, across
  // reloads and across two operators on the same session.
  //
  // Which team is the KIND's decision, taken server-side from core — the
  // browser does not get to choose who it pages.
  //
  // A ref guards against the SAME render loop firing twice while the first
  // request is still in flight; `notified_at` is what guards across reloads.
  const notifying = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (locked || !ledgerScope.current) return
    const due = pendingNotifications(stoppages).filter(s => !notifying.current.has(s.id))
    if (due.length === 0) return

    for (const s of due) {
      notifying.current.add(s.id)
      reportStoppage({
        stoppageId:   s.id,
        sectionId,
        kind:         s.kind,
        area:         s.area,
        description:  s.notes ?? '',
        operatorName,
        startedAt:    s.startedAt,
      }).then(notified => {
        // null = the call failed. Leave `notifiedAt` unset so the next render
        // retries, which is what we want when the service is briefly down.
        if (notified === null) { notifying.current.delete(s.id); return }

        setStoppages(prev => prev.map(x =>
          x.id === s.id ? { ...x, notifiedAt: new Date().toISOString() } : x))

        // Reached NOBODY. The row is stamped so we stop retrying — there is no
        // one to retry to — but the operator must not be told "maintenance
        // knows". Nobody is configured for that team, so the only thing that
        // will get the line looked at is them going and saying so.
        if (notified === 0) {
          setReachedNobody(prev => new Set([...prev, s.id]))
        }
        notifying.current.delete(s.id)
      })
    }
  }, [stoppages, locked, sectionId, operatorName])

  // ── Derived ───────────────────────────────────────────────────────────────

  // The line a stoppage is filed against — never asked for, because it is the
  // production order the operator already has open. Shown so they can see what
  // is being recorded on their behalf, which is not the same as choosing it.
  const area = primaryAreaForSection(sectionId)
  const areaLabel = area ? `logged against ${area}` : 'logged against this line'

  const live      = useMemo(() => stoppages.filter(isLive), [stoppages])
  const running   = useMemo(() => live.filter(isOpen), [live])
  const effEnd    = endIso ?? new Date(now).toISOString()
  const worked    = workedMinutes(startIso, effEnd, live, now)
  const downtime  = downtimeMinutes(live, now)
  const problems  = useMemo(() => validateStoppages(live), [live])
  const problemById = useMemo(
    () => new Map(problems.map(p => [p.id, p.message])), [problems],
  )

  const prompts = useMemo(() => derivePrompts({
    stoppages, date, shift, dismissedKinds, atSignOff,
  }), [stoppages, date, shift, dismissedKinds, atSignOff])

  const awaiting = useMemo(() => pendingAttestations(stoppages), [stoppages])

  useEffect(() => {
    cb.current.onPendingAttestationsChange?.(awaiting.length)
  }, [awaiting.length])

  // ── Supervisor signs ──────────────────────────────────────────────────────

  /**
   * Call a supervisor to come and confirm a breakdown.
   *
   * The operator's "submit". It notifies the production supervisors and stamps
   * the row, so a shift report can later tell "never asked" apart from "asked
   * four times and ignored" — different problems, different people at fault.
   */
  const call = useCallback(async (s: Stoppage) => {
    setCalling(s.id)
    try {
      const at = await callSupervisor({
        stoppageId:    s.id,
        sectionId,
        area:          s.area,
        description:   s.notes ?? '',
        operatorName,
        startedAt:     s.startedAt,
        previousCalls: s.supervisorRequestCount,
      })
      if (!at) { setSaveError('Could not reach a supervisor. Try again, or go and find one.'); return }
      setStoppages(prev => prev.map(x => x.id === s.id
        ? { ...x, supervisorRequestedAt: at, supervisorRequestCount: x.supervisorRequestCount + 1 }
        : x))
      setSaveError(null)
    } finally {
      setCalling(null)
    }
  }, [sectionId, operatorName])

  /**
   * Record the supervisor's verdict on a breakdown.
   *
   * Applied against their Staff Directory signature, the same "Verify & Sign"
   * identity job cards and shift reports use — no name field, no hand-drawn
   * scrawl. One person, one signature across the platform.
   */
  const sign = useCallback(async (
    stoppageId: string,
    verdict: SupervisorVerdict,
    note: string | null,
  ) => {
    if (!sigStatus?.hasSignature) return
    setSigning(stoppageId)
    const attestation = {
      verdict,
      supervisorName: sigStatus.employeeName ?? 'Supervisor',
      employeeId:     sigStatus.employeeId,
      signedAt:       new Date().toISOString(),
      note,
    }
    try {
      await attestStoppage({
        stoppageId, verdict,
        supervisorName: attestation.supervisorName,
        employeeId:     attestation.employeeId,
        note,
      })
      setStoppages(prev => prev.map(s => s.id === stoppageId ? { ...s, attestation } : s))
      setSaveError(null)
      setDisputeFor(null)
      setDisputeNote('')
    } catch (e) {
      setSaveError(errMessage(e) ?? 'Could not record your signature.')
    } finally {
      setSigning(null)
    }
  }, [sigStatus])

  // ── Prompt actions ────────────────────────────────────────────────────────

  const actOnPrompt = useCallback((p: TimesheetPrompt) => {
    switch (p.kind) {
      case 'log_deep_clean':
        addClosed('deep_clean')
        setDismissedKinds(prev => new Set([...prev, 'log_deep_clean' as PromptKind]))
        break
      case 'still_open':
        if (p.stoppageId) closeAt(p.stoppageId, new Date().toISOString())
        break
      case 'confirm_with_supervisor':
        // Nothing to do on screen — the supervisor signs it in the panel
        // below. The prompt carries no action, so this case is unreachable
        // from the UI and exists only to keep the switch total.
        break
    }
  }, [closeAt, addClosed])

  /**
   * Wave a prompt away for the rest of the shift.
   *
   * Only offered where declining is a real answer — a Wednesday deep clean, a
   * stoppage the operator will close themselves. `confirm_with_supervisor`
   * carries no dismiss, because it is not a suggestion: it is the state of the
   * sheet, and it stays until somebody signs.
   */
  const dismissPrompt = useCallback((p: TimesheetPrompt) => {
    setDismissedKinds(prev => new Set([...prev, p.kind]))
  }, [])

  // ── Confirm ───────────────────────────────────────────────────────────────

  const confirm = useCallback(async () => {
    const s = ledgerScope.current
    if (!s) { setSaveError('No production session — your timesheet cannot be confirmed yet.'); return }
    if (problems.length > 0) return

    setConfirming(true)
    try {
      const end = endIso ?? new Date().toISOString()
      // Close anything still running at the shift end, in the ledger too, so
      // the ledger and the snapshot agree about when the line came back.
      for (const r of running) {
        await saveStoppage(s, { ...r, endedAt: end })
      }
      const closed = live.map(x => x.endedAt ? x : { ...x, endedAt: end })

      await confirmTimesheet({
        ...s,
        shiftStart: startIso,
        shiftEnd:   end,
        stoppages:  closed,
        notes:      note,
      })
      setStoppages(prev => prev.map(x => x.endedAt || !isLive(x) ? x : { ...x, endedAt: end }))
      setEndIso(end)
      setSaveError(null)
      setConfirmed(true)
      cb.current.onConfirmedChange?.(true)
    } catch (e) {
      // NOT confirmed. The previous version set confirmed in a `finally`, so a
      // failed write still showed a green tick over data that was never saved.
      setSaveError(errMessage(e) ?? 'Could not confirm your timesheet. Try again.')
    } finally {
      setConfirming(false)
    }
  }, [problems, endIso, running, live, startIso, note])

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={`${CARD} p-4 flex items-center gap-2 text-[12px] text-text-muted`}>
        <Loader2 size={14} className="animate-spin" /> Loading your timesheet…
      </div>
    )
  }

  const readOnly = locked || confirmed

  return (
    <div className="space-y-3">
      {/* ── Headline ─────────────────────────────────────────────────────── */}
      <div className={`${CARD} p-4 space-y-3`}>
        <div className="flex items-center justify-between gap-2">
          <span className={`${LABEL} flex items-center gap-1.5`}>
            <Clock size={13} /> Timesheet
          </span>
          {confirmed ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-ok/10 text-ok">
              <CheckCircle2 size={13} /> Confirmed
            </span>
          ) : running.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-err/10 text-err">
              <Activity size={13} className="animate-pulse" />
              {running.length === 1 ? 'Stopped' : `${running.length} stoppages running`}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-ok/10 text-ok">
              <Play size={11} /> Running
            </span>
          )}
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="start" value={hhmm(startIso) || '—'} />
          <Stat label={endIso ? 'end' : 'now'} value={hhmm(effEnd) || '—'} />
          <Stat label="worked" value={fmtMin(worked)} tone="text-brand" />
          <Stat label="downtime" value={fmtMin(downtime)} tone={downtime > 0 ? 'text-err' : 'text-text'} />
        </div>

        {!readOnly && (
          <div className="grid grid-cols-2 gap-2">
            <TimeField label="Shift start · login" value={hhmm(startIso)} disabled
              hint="Set from your login — can’t be changed" />
            <TimeField label="Shift end" value={hhmm(endIso)}
              placeholderNow={!endIso}
              onChange={t => setEndIso(timeToIso(t, endIso ?? startIso, date))} />
          </div>
        )}
      </div>

      {/* ── Errors ───────────────────────────────────────────────────────── */}
      {loadError && <Banner tone="err" icon={AlertTriangle}>{loadError}</Banner>}
      {saveError && (
        <Banner tone="err" icon={AlertTriangle}>
          {saveError} Your entries are still on this screen — tell your supervisor before you leave.
        </Banner>
      )}
      {/* Nobody was reached. Not an error — the stoppage saved — but the thing
          the operator most needs to know, because the line stays down until
          somebody hears about it and the app has just failed to be that. */}
      {reachedNobody.size > 0 && (
        <Banner tone="err" icon={AlertTriangle}>
          <strong>Nobody was notified.</strong> The stoppage is saved, but no one is set up
          to receive it — go and tell maintenance or your supervisor in person, and let IT
          know the notification list is empty.
        </Banner>
      )}
      {!sessionId && (
        <Banner tone="warn" icon={Info}>
          No production session yet. Assign the section first — the timesheet has nowhere to save to
          until then.
        </Banner>
      )}

      {/* ── Prompts: the smart tracker ───────────────────────────────────── */}
      {!readOnly && prompts.length > 0 && (
        <div className="space-y-2">
          {prompts.map(p => (
            <div key={p.key}
              className={`rounded-2xl border p-3 space-y-2 ${
                p.urgency === 'high' ? 'bg-err/5 border-err/25' : 'bg-info/5 border-info/25'
              }`}>
              <div className="flex items-start gap-2">
                {p.urgency === 'high'
                  ? <AlertTriangle size={15} className="text-err shrink-0 mt-0.5" />
                  : <Info size={15} className="text-info shrink-0 mt-0.5" />}
                <div className="min-w-0 flex-1">
                  <p className={`text-[13px] font-semibold ${p.urgency === 'high' ? 'text-err' : 'text-info'}`}>
                    {p.title}
                  </p>
                  <p className="text-[12px] text-text-muted break-words">{p.detail}</p>
                </div>
              </div>
              {/* A prompt with no action is telling the operator something
                  they do away from the screen (get a supervisor). It gets no
                  buttons at all — an "OK" that does nothing trains people to
                  dismiss the ones that do. */}
              {p.action && (
                <div className="flex items-center gap-2">
                  <button onClick={() => actOnPrompt(p)}
                    className={`flex-1 py-2 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 ${
                      p.urgency === 'high' ? 'bg-err' : 'bg-info'
                    }`}>
                    {p.action}
                  </button>
                  <button onClick={() => dismissPrompt(p)} title="Didn’t happen this shift"
                    className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[12px] text-stone-500 hover:text-text transition-colors">
                    Not today
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Breakdowns awaiting a supervisor's signature ─────────────────── */}
      {awaiting.length > 0 && (
        <div className={`${CARD} p-4 space-y-3 border-warn/40`}>
          <div className="flex items-center justify-between gap-2">
            <span className={`${LABEL} flex items-center gap-1.5`}>
              <AlertTriangle size={13} className="text-warn" /> Breakdown confirmation
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-warn/10 text-warn">
              {awaiting.length} to sign
            </span>
          </div>

          <p className="text-[12px] text-text-muted">
            {canAttest
              ? 'A breakdown takes time out of this shift’s production figures and puts downtime against a machine. Confirm each one is true, or dispute it.'
              : 'A supervisor needs to confirm each breakdown. Your timesheet can still be submitted — this does not hold you up.'}
          </p>

          {canAttest && sigStatus && !sigStatus.hasSignature && (
            <Banner tone="warn" icon={Info}>
              No signature on file — set one up on your Staff Directory profile before you can sign.
            </Banner>
          )}

          {awaiting.map(s => (
            <div key={s.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-text">
                    {s.machine || s.area || 'Unnamed machine'}
                  </p>
                  <p className="text-[11px] text-text-muted font-mono tabular-nums">
                    {hhmm(s.startedAt)}–{s.endedAt ? hhmm(s.endedAt) : 'running'} · {fmtMin(stoppageMinutes(s, now))}
                  </p>
                </div>
                <span className="text-[10px] text-text-muted shrink-0">{operatorName}</span>
              </div>
              {s.notes && <p className="text-[12px] text-text break-words">{s.notes}</p>}

              {canAttest ? (
                disputeFor === s.id ? (
                  <div className="space-y-2">
                    <input type="text" value={disputeNote} autoFocus
                      onChange={e => setDisputeNote(e.target.value)}
                      placeholder="Why is this not right? (required)"
                      className={TEXT} />
                    <div className="flex gap-2">
                      <button
                        onClick={() => sign(s.id, 'disputed', disputeNote)}
                        disabled={!disputeNote.trim() || signing === s.id || !sigStatus?.hasSignature}
                        className="flex-1 py-2 rounded-xl bg-err text-white text-[13px] font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity">
                        {signing === s.id ? 'Signing…' : 'Sign as disputed'}
                      </button>
                      <button onClick={() => { setDisputeFor(null); setDisputeNote('') }}
                        className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[12px] text-stone-500">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => sign(s.id, 'confirmed', null)}
                      disabled={signing === s.id || !sigStatus?.hasSignature}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-ok text-white text-[13px] font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity">
                      {signing === s.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <CheckCircle2 size={14} />}
                      Verify &amp; Sign as {sigStatus?.employeeName ?? 'you'}
                    </button>
                    <button onClick={() => setDisputeFor(s.id)}
                      className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[12px] text-stone-500 hover:text-err transition-colors">
                      Dispute
                    </button>
                  </div>
                )
              ) : (
                /* The OPERATOR'S side: a button that actually fetches someone.
                   Before this the screen said "awaiting supervisor confirmation"
                   and offered no way to ask anybody, so a sheet sat unsigned
                   until a supervisor happened to walk past the tablet.
                   Repeatable on purpose — being ignored is the case it exists
                   for, and each repeat escalates the notification. */
                <div className="space-y-2">
                  <button onClick={() => call(s)} disabled={calling === s.id}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-warn text-white text-[13px] font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity">
                    {calling === s.id
                      ? <Loader2 size={14} className="animate-spin" />
                      : <BellRing size={14} />}
                    {s.supervisorRequestedAt ? 'Ask again' : 'Ask a supervisor to confirm'}
                  </button>
                  <p className="text-[11px] text-text-muted flex items-center gap-1.5">
                    <Clock size={11} className="shrink-0" />
                    {s.supervisorRequestedAt
                      ? `Asked at ${hhmm(s.supervisorRequestedAt)}${
                          s.supervisorRequestCount > 1 ? ` · ${s.supervisorRequestCount} times` : ''
                        } — still not signed.`
                      : 'Nobody has been asked yet.'}
                    {s.notifiedAt ? ' Maintenance knows.' : ''}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Quick log ────────────────────────────────────────────────────── */}
      {!readOnly && (
        <div className={`${CARD} p-4 space-y-3`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className={LABEL}>Why did production stop?</span>
            <span className="text-[11px] text-text-muted">
              starts now · {areaLabel}
            </span>
          </div>
          {/* The section and its area come from the production order that is
              open — the operator is never asked which line they are on. All
              they add is a note. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {QUICK.map(kind => {
              const Icon = KIND_ICON[kind]
              const m = STOPPAGE_META[kind]
              return (
                <button key={kind} onClick={() => startNow(kind)}
                  className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl border text-[12px] font-semibold transition-opacity hover:opacity-80 ${KIND_TONE[kind]}`}>
                  <Icon size={13} className="shrink-0" />
                  <span className="truncate">{m.short}</span>
                </button>
              )
            })}
            <button onClick={() => addClosed('other')}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-dashed border-stone-300 text-[12px] font-medium text-stone-500 hover:border-brand hover:text-brand transition-colors">
              <Plus size={14} /> Earlier
            </button>
          </div>
        </div>
      )}

      {/* ── The sheet ────────────────────────────────────────────────────── */}
      <div className={`${CARD} p-4 space-y-2`}>
        <div className="flex items-center justify-between">
          <span className={LABEL}>Breaks &amp; stoppages</span>
          <span className="text-[11px] text-text-muted tabular-nums">
            {live.length} logged{running.length > 0 ? ` · ${running.length} running` : ''}
          </span>
        </div>

        {live.length === 0 && (
          <p className="text-[12px] text-text-muted py-4 text-center">
            Nothing logged yet. Tea and lunch appear here automatically for your shift.
          </p>
        )}

        {live
          .slice()
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
          .map(s => (
            <StoppageRow
              key={s.id}
              stoppage={s}
              date={date}
              now={now}
              readOnly={readOnly}
              problem={problemById.get(s.id)}
              onPatch={p => patch(s.id, p)}
              onCloseNow={() => closeAt(s.id, new Date().toISOString())}
              onRemove={() => remove(s.id)}
            />
          ))}
      </div>

      {/* ── Operator note ────────────────────────────────────────────────── */}
      <div className={`${CARD} p-4 space-y-2`}>
        <span className={LABEL}>Note for the production record</span>
        <p className="text-[11px] text-text-muted">
          Anything about the shift worth keeping — this is saved with your timesheet and shows on the
          shift report and the production order.
        </p>
        <textarea
          value={note} onChange={e => setNote(e.target.value)} disabled={readOnly} rows={2}
          // Persisted on blur, not only at confirm. A note that lives in React
          // state until sign-off is the same failure as the stoppages were:
          // the operator types it, moves back to Capture, and it is gone.
          onBlur={async () => {
            const s = ledgerScope.current
            if (!s || readOnly || note === (savedNote.current ?? '')) return
            try {
              await saveTimesheetNote(s, note)
              savedNote.current = note
              setSaveError(null)
            } catch (e) {
              setSaveError(errMessage(e) ?? 'Could not save your note.')
            }
          }}
          placeholder="e.g. Tower ran slow all morning after the belt change…"
          className={`${TEXT} resize-none disabled:bg-stone-50 disabled:text-stone-500`} />
      </div>

      {/* ── Confirm ──────────────────────────────────────────────────────── */}
      {!confirmed && !locked && (
        <>
          {problems.length > 0 && (
            <Banner tone="err" icon={AlertTriangle}>
              {problems.length === 1
                ? problems[0].message
                : `${problems.length} stoppages need a short description before you can confirm.`}
            </Banner>
          )}
          {deepCleanDue(date, shift) && !live.some(s => s.kind === 'deep_clean') && (
            <p className="text-[11px] text-text-muted px-1">
              No deep clean logged — that’s fine if it didn’t happen this shift.
            </p>
          )}
          <button onClick={confirm} disabled={confirming || problems.length > 0 || !sessionId}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-stone-200 bg-white font-semibold text-[14px] text-text disabled:opacity-40 hover:bg-stone-50 transition-colors">
            {confirming ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} className="text-ok" />}
            Confirm timesheet
          </button>
        </>
      )}
    </div>
  )
}

// ── Small parts ──────────────────────────────────────────────────────────────

function Stat({ label, value, tone = 'text-text' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className={`font-mono font-bold text-[16px] tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] text-text-muted">{label}</div>
    </div>
  )
}

function Banner({ tone, icon: Icon, children }: {
  tone: 'err' | 'warn' | 'info'; icon: typeof Info; children: React.ReactNode
}) {
  const cls = tone === 'err' ? 'bg-err/5 border-err/25 text-err'
    : tone === 'warn' ? 'bg-warn/5 border-warn/25 text-warn'
    : 'bg-info/5 border-info/25 text-info'
  return (
    <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-[12px] ${cls}`}>
      <Icon size={14} className="shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  )
}

function TimeField({ label, value, onChange, disabled, hint, placeholderNow }: {
  label: string; value: string; onChange?: (t: string) => void
  disabled?: boolean; hint?: string; placeholderNow?: boolean
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">{label}</label>
      <input type="time" value={value} title={hint} disabled={disabled} readOnly={disabled}
        onChange={e => onChange?.(e.target.value)}
        className={`${TIME} w-full ${disabled ? 'bg-stone-50 text-stone-500 cursor-not-allowed' : ''}`} />
      {placeholderNow && (
        <p className="text-[10px] text-text-muted">Left blank = now, set at sign-off.</p>
      )}
    </div>
  )
}

function StoppageRow({
  stoppage: s, date, now, readOnly, problem, onPatch, onCloseNow, onRemove,
}: {
  stoppage: Stoppage
  date: string
  now: number
  readOnly: boolean
  problem?: string
  onPatch: (p: Partial<Stoppage>) => void
  onCloseNow: () => void
  onRemove: () => void
}) {
  const meta = STOPPAGE_META[s.kind]
  const Icon = KIND_ICON[s.kind] ?? CircleDot
  const open = isOpen(s)
  const mins = stoppageMinutes(s, now)

  return (
    <div className={`rounded-xl border p-2.5 space-y-2 ${open ? 'bg-err/5 border-err/25' : 'bg-stone-50 border-stone-200'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {readOnly ? (
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] font-semibold ${KIND_TONE[s.kind]}`}>
            <Icon size={13} /> {meta?.label ?? s.kind}
          </span>
        ) : (
          <span className={`inline-flex items-center px-1.5 py-1 rounded-lg border ${KIND_TONE[s.kind]}`}>
            <Icon size={14} />
          </span>
        )}

        {!readOnly && (
          <select value={s.kind} onChange={e => onPatch({ kind: e.target.value as StoppageKind })}
            className="px-2 py-1.5 rounded-lg border border-stone-200 bg-white text-[12px] font-medium outline-none focus:border-brand cursor-pointer">
            {STOPPAGE_KINDS.map(k => (
              <option key={k} value={k}>{STOPPAGE_META[k].label}</option>
            ))}
            {/* A row already carrying a retired kind keeps it selectable, or
                opening the dropdown would silently re-file it as something
                else. It cannot be chosen fresh — it is not in STOPPAGE_KINDS. */}
            {isRetiredKind(s.kind) && (
              <option value={s.kind}>{STOPPAGE_META[s.kind].label}</option>
            )}
          </select>
        )}

        <input type="time" value={hhmm(s.startedAt)} disabled={readOnly}
          onChange={e => {
            const iso = timeToIso(e.target.value, s.startedAt, date)
            if (iso) onPatch({ startedAt: iso })
          }}
          className={`${TIME} w-[104px] ${readOnly ? 'bg-stone-50 text-stone-500' : ''}`} />
        <span className="text-[12px] text-text-muted">–</span>

        {open && !readOnly ? (
          <button onClick={onCloseNow}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-err text-white text-[12px] font-semibold hover:opacity-90 transition-opacity">
            <Square size={11} /> End now
          </button>
        ) : (
          <input type="time" value={hhmm(s.endedAt)} disabled={readOnly}
            onChange={e => {
              const iso = timeToIso(e.target.value, s.endedAt ?? s.startedAt, date)
              if (iso) onPatch({ endedAt: iso })
            }}
            className={`${TIME} w-[104px] ${readOnly ? 'bg-stone-50 text-stone-500' : ''}`} />
        )}

        <span className={`text-[11px] font-mono tabular-nums shrink-0 ${open ? 'text-err font-bold' : 'text-stone-500'}`}>
          {open ? `${fmtMin(mins)} · running` : fmtMin(mins)}
        </span>

        {!readOnly && (
          <button onClick={onRemove} title="Remove from my sheet"
            className="ml-auto text-stone-300 hover:text-err p-1 shrink-0">
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {/* Notes */}
      {(meta?.needsNotes || s.notes) && (
        readOnly ? (
          s.notes ? <p className="text-[12px] text-text-muted break-words">{s.notes}</p> : null
        ) : (
          // UNCONTROLLED, deliberately. The write happens on blur so typing is
          // not a round trip per keystroke, and the row itself is already
          // persisted — so the only thing at risk is a note that never reaches
          // blur, not the stoppage. Mirroring `s.notes` into state and syncing
          // it in an effect is the "derive state from props" trap: it cascades
          // a render on every external change. The key carries the persisted
          // note, so a note set from elsewhere (logging from a job card) still
          // lands, and typing cannot remount mid-word because `s.notes` does
          // not move until blur.
          <input
            key={`${s.id}:${s.notes ?? ''}`}
            type="text" defaultValue={s.notes ?? ''}
            onBlur={e => {
              const v = e.target.value
              if (v !== (s.notes ?? '')) onPatch({ notes: v || null })
            }}
            placeholder={NOTE_HINT[s.kind] ?? 'What happened?'}
            className={`${TEXT} ${problem ? 'border-err' : ''}`} />
        )
      )}

      {/* Only set where maintenance later raised a card for this stoppage.
          Nothing on this screen writes it — the capture page does not read the
          maintenance schema at all any more. */}
      {s.jobCardId != null && (
        <p className="text-[10px] text-text-muted flex items-center gap-1">
          <Wrench size={10} /> Job card {s.jobCardId}
        </p>
      )}
      {/* A signed breakdown says so on the row, not only in the panel above —
          the row is where anyone reading the sheet afterwards looks. */}
      {s.kind === 'breakdown' && s.attestation && (
        <p className={`text-[10px] flex items-center gap-1 ${
          s.attestation.verdict === 'confirmed' ? 'text-ok' : 'text-err'
        }`}>
          {s.attestation.verdict === 'confirmed'
            ? <><CheckCircle2 size={10} /> Confirmed by {s.attestation.supervisorName}</>
            : <><X size={10} /> Disputed by {s.attestation.supervisorName}
                {s.attestation.note ? ` — ${s.attestation.note}` : ''}</>}
        </p>
      )}
      {s.kind === 'breakdown' && !s.attestation && (
        <p className="text-[10px] text-warn flex items-center gap-1">
          <Clock size={10} /> Awaiting supervisor confirmation
        </p>
      )}
      {problem && !readOnly && (
        <p className="text-[11px] text-err flex items-center gap-1"><X size={11} /> {problem}</p>
      )}
    </div>
  )
}
