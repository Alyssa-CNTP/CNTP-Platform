/**
 * Operator timesheet stoppages — the pure core.
 *
 * A "stoppage" is any window inside a shift where the operator was not
 * producing: the scheduled tea and lunch, the Tuesday deep clean, a breakdown,
 * planned maintenance, a grade/variant changeover, or anything else they log.
 *
 * Everything here is pure — no React, no I/O — so the arithmetic that decides
 * an operator's paid hours and a machine's downtime can be pinned by tests
 * rather than inferred from a screen. See ARCHITECTURE.md §2.
 *
 * The two rules worth reading before changing anything:
 *
 *   * An OPEN stoppage (no end) is measured to `now`, never treated as zero.
 *     The tracker is live: a breakdown exists on the record from the moment it
 *     starts, and it has to already show the time it is costing. Reading an
 *     open stoppage as zero is what would let a two-hour breakdown sit on the
 *     screen looking free.
 *
 *   * Overlapping stoppages are MERGED before being subtracted. The previous
 *     implementation summed each break's overlap with the shift independently,
 *     so a breakdown that ran straight through lunch subtracted the lunch
 *     twice and could drive worked-minutes below the real figure — on a long
 *     enough overlap, to zero. Merging is not a refinement of that; it is the
 *     difference between an operator being paid for their shift and not.
 */

// ── Kinds ────────────────────────────────────────────────────────────────────

export const STOPPAGE_KINDS = [
  'tea', 'lunch', 'deep_clean', 'breakdown', 'maintenance', 'changeover', 'other',
] as const

export type StoppageKind = typeof STOPPAGE_KINDS[number]

export function isStoppageKind(v: unknown): v is StoppageKind {
  return typeof v === 'string' && (STOPPAGE_KINDS as readonly string[]).includes(v)
}

/** Where a ledger row came from. `standard` = the scheduled tea/lunch. */
export type StoppageSource = 'operator' | 'standard' | 'maintenance'

/**
 * A supervisor's verdict on a breakdown the operator logged.
 *
 * `disputed` is a recorded verdict, not the absence of one. A supervisor who
 * believes the line was not actually down must be able to say so on the
 * record — otherwise an unsigned breakdown is ambiguous between "disputed" and
 * "nobody has looked yet", and neither the operator nor the KPI can tell.
 */
export type SupervisorVerdict = 'confirmed' | 'disputed'

export interface Attestation {
  verdict:      SupervisorVerdict
  supervisorName: string
  employeeId:   string | null
  signedAt:     string
  note:         string | null
}

export interface StoppageMeta {
  label: string
  /** Short form for a chip or a pill. */
  short: string
  /**
   * Planned absence of production (tea, lunch, deep clean, changeover) versus
   * unplanned machine failure. Only the unplanned kinds are machine downtime —
   * a deep clean every Tuesday morning is not a breakdown, and counting it as
   * one makes the availability figure meaningless.
   */
  planned: boolean
  /** Counts toward machine downtime KPIs. */
  downtime: boolean
  /** A stoppage of this kind cannot be confirmed without a description. */
  needsNotes: boolean
  /** Offer the machine picker — the KPI is per machine, so it has to be asked. */
  needsMachine: boolean
  /** Duration pre-filled when the operator logs one with an end time. */
  defaultMinutes: number
}

export const STOPPAGE_META: Record<StoppageKind, StoppageMeta> = {
  tea: {
    label: 'Tea break', short: 'Tea',
    planned: true, downtime: false, needsNotes: false, needsMachine: false, defaultMinutes: 30,
  },
  lunch: {
    label: 'Lunch', short: 'Lunch',
    planned: true, downtime: false, needsNotes: false, needsMachine: false, defaultMinutes: 30,
  },
  deep_clean: {
    // Usually the Tuesday morning shift — see `deepCleanDue()`.
    label: 'Deep clean', short: 'Deep clean',
    planned: true, downtime: false, needsNotes: false, needsMachine: true, defaultMinutes: 60,
  },
  breakdown: {
    label: 'Breakdown', short: 'Breakdown',
    planned: false, downtime: true, needsNotes: true, needsMachine: true, defaultMinutes: 30,
  },
  maintenance: {
    label: 'Maintenance', short: 'Maintenance',
    planned: false, downtime: true, needsNotes: true, needsMachine: true, defaultMinutes: 30,
  },
  changeover: {
    label: 'Changeover', short: 'Changeover',
    planned: true, downtime: false, needsNotes: true, needsMachine: false, defaultMinutes: 30,
  },
  other: {
    label: 'Other stoppage', short: 'Other',
    planned: true, downtime: false, needsNotes: true, needsMachine: false, defaultMinutes: 15,
  },
}

