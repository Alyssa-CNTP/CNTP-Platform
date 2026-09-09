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

/**
 * The kinds an operator can log, in the order they are offered.
 *
 * This list is meant to cover EVERYTHING that stops production, because the
 * alternative is not "a shorter list" — it is every unlisted cause arriving as
 * `other` with a free-text note, which is how a stoppage stops being
 * analysable. That is exactly what happened to breakdowns and deep cleans under
 * the old five-value union.
 *
 * So it includes the non-mechanical causes too: the system being down, a power
 * failure, waiting on material from the line upstream, and a quality hold. A
 * line stopped by load-shedding produced nothing, and a KPI that can only
 * explain mechanical stoppages will show that hour as unexplained.
 */
export const STOPPAGE_KINDS = [
  'tea', 'lunch', 'deep_clean',
  'breakdown', 'maintenance',
  'power', 'it_system', 'no_material', 'quality_hold',
  'other',
] as const

/**
 * Kinds that exist in stored data but are no longer offered.
 *
 * `changeover` is retired pending a rebuild of that function. It stays here,
 * and in the database CHECK, because rows already carry it — historic
 * `prod_timesheets.breaks` entries and anything the optional backfill imports.
 * Dropping it from the type outright would make `toStoppage` cast a real row to
 * a kind that does not exist, and `STOPPAGE_META[kind]` would come back
 * undefined on a screen the operator is mid-shift on.
 *
 * Retired means: rendered if present, never offered.
 */
export const RETIRED_STOPPAGE_KINDS = ['changeover'] as const

export const ALL_STOPPAGE_KINDS = [...STOPPAGE_KINDS, ...RETIRED_STOPPAGE_KINDS] as const

export type StoppageKind = typeof ALL_STOPPAGE_KINDS[number]
/** A kind the operator may still choose. */
export type OfferableStoppageKind = typeof STOPPAGE_KINDS[number]

export function isStoppageKind(v: unknown): v is StoppageKind {
  return typeof v === 'string' && (ALL_STOPPAGE_KINDS as readonly string[]).includes(v)
}

/** Is this kind still on offer, or only rendered because a row carries it? */
export function isRetiredKind(k: StoppageKind): boolean {
  return (RETIRED_STOPPAGE_KINDS as readonly string[]).includes(k)
}

/** Where a ledger row came from. `standard` = the scheduled tea/lunch. */
export type StoppageSource = 'operator' | 'standard' | 'maintenance'

/**
 * Who needs to be told, immediately, that the line has stopped.
 *
 * The operator stops the machine, so the operator is the one who knows it
 * stopped and when. This field says who finds out — it is a notification
 * routing rule, not a claim about who logs the stoppage.
 *
 * `null` means nobody is paged: a tea break and a scheduled deep clean are not
 * news, and notifying on them is how the notifications that matter get ignored.
 */
export type NotifyTeam = 'maintenance' | 'it' | 'supervisor'

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
   * Scheduled absence of production (tea, lunch, the Tuesday deep clean,
   * planned maintenance) versus something that went wrong. Planned work can
   * still be downtime — a service stops the line — so this is not the same
   * question as `downtime`.
   */
  planned: boolean
  /**
   * Counts toward the line's downtime KPI.
   *
   * Breaks are not downtime: the shift is designed around them, and counting
   * them would make every shift look 10% broken. Everything that stops
   * production when it was supposed to be running is, including the
   * non-mechanical causes — a line stopped by the system being down produced
   * exactly as little as one stopped by a bearing.
   */
  downtime: boolean
  /** A stoppage of this kind cannot be confirmed without a description. */
  needsNotes: boolean
  /** Who is paged when this is logged. See `NotifyTeam`. */
  notify: NotifyTeam | null
  /**
   * Does a supervisor have to sign this off?
   *
   * Breakdown only. It is the kind most often disputed after the fact, and the
   * one an operator is most exposed on — so a signature protects them as much
   * as it protects the figure. Extending it to every kind would make the
   * signature a reflex, and the one that matters would be signed as
   * thoughtlessly as the rest.
   */
  attested: boolean
  /** Duration pre-filled when the operator logs one after the fact. */
  defaultMinutes: number
}

