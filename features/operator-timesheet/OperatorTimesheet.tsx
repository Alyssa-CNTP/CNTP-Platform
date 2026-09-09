'use client'

/**
 * The operator timesheet — a live tracker, not a form filled in at sign-off.
 *
 * ── What changed, and why the shape had to change with it ────────────────────
 *
 * The previous component held every stoppage in React state and wrote the lot
 * once, when the operator tapped "Confirm timesheet". Two consequences:
 *
 *   * ANY re-derive lost them. The load effect depended on `operatorName`, and
 *     the capture page feeds it the sign-off name INPUT — so typing a name
 *     re-ran the effect, which reset the list to the standard tea/lunch
 *     schedule. Start and end were re-derived to the same values, so the sheet
 *     looked right while every logged stoppage was gone. That is precisely the
 *     floor's report: "start and end are fine, the other stoppages don't save."
 *   * Nothing could be tracked. A stoppage that only exists at sign-off cannot
 *     prompt anybody, cannot be matched to a maintenance card that is happening
 *     NOW, and cannot become a KPI.
 *
 * So every edit here writes its own row immediately (`saveStoppage`, per-row
 * upsert on a stable uuid). Reloading the page mid-shift shows the same sheet.
 * Nothing depends on the operator reaching sign-off for the data to exist, and
 * nothing re-derives over what is already there.
 *
 * `queue()` is the pattern to keep: optimistic local state, then a write, and
 * on failure a visible banner rather than a silent revert. An operator who has
 * just logged a two-hour breakdown must not be told it saved when it did not.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Clock, Coffee, UtensilsCrossed, Sparkles, Wrench, ArrowLeftRight, CircleDot,
  Plus, Trash2, CheckCircle2, Loader2, Info, AlertTriangle, Play, Square,
  Activity, X, RefreshCw,
} from 'lucide-react'
import {
  STOPPAGE_KINDS, STOPPAGE_META, isLive, isOpen, stoppageMinutes,
  workedMinutes, downtimeMinutes, validateStoppages, deepCleanDue,
  pendingAttestations, pendingNotifications,
  type Stoppage, type StoppageKind, type SupervisorVerdict,
} from '@/lib/core/timesheet/stoppages'
import {
  loadStoppages, saveStoppage, voidStoppage, seedScheduledStoppages,
  loadTimesheet, confirmTimesheet, saveTimesheetNote, loadLineJobCards,
  loadLineMachines, isCardOpen, attestStoppage, reportBreakdown,
  type StoppageScope, type LineJobCard,
} from './db'
import { getMySignatureStatus, type MySignatureStatus } from '@/lib/production/employee-signature'
import { derivePrompts, panelCards, type PromptKind, type TimesheetPrompt } from './prompts'
import { primaryAreaForSection, hasAreaMapping } from './areas'

// ── formatting ───────────────────────────────────────────────────────────────

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
  changeover: ArrowLeftRight, other: CircleDot,
}

/** Chip colour per kind. Downtime reads red; planned time reads neutral. */
const KIND_TONE: Record<StoppageKind, string> = {
  tea:         'bg-info/10 text-info border-info/25',
  lunch:       'bg-warn/10 text-warn border-warn/25',
  deep_clean:  'bg-brand/10 text-brand border-brand/25',
  breakdown:   'bg-err/10 text-err border-err/25',
  maintenance: 'bg-err/10 text-err border-err/25',
  changeover:  'bg-stone-100 text-stone-600 border-stone-300',
  other:       'bg-stone-100 text-stone-600 border-stone-300',
}

const CARD  = 'bg-white border border-stone-200 rounded-2xl'
const LABEL = 'text-[11px] font-semibold text-stone-500 uppercase tracking-wide'
const TIME  = 'px-2.5 py-2 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand tabular-nums'
const TEXT  = 'w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand'

/** Quick-log buttons, in the order an operator reaches for them. */
const QUICK: { kind: StoppageKind; label: string }[] = [
  { kind: 'breakdown',   label: 'Breakdown' },
  { kind: 'maintenance', label: 'Maintenance' },
  { kind: 'deep_clean',  label: 'Deep clean' },
  { kind: 'changeover',  label: 'Changeover' },
  { kind: 'tea',         label: 'Tea' },
  { kind: 'lunch',       label: 'Lunch' },
  { kind: 'other',       label: 'Other' },
]