/** The kinds that count as machine downtime. Derived, so the two can't drift. */
export const DOWNTIME_KINDS: readonly StoppageKind[] =
  STOPPAGE_KINDS.filter(k => STOPPAGE_META[k].downtime)

// ── The record ───────────────────────────────────────────────────────────────

/**
 * One stoppage. Mirrors `production.timesheet_stoppages`, minus the columns
 * only the database cares about. `id` is a stable client-minted uuid so the
 * write path is a per-row upsert and never a delete-then-insert
 * (ARCHITECTURE.md §4).
 */
export interface Stoppage {
  id:         string
  kind:       StoppageKind
  startedAt:  string          // ISO
  endedAt:    string | null   // ISO, or null while it is still running
  notes:      string | null
  machine:    string | null
  area:       string | null
  jobCardId:  number | null
  source:     StoppageSource
  /** Voided rows stay on the record and stop counting. Never delete. */
  voidedAt:   string | null
  /** The supervisor's signature on a breakdown. Null until one is applied. */
  attestation: Attestation | null
  /** When the maintenance manager was told. Null = not yet notified. */
  notifiedAt:  string | null
}

const MS_PER_MIN = 60_000

function ms(iso: string | null | undefined): number {
  if (!iso) return NaN
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? NaN : t
}

/** A stoppage that still counts: not voided, and with a usable start. */
export function isLive(s: Stoppage): boolean {
  return !s.voidedAt && Number.isFinite(ms(s.startedAt))
}

/** Still running — logged, no end recorded yet. */
export function isOpen(s: Stoppage): boolean {
  return isLive(s) && !s.endedAt
}

/**
 * How long a stoppage lasted, in minutes.
 *
 * An open stoppage is measured from its start to `now`. A voided one is zero.
 * Never negative: an end before the start is a typo, not negative time.
 */
export function stoppageMinutes(s: Stoppage, now: number = Date.now()): number {
  if (!isLive(s)) return 0
  const start = ms(s.startedAt)
  const end = s.endedAt ? ms(s.endedAt) : now
  if (!Number.isFinite(end)) return 0
  return Math.max(0, Math.round((end - start) / MS_PER_MIN))
}

// ── Interval merging ─────────────────────────────────────────────────────────

export interface Interval { start: number; end: number }

/**
 * Merge overlapping and touching intervals into a disjoint, ordered set.
 *
 * This is the fix for the double-subtraction described at the top of the file.
 * Touching intervals are merged too (`end === start`), so a lunch that runs
 * 13:00–13:30 and a breakdown 13:30–14:00 come back as one 13:00–14:00 block
 * rather than two — the operator was off the line continuously.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const valid = intervals
    .filter(i => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .sort((a, b) => a.start - b.start)

  const out: Interval[] = []
  for (const i of valid) {
    const last = out[out.length - 1]
    if (last && i.start <= last.end) {
      if (i.end > last.end) last.end = i.end
    } else {
      out.push({ start: i.start, end: i.end })
    }
  }
  return out
}

/**
 * The stoppage time that falls INSIDE [shiftStart, shiftEnd], in minutes,
 * counting any moment the operator was off the line exactly once.
 *
 * Clipping to the window means a scheduled lunch at 13:00 cannot subtract from
 * someone who left at 12:30, and the result never goes negative.
 */
export function stoppageMinutesInWindow(
  stoppages: Stoppage[],
  shiftStart: string | null,
  shiftEnd: string | null,
  now: number = Date.now(),
): number {
  const startMs = ms(shiftStart)
  const endMs = ms(shiftEnd)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0

  const clipped: Interval[] = []
  for (const s of stoppages) {
    if (!isLive(s)) continue
    const bs = ms(s.startedAt)
    const be = s.endedAt ? ms(s.endedAt) : now
    if (!Number.isFinite(be)) continue
    const start = Math.max(bs, startMs)
    const end = Math.min(be, endMs)
    if (end > start) clipped.push({ start, end })
  }

  const total = mergeIntervals(clipped)
    .reduce((sum, i) => sum + (i.end - i.start), 0)
  return total / MS_PER_MIN
}

/**
 * Worked minutes = the shift span minus the merged stoppage time inside it.
 *
 * Rounded once, at the end. Rounding each stoppage first and then summing
 * drifts by a minute per stoppage, which is how two screens showing "the same"
 * total end up disagreeing.
 */