export const STOPPAGE_META: Record<StoppageKind, StoppageMeta> = {
  tea: {
    label: 'Tea break', short: 'Tea',
    planned: true, downtime: false, needsNotes: false,
    notify: null, attested: false, defaultMinutes: 30,
  },
  lunch: {
    label: 'Lunch', short: 'Lunch',
    planned: true, downtime: false, needsNotes: false,
    notify: null, attested: false, defaultMinutes: 30,
  },
  deep_clean: {
    // Usually the Tuesday morning shift — see `deepCleanDue()`.
    label: 'Deep clean', short: 'Deep clean',
    planned: true, downtime: false, needsNotes: false,
    notify: null, attested: false, defaultMinutes: 60,
  },
  breakdown: {
    label: 'Breakdown', short: 'Breakdown',
    planned: false, downtime: true, needsNotes: true,
    notify: 'maintenance', attested: true, defaultMinutes: 30,
  },
  maintenance: {
    label: 'Planned maintenance', short: 'Maintenance',
    // Planned, but the line is still stopped for it.
    planned: true, downtime: true, needsNotes: true,
    notify: 'maintenance', attested: false, defaultMinutes: 30,
  },
  power: {
    label: 'Power failure', short: 'Power',
    planned: false, downtime: true, needsNotes: true,
    // Electrical and the boiler are maintenance's, load-shedding or not.
    notify: 'maintenance', attested: false, defaultMinutes: 30,
  },
  it_system: {
    label: 'System / IT down', short: 'System',
    planned: false, downtime: true, needsNotes: true,
    // IT, not maintenance. Paging a fitter for a network outage wastes the one
    // person who could have fixed it.
    notify: 'it', attested: false, defaultMinutes: 15,
  },
  no_material: {
    label: 'Waiting for material', short: 'No material',
    planned: false, downtime: true, needsNotes: true,
    // Nothing to fix — an upstream line or the store has to move, so this is
    // the supervisor's to resolve.
    notify: 'supervisor', attested: false, defaultMinutes: 30,
  },
  quality_hold: {
    label: 'Quality hold', short: 'QC hold',
    planned: false, downtime: true, needsNotes: true,
    notify: 'supervisor', attested: false, defaultMinutes: 30,
  },
  other: {
    label: 'Other stoppage', short: 'Other',
    // Deliberately NOT downtime and NOT notified. `other` is the bucket for
    // whatever this list failed to anticipate, so it cannot be trusted to mean
    // the line was down — and a cause nobody named is not a page to anyone.
    // A recurring `other` in the shift reports is the signal to add a kind.
    planned: true, downtime: false, needsNotes: true,
    notify: null, attested: false, defaultMinutes: 15,
  },

  // ── Retired ────────────────────────────────────────────────────────────────
  changeover: {
    label: 'Changeover (retired)', short: 'Changeover',
    planned: true, downtime: false, needsNotes: true,
    notify: null, attested: false, defaultMinutes: 30,
  },
}

/** The kinds that count as downtime. Derived, so the two cannot drift. */
export const DOWNTIME_KINDS: readonly StoppageKind[] =
  ALL_STOPPAGE_KINDS.filter(k => STOPPAGE_META[k].downtime)

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
  /** When the owning team was told. Null = not yet notified. */
  notifiedAt:  string | null
  /**
   * When the operator last called a supervisor to come and confirm this, and
   * how many times they have asked.
   *
   * Null is not the same as zero-and-never-answered: it means nobody was ever
   * called. A report that cannot tell those apart blames the wrong person.
   */
  supervisorRequestedAt: string | null
  supervisorRequestCount: number
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
 * Driven by `STOPPAGE_META[kind].attested`, so the rule lives in one table
 * rather than as a hard-coded kind check that a new kind would quietly bypass.
 * A voided stoppage needs nothing: it has been taken off the sheet.
 */
export function needsAttestation(s: Stoppage): boolean {
  return isLive(s) && !!STOPPAGE_META[s.kind]?.attested && !s.attestation
}

/** Stoppages still waiting on a supervisor, oldest first. */
export function pendingAttestations(stoppages: Stoppage[]): Stoppage[] {
  return stoppages
    .filter(needsAttestation)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

/** Who should be told about this stoppage, if anyone. */
export function notifyTeamFor(s: Stoppage): NotifyTeam | null {
  return STOPPAGE_META[s.kind]?.notify ?? null
}

/**
 * Where an unsigned breakdown is stuck.
 *
 *   `signed`      — done, either way.
 *   `not_called`  — nobody has been asked. The OPERATOR's to fix.
 *   `ignored`     — a supervisor was called and has not signed. THEIRS.
 *   `n/a`         — this kind never needed a signature.
 *
 * The distinction is the whole point of recording the call. Both of the middle
 * two render as "awaiting supervisor" if you only look at the verdict column,
 * and a shift report that cannot tell them apart blames the wrong person — the
 * operator, every time, because they are the one whose sheet is incomplete.
 */
export type AttestationState = 'n/a' | 'signed' | 'not_called' | 'ignored'

export function attestationState(s: Stoppage): AttestationState {
  if (!STOPPAGE_META[s.kind]?.attested || !isLive(s)) return 'n/a'
  if (s.attestation) return 'signed'
  return s.supervisorRequestedAt ? 'ignored' : 'not_called'
}

/**
 * Stoppages whose team has not been told yet.
 *
 * Keyed on `notifiedAt` rather than on "is this new to the component", because
 * a notification you cannot tell you already sent gets sent again on every
 * reload — and a maintenance manager who receives the same breakdown six times
 * stops reading them.
 *
 * The operator is who logs it and who knows when the machine stopped; this is
 * only about who then finds out.
 */
export function pendingNotifications(stoppages: Stoppage[]): Stoppage[] {
  return stoppages.filter(s => isLive(s) && !s.notifiedAt && notifyTeamFor(s) !== null)
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
      supervisorRequestedAt: null, supervisorRequestCount: 0,
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