// How often to re-read the line's maintenance cards. 45s: fast enough that a
// breakdown reaches the operator while it is still happening, slow enough that
// a tablet on factory wifi is not polling a schema it mostly does not need.
const CARD_POLL_MS = 45_000

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

  const [cards, setCards]       = useState<LineJobCard[]>([])
  const [machines, setMachines] = useState<string[]>([])
  const [dismissedCards, setDismissedCards] = useState<ReadonlySet<number>>(new Set())
  const [dismissedKinds, setDismissedKinds] = useState<ReadonlySet<PromptKind>>(new Set())
  const [showCards, setShowCards] = useState(false)

  // Supervisor attestation
  const [sigStatus, setSigStatus] = useState<MySignatureStatus | null>(null)
  const [signing, setSigning]     = useState<string | null>(null)
  const [disputeFor, setDisputeFor] = useState<string | null>(null)
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
      } catch (e: any) {
        if (!alive) return
        setLoadError(e?.message ?? 'Could not load your timesheet.')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [sessionId])

  // ── Maintenance cards, polled ─────────────────────────────────────────────
  const refreshCards = useCallback(async () => {
    if (!hasAreaMapping(sectionId)) return
    try {
      // Everything raised since the start of the run day, plus anything still open.
      const since = new Date(`${date}T00:00:00`).toISOString()
      setCards(await loadLineJobCards(sectionId, since))
    } catch (e) {
      // A maintenance read failing must not disturb capture — the timesheet
      // still works, it just stops offering cards. §3: the adapter is total.
      console.warn('[operator-timesheet] job cards unavailable:', e)
    }
  }, [sectionId, date])

  useEffect(() => {
    if (locked) return
    refreshCards()
    const t = setInterval(refreshCards, CARD_POLL_MS)
    return () => clearInterval(t)
  }, [refreshCards, locked])

  useEffect(() => { loadLineMachines(sectionId).then(setMachines) }, [sectionId])

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
    } catch (e: any) {
      setSaveError(e?.message ?? 'Could not save that stoppage.')
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
    })
  }, [queue, sectionId])

  const closeAt = useCallback((id: string, iso: string) => patch(id, { endedAt: iso }), [patch])

  const remove = useCallback(async (id: string) => {
    setStoppages(prev => prev.map(s => s.id === id ? { ...s, voidedAt: new Date().toISOString() } : s))
    try {
      await voidStoppage(id, operatorName, 'Removed by the operator')
      setSaveError(null)
    } catch (e: any) {
      setSaveError(e?.message ?? 'Could not remove that stoppage.')
    }
  }, [operatorName])

  // ── Telling maintenance ───────────────────────────────────────────────────
  //
  // Fires for any live breakdown with no `notified_at` stamp — which is the
  // de-dupe: the stamp is written only after the route accepts, so a failure
  // retries on the next render and a success never sends twice, across reloads
  // and across two operators on the same session.
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
      reportBreakdown({
        stoppageId:   s.id,
        sectionId,
        machine:      s.machine,
        area:         s.area,
        description:  s.notes ?? '',
        operatorName,
        startedAt:    s.startedAt,
        jobCardId:    s.jobCardId,
      }).then(ok => {
        if (ok) {
          setStoppages(prev => prev.map(x =>
            x.id === s.id ? { ...x, notifiedAt: new Date().toISOString() } : x))
        }
        // Released either way: on failure the next render retries, which is the
        // behaviour we want when the notification service is briefly down.
        notifying.current.delete(s.id)
      })
    }
  }, [stoppages, locked, sectionId, operatorName])

  // ── Derived ───────────────────────────────────────────────────────────────

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
    cards, stoppages, date, shift,
    dismissedCardIds: dismissedCards, dismissedKinds, atSignOff,
  }), [cards, stoppages, date, shift, dismissedCards, dismissedKinds, atSignOff])

  const openCardCount = cards.filter(isCardOpen).length
  const awaiting = useMemo(() => pendingAttestations(stoppages), [stoppages])

  useEffect(() => {
    cb.current.onPendingAttestationsChange?.(awaiting.length)
  }, [awaiting.length])

  // ── Supervisor signs ──────────────────────────────────────────────────────

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
    } catch (e: any) {
      setSaveError(e?.message ?? 'Could not record your signature.')
    } finally {
      setSigning(null)
    }
  }, [sigStatus])

  // ── Prompt actions ────────────────────────────────────────────────────────

  const actOnPrompt = useCallback((p: TimesheetPrompt) => {
    switch (p.kind) {
      case 'log_breakdown': {
        const c = p.card!
        startNow(c.workflow === 'breakdown' ? 'breakdown' : 'maintenance', {
          // Start from when maintenance says it started, not from now — the
          // line stopped when the machine did, not when the operator noticed
          // the prompt.
          startedAt: c.startedAt ?? c.raisedAt,
          notes:     `${c.cardNo}: ${c.description}`,
          machine:   c.machine,
          area:      c.area,
          jobCardId: c.id,
          source:    'maintenance',
        })
        break
      }
      case 'close_stoppage':
        if (p.stoppageId && p.closeAt) closeAt(p.stoppageId, p.closeAt)
        break
      case 'log_deep_clean':
        addClosed('deep_clean')
        setDismissedKinds(prev => new Set([...prev, 'log_deep_clean' as PromptKind]))
        break
      case 'still_open':
        if (p.stoppageId) closeAt(p.stoppageId, new Date().toISOString())
        break
    }
  }, [startNow, closeAt, addClosed])

  const dismissPrompt = useCallback((p: TimesheetPrompt) => {
    if (p.card) setDismissedCards(prev => new Set([...prev, p.card!.id]))
    else setDismissedKinds(prev => new Set([...prev, p.kind]))
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
    } catch (e: any) {
      // NOT confirmed. The previous version set confirmed in a `finally`, so a
      // failed write still showed a green tick over data that was never saved.
      setSaveError(e?.message ?? 'Could not confirm your timesheet. Try again.')
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
              <div className="flex items-center gap-2">
                <button onClick={() => actOnPrompt(p)}
                  className={`flex-1 py-2 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 ${
                    p.urgency === 'high' ? 'bg-err' : 'bg-info'
                  }`}>
                  {p.action}
                </button>
                <button onClick={() => dismissPrompt(p)} title="Not on my line"
                  className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[12px] text-stone-500 hover:text-text transition-colors">
                  Not mine
                </button>
              </div>
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
                <p className="text-[11px] text-warn flex items-center gap-1.5">
                  <Clock size={11} /> Waiting for a supervisor
                  {s.notifiedAt ? ' · maintenance has been notified' : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Quick log ────────────────────────────────────────────────────── */}
      {!readOnly && (
        <div className={`${CARD} p-4 space-y-3`}>
          <div className="flex items-center justify-between">
            <span className={LABEL}>Log a stoppage</span>
            <span className="text-[11px] text-text-muted">starts now · end it when you’re back</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {QUICK.map(({ kind, label }) => {
              const Icon = KIND_ICON[kind]
              return (
                <button key={kind} onClick={() => startNow(kind)}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-[12px] font-semibold transition-opacity hover:opacity-80 ${KIND_TONE[kind]}`}>
                  <Icon size={13} /> {label}
                </button>
              )
            })}
            <button onClick={() => addClosed('other')}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-dashed border-stone-300 text-[12px] font-medium text-stone-500 hover:border-brand hover:text-brand transition-colors">
              <Plus size={14} /> Past stoppage
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
              machines={machines}
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
            } catch (e: any) {
              setSaveError(e?.message ?? 'Could not save your note.')
            }
          }}
          placeholder="e.g. Tower ran slow all morning after the belt change…"
          className={`${TEXT} resize-none disabled:bg-stone-50 disabled:text-stone-500`} />
      </div>

      {/* ── Maintenance on this line ─────────────────────────────────────── */}
      {hasAreaMapping(sectionId) && cards.length > 0 && (
        <div className={`${CARD} p-4 space-y-2`}>
          <button onClick={() => setShowCards(v => !v)}
            className="w-full flex items-center justify-between">
            <span className={`${LABEL} flex items-center gap-1.5`}>
              <Wrench size={13} /> Maintenance on this line
            </span>
            <span className="flex items-center gap-2 text-[11px] text-text-muted">
              {openCardCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-err/10 text-err font-semibold">
                  {openCardCount} open
                </span>
              )}
              {showCards ? 'hide' : 'show'}
            </span>
          </button>
          {showCards && (
            <div className="space-y-1.5 pt-1">
              {panelCards(cards).map(c => (
                <div key={c.id} className="flex items-start gap-2 px-3 py-2 rounded-xl bg-stone-50 border border-stone-200">
                  <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${isCardOpen(c) ? 'bg-err' : 'bg-ok'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-text truncate">
                      {c.cardNo} · {c.machine || c.area}
                    </p>
                    <p className="text-[11px] text-text-muted truncate">{c.description}</p>
                  </div>
                  <span className="text-[10px] font-mono text-text-muted shrink-0">
                    {hhmm(c.raisedAt)}
                  </span>
                </div>
              ))}
              {!readOnly && (
                <button onClick={refreshCards}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] text-stone-500 hover:text-brand transition-colors">
                  <RefreshCw size={12} /> Refresh
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
  stoppage: s, date, now, readOnly, machines, problem, onPatch, onCloseNow, onRemove,
}: {
  stoppage: Stoppage
  date: string
  now: number
  readOnly: boolean
  machines: string[]
  problem?: string
  onPatch: (p: Partial<Stoppage>) => void
  onCloseNow: () => void
  onRemove: () => void
}) {
  const meta = STOPPAGE_META[s.kind]
  const Icon = KIND_ICON[s.kind] ?? CircleDot
  const open = isOpen(s)
  const mins = stoppageMinutes(s, now)

  // Local mirror so typing a note is not a round trip per keystroke; the write
  // happens on blur. The row itself is already persisted, so a note that never
  // reaches blur is the only thing at risk — and the row is not lost with it.
  const [noteDraft, setNoteDraft] = useState(s.notes ?? '')
  useEffect(() => { setNoteDraft(s.notes ?? '') }, [s.notes])

  const fromCard = s.jobCardId != null

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
          </select>
        )}

        <input type="time" value={hhmm(s.startedAt)} disabled={readOnly}
          onChange={e => {
            const iso = timeToIso(e.target.value, s.startedAt, date)
            if (iso) onPatch({ startedAt: iso })
          }}
          className={`${TIME} w-[86px] ${readOnly ? 'bg-stone-50 text-stone-500' : ''}`} />
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
            className={`${TIME} w-[86px] ${readOnly ? 'bg-stone-50 text-stone-500' : ''}`} />
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

      {/* Machine — the per-machine KPI has to be asked for, not guessed. */}
      {meta?.needsMachine && !readOnly && (
        <div className="flex items-center gap-2">
          {machines.length > 0 ? (
            <select value={s.machine ?? ''} onChange={e => onPatch({ machine: e.target.value || null })}
              className="flex-1 px-2.5 py-2 rounded-lg border border-stone-200 bg-white text-[12px] outline-none focus:border-brand cursor-pointer">
              <option value="">Which machine? (optional)</option>
              {machines.map(m => <option key={m} value={m}>{m}</option>)}
              {s.machine && !machines.includes(s.machine) && (
                <option value={s.machine}>{s.machine}</option>
              )}
            </select>
          ) : (
            <input type="text" value={s.machine ?? ''} onChange={e => onPatch({ machine: e.target.value || null })}
              placeholder="Which machine?" className={TEXT} />
          )}
        </div>
      )}
      {meta?.needsMachine && readOnly && s.machine && (
        <p className="text-[11px] text-text-muted flex items-center gap-1.5">
          <Wrench size={11} /> {s.machine}
        </p>
      )}

      {/* Notes */}
      {(meta?.needsNotes || s.notes) && (
        readOnly ? (
          s.notes ? <p className="text-[12px] text-text-muted break-words">{s.notes}</p> : null
        ) : (
          <input
            type="text" value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
            onBlur={() => { if (noteDraft !== (s.notes ?? '')) onPatch({ notes: noteDraft || null }) }}
            placeholder={
              s.kind === 'breakdown' ? 'What broke, and what stopped?'
                : s.kind === 'maintenance' ? 'What was worked on?'
                : s.kind === 'changeover' ? 'What changed over?'
                : 'What happened?'
            }
            className={`${TEXT} ${problem ? 'border-err' : ''}`} />
        )
      )}

      {fromCard && (
        <p className="text-[10px] text-text-muted flex items-center gap-1">
          <Wrench size={10} /> Linked to maintenance job card
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