export function workedMinutes(
  shiftStart: string | null,
  shiftEnd: string | null,
  stoppages: Stoppage[],
  now: number = Date.now(),
): number {
  const startMs = ms(shiftStart)
  const endMs = ms(shiftEnd)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  const span = (endMs - startMs) / MS_PER_MIN
  if (!(span > 0)) return 0
  const stopped = stoppageMinutesInWindow(stoppages, shiftStart, shiftEnd, now)
  return Math.max(0, Math.round(span - stopped))
}

/**
 * Total downtime (breakdown + maintenance only) across a set of stoppages.
 *
 * A DISPUTED breakdown is excluded: a supervisor has signed to say the line was
 * not down, and counting it anyway would make the signature decorative.
 * An UNSIGNED one is included — downtime is real until somebody says otherwise,
 * and suppressing it until a signature arrives would let the figure be improved
 * by nobody getting round to the paperwork.
 */
export function downtimeMinutes(stoppages: Stoppage[], now: number = Date.now()): number {
  return stoppages
    .filter(s => isLive(s) && STOPPAGE_META[s.kind]?.downtime)
    .filter(s => s.attestation?.verdict !== 'disputed')
    .reduce((sum, s) => sum + stoppageMinutes(s, now), 0)
}

// ── Supervisor attestation ───────────────────────────────────────────────────

/**
 * Does this stoppage need a supervisor's signature?
 *
 * Only breakdowns. They are the one kind that moves a number somebody is
 * measured on — time out of production KPIs, downtime against a named machine —
 * so they are the one kind that is not self-certifying. Tea, lunch, a deep
 * clean and a changeover are scheduled or self-evident; making a supervisor
 * sign for a tea break would turn the signature into a rubber stamp and the
 * one that matters would be signed as reflexively as the rest.
 *
 * A voided breakdown needs nothing: it has been taken off the sheet.
 */
export function needsAttestation(s: Stoppage): boolean {
  return isLive(s) && s.kind === 'breakdown' && !s.attestation
}

/** Breakdowns still waiting on a supervisor, oldest first. */
export function pendingAttestations(stoppages: Stoppage[]): Stoppage[] {
  return stoppages
    .filter(needsAttestation)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

/**
 * Breakdowns the maintenance manager has not been told about yet.
 *
 * Keyed on `notifiedAt` rather than on "is this new to the component", because
 * a notification you cannot tell you already sent gets sent again on every
 * reload — and a maintenance manager who receives the same breakdown six times
 * stops reading them.
 */
export function pendingNotifications(stoppages: Stoppage[]): Stoppage[] {
  return stoppages.filter(s => isLive(s) && s.kind === 'breakdown' && !s.notifiedAt)
}

// ── The scheduled breaks ─────────────────────────────────────────────────────

/**
 * The standard tea/lunch schedule per shift, as local (SAST) times on the run
 * date. Operators confirm rather than punch these — the sheet is pre-filled
 * with what the shift is supposed to be and they adjust what actually happened.
 *
 * Morning runs 07h00–16h00, afternoon 16h00–01h00 (ARCHITECTURE.md §9).
 * 'night' is a legacy alias for 'afternoon' and must keep resolving.
 */
export const SCHEDULED_BREAKS: Record<string, { kind: StoppageKind; localTime: string; minutes: number }[]> = {
  morning: [
    { kind: 'tea',   localTime: '10:30', minutes: 30 },
    { kind: 'lunch', localTime: '13:00', minutes: 30 },
  ],
  afternoon: [
    { kind: 'tea',   localTime: '19:00', minutes: 15 },
    { kind: 'lunch', localTime: '21:00', minutes: 60 },
  ],
  night: [
    { kind: 'tea',   localTime: '19:00', minutes: 15 },
    { kind: 'lunch', localTime: '21:00', minutes: 60 },
  ],
}

/**
 * Build the scheduled breaks for a shift as concrete stoppages.
 *
 * `mkId` is injected rather than called from here so core stays pure and the
 * ids are reproducible in tests. `toIso` converts a local `YYYY-MM-DDTHH:mm`
 * to ISO — also injected, because the conversion depends on the runtime's
 * timezone and core must not silently adopt the server's.
 */
export function scheduledStoppages(
  shift: string | undefined,
  date: string | undefined,
  mkId: () => string,
  toIso: (localDateTime: string) => string | null,
): Stoppage[] {
  if (!shift || !date) return []
  const out: Stoppage[] = []
  for (const { kind, localTime, minutes } of (SCHEDULED_BREAKS[shift] ?? [])) {
    const startIso = toIso(`${date}T${localTime}`)
    if (!startIso) continue
    const startMs = ms(startIso)
    if (!Number.isFinite(startMs)) continue
    out.push({
      id: mkId(),
      kind,
      startedAt: startIso,
      endedAt: new Date(startMs + minutes * MS_PER_MIN).toISOString(),
      notes: null, machine: null, area: null, jobCardId: null,
      source: 'standard', voidedAt: null,
      attestation: null, notifiedAt: null,
    })
  }
  return out
}

// ── The Tuesday deep clean ───────────────────────────────────────────────────

/**
 * Is a deep clean expected on this shift?
 *
 * The machines are deep-cleaned on the Tuesday morning shift. This only
 * decides whether to PROMPT — it never creates the stoppage, and it never
 * blocks a sign-off. A prompt that became a requirement would be the
 * hidden-field validation failure all over again: a week where the clean
 * happened on Wednesday would leave operators unable to submit.
 *
 * `date` is the production run date (`YYYY-MM-DD`), parsed as a plain calendar
 * date rather than through the local timezone — `new Date('2026-09-08')` is
 * UTC midnight, which is the previous day in some zones and would move the
 * prompt to Monday.
 */
export function deepCleanDue(date: string | undefined, shift: string | undefined): boolean {
  if (!date || shift !== 'morning') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return false
  return d.getUTCDay() === 2  // Tuesday
}

// ── Legacy snapshot shape ────────────────────────────────────────────────────

/**
 * The `prod_timesheets.breaks` jsonb shape, still read by the shift report, the
 * production order detail and supervisor analytics.
 *
 * The ledger is authoritative; this is a derived snapshot written at confirm so
 * those three readers keep working unchanged. `machine` and `jobCardId` are
 * carried through so the snapshot is not lossier than it needs to be, but
 * nothing should query the snapshot for them — that is what the ledger is for.
 */
export interface TimesheetBreakSnapshot {
  type:       StoppageKind
  start:      string
  end:        string
  notes?:     string
  machine?:   string
  jobCardId?: number
  /** Present on an attested breakdown, so the shift report can show who signed. */
  attestedBy?: string
  verdict?:    SupervisorVerdict
}

/**
 * Project live stoppages into the snapshot shape.
 *
 * Voided rows are dropped — they are visible in the ledger, which is where a
 * correction belongs. An OPEN stoppage is closed off at `endFallback` (the
 * sign-off time), because the snapshot has no way to say "still running" and
 * writing the start as the end would record it as zero.
 */
export function toSnapshotBreaks(
  stoppages: Stoppage[],
  endFallback: string,
): TimesheetBreakSnapshot[] {
  return stoppages
    .filter(isLive)
    .slice()
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map(s => {
      const snap: TimesheetBreakSnapshot = {
        type:  s.kind,
        start: s.startedAt,
        end:   s.endedAt ?? endFallback,
      }
      if (s.notes?.trim()) snap.notes = s.notes.trim()
      if (s.machine) snap.machine = s.machine
      if (s.jobCardId != null) snap.jobCardId = s.jobCardId
      if (s.attestation) {
        snap.attestedBy = s.attestation.supervisorName
        snap.verdict = s.attestation.verdict
      }
      return snap
    })
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface StoppageProblem {
  id:      string
  message: string
}

/**
 * What stops a timesheet being confirmed.
 *
 * Deliberately narrow. A stoppage kind that requires a description is checked
 * only when a stoppage of that kind is actually on the sheet, so the check sits
 * behind the same condition as the field that collects it (ARCHITECTURE.md §4 —
 * the recurring class behind PRs #722/#752/#756). An open stoppage is NOT a
 * problem: sign-off closes it at the shift end.
 */
export function validateStoppages(stoppages: Stoppage[]): StoppageProblem[] {
  const problems: StoppageProblem[] = []
  for (const s of stoppages) {
    if (!isLive(s)) continue
    const meta = STOPPAGE_META[s.kind]
    if (!meta) continue
    if (meta.needsNotes && !s.notes?.trim()) {
      problems.push({ id: s.id, message: `${meta.label} needs a short description.` })
    }
    if (s.endedAt) {
      const start = ms(s.startedAt)
      const end = ms(s.endedAt)
      if (Number.isFinite(start) && Number.isFinite(end) && end < start) {
        problems.push({ id: s.id, message: `${meta.label} ends before it starts.` })
      }
    }
  }
  return problems
}
