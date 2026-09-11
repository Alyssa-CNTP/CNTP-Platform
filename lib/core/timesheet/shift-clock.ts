/**
 * The shift clock — when an operator was signed in, as pure arithmetic.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A timesheet's shift START was anchored to the first `capture_activity`
 * heartbeat, and every one of those is written by the capture screen. So the
 * clock did not start when the operator started: it started when they first
 * opened `/production/capture/[section]`, and only then. An operator who did
 * the 07h00 handover, walked the line, cleared a blockage and reached the
 * tablet at 08h40 had a timesheet that began at 08h40 — and one who never
 * reached Sign-off had no start at all, because the fallback was the earliest
 * SCHEDULED break, which reads 10:30 on a morning shift.
 *
 * That is the floor's report, in their words: "timesheets only start working
 * when I go into the capture page and the sign off module."
 *
 * The operator's actual clock is their LOGIN. They sign in at the start of
 * their shift and sign out at the end of it, and that is true whichever screen
 * they happen to use in between — it is not capture's fact to own. So presence
 * becomes its own ledger (`production.operator_shift_clock`), written from the
 * app shell, and the timesheet READS it instead of inferring one.
 *
 * ── The shape: intervals, not a single row ──────────────────────────────────
 *
 * One login/logout pair is one INTERVAL. A production day can hold several —
 * the tablet is locked and reopened, the 60-minute inactivity sign-out fires
 * while the operator is inside a machine, they sign out for an appointment and
 * come back. Storing "the" shift start as a single mutable column would make
 * each of those overwrite the last, which is the read-modify-write failure
 * ARCHITECTURE.md §1B is about, applied to someone's paid hours.
 *
 * So: append an interval per login, close it on logout, and derive.
 *
 *   shift start = the FIRST interval's open   — never moves once set
 *   shift end   = the LAST interval's close   — null while they are still on
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 *
 * It does not subtract the gaps BETWEEN intervals from worked time. Deductions
 * are the stoppage ledger's job (`stoppages.ts`) and the operator confirms
 * them; a gap is evidence, not a verdict — an inactivity sign-out at 11h00
 * followed by a sign-in at 11h02 is two minutes of nothing happening, not a
 * break. `awayGaps()` surfaces them so a supervisor can see and log one, and
 * that is as far as an automatic inference should go. Anything stronger and
 * the floor gets docked for a flat tablet battery.
 *
 * Pure — no React, no I/O, no `Date.now()` except as an injected default. See
 * ARCHITECTURE.md §2.
 */

const MS_PER_MIN = 60_000

// ── Which production run a moment belongs to ─────────────────────────────────

/** The 16h00–01h00 shift is stored as 'afternoon'; 'night' is a legacy alias. */
export type RunShift = 'morning' | 'afternoon'

export interface RunSlot {
  /** `YYYY-MM-DD` — the day the RUN started, not the wall-clock date. */
  date:  string
  shift: RunShift
}

/**
 * The production run day and shift a timestamp belongs to — `productionDayFor()`
 * of ARCHITECTURE.md §9, resolved in SAST regardless of where it is called.
 *
 * A production day is 07h00 → 01h00, spanning the morning (07h00–16h00) and
 * afternoon (16h00–01h00) shifts. 00h00–06h59 maps BACK to the previous day, so
 * a login at 00h30 belongs to the run that started the previous 07h00 and does
 * not open a second, empty run day at the stroke of midnight.
 *
 * The timezone is explicit and defaulted, not inherited. `lib/production/
 * shifts.ts` has a device-local twin (`productionShiftNow`) that the capture
 * screens use deliberately — it only has to agree with the tablet in front of
 * the operator. This one runs SERVER-SIDE as well, and the VPS clock is UTC:
 * two hours behind SAST, so reading its local hours would file every login
 * between 07h00 and 09h00 SAST into the previous night's run.
 */
export function productionDayFor(
  at: Date | string | number = new Date(),
  timeZone = 'Africa/Johannesburg',
): RunSlot {
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return productionDayFor(new Date(), timeZone)

  // en-CA gives YYYY-MM-DD; hourCycle h23 gives 00–23 rather than a 24 at
  // midnight, which would parse as hour 24 and never match the < 7 branch.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''

  const y = Number(get('year')), m = Number(get('month')), day = Number(get('day'))
  const hour = Number(get('hour'))

  if (hour >= 7 && hour < 16) return { date: ymd(y, m, day), shift: 'morning' }
  if (hour >= 16)             return { date: ymd(y, m, day), shift: 'afternoon' }

  // 00h00–06h59 — the tail of yesterday's afternoon/night run.
  const prev = new Date(Date.UTC(y, m - 1, day))
  prev.setUTCDate(prev.getUTCDate() - 1)
  return {
    date: ymd(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate()),
    shift: 'afternoon',
  }
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Why an interval closed. Recorded because the four are not the same fact and
 * a shift end derived from them should be readable afterwards.
 *
 *   `signed_out`   — the operator tapped sign out. The real end of a shift.
 *   `idle_timeout` — the app's 60-minute inactivity sign-out fired. They may
 *                    well have still been at the machine; see `app/(app)/layout.tsx`.
 *   `stale`        — no heartbeat for long enough that the tab is gone (closed
 *                    lid, flat battery, tablet reboot). Closed at the last
 *                    heartbeat, never at the moment we noticed.
 *   `supervisor`   — closed by hand.
 */
export const CLOSE_REASONS = ['signed_out', 'idle_timeout', 'stale', 'supervisor'] as const
export type CloseReason = typeof CLOSE_REASONS[number]

export function isCloseReason(v: unknown): v is CloseReason {
  return typeof v === 'string' && (CLOSE_REASONS as readonly string[]).includes(v)
}

/**
 * One continuous stretch of being signed in.
 *
 * Mirrors `production.operator_shift_clock`, minus the columns only the
 * database cares about. `lastSeenAt` is the heartbeat: it is what lets an
 * abandoned tab be closed at the time the operator actually stopped, rather
 * than at whatever time somebody next looked.
 */
export interface ClockInterval {
  id:         string
  openedAt:   string          // ISO
  closedAt:   string | null   // ISO, or null while they are still signed in
  lastSeenAt: string          // ISO — last heartbeat
  closeReason: CloseReason | null
}

function ms(iso: string | null | undefined): number {
  if (!iso) return NaN
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? NaN : t
}

/** An interval with a usable open stamp. Anything else is a broken row. */
export function isUsable(i: ClockInterval): boolean {
  return Number.isFinite(ms(i.openedAt))
}

/** Still signed in — opened, never closed. */
export function isOnClock(i: ClockInterval): boolean {
  return isUsable(i) && !i.closedAt
}

/**
 * How long the app may go without a heartbeat before an open interval is
 * treated as abandoned.
 *
 * Longer than the app's own 60-minute inactivity sign-out on purpose. That
 * sign-out closes the interval properly (`idle_timeout`) whenever the tab is
 * alive to fire it; this only catches the case where it could NOT fire — the
 * tab is gone. Making it shorter would have the sweep race the sign-out and
 * close live shifts out from under operators who are simply working.
 */
export const STALE_AFTER_MS = 90 * MS_PER_MIN

/**
 * When an interval actually ended, for arithmetic.
 *
 *   closed            → its close stamp.
 *   open, heartbeating→ `now` (they are still on the clock).
 *   open, gone quiet  → its LAST HEARTBEAT.
 *
 * That last case is the one worth stating. A tablet whose battery died at
 * 14h10 has an interval that is still open at 23h00; measuring it to `now`
 * would pay someone for nine hours they were not there, and measuring it to
 * zero would pay them for none of the seven they were. The last heartbeat is
 * the last moment we have evidence for, so it is the honest end.
 */
export function effectiveEnd(
  i: ClockInterval,
  now: number = Date.now(),
  staleAfterMs: number = STALE_AFTER_MS,
): number {
  const closed = ms(i.closedAt)
  if (Number.isFinite(closed)) return closed
  const seen = ms(i.lastSeenAt)
  if (Number.isFinite(seen) && now - seen > staleAfterMs) return seen
  return now
}

/** Has this open interval gone quiet long enough to be swept closed? */
export function isStale(
  i: ClockInterval,
  now: number = Date.now(),
  staleAfterMs: number = STALE_AFTER_MS,
): boolean {
  if (!isOnClock(i)) return false
  const seen = ms(i.lastSeenAt)
  return Number.isFinite(seen) && now - seen > staleAfterMs
}

export interface PresenceWindow {
  /** First login of the production day. The shift start. Null if there is none. */
  startIso: string | null
  /**
   * Last logout. NULL while the operator is still signed in — which is not the
   * same as "unknown", and callers must keep it distinguishable: the timesheet
   * shows a running clock for null and a fixed end for a stamp.
   */
  endIso:   string | null
  /** Are they on the clock right now? */
  onClock:  boolean
  /** How many separate sign-ins made up the day. 1 is the ordinary case. */
  sessions: number
}

/**
 * Reduce a day's intervals to the window a timesheet reads.
 *
 * Start is the earliest open and is FIXED — a second login does not move it,
 * which is why the intervals are appended rather than a start column updated.
 * End is the latest effective end, and is null while any interval is still
 * live.
 */
export function presenceWindow(
  intervals: ClockInterval[],
  now: number = Date.now(),
  staleAfterMs: number = STALE_AFTER_MS,
): PresenceWindow {
  const usable = intervals.filter(isUsable)
  if (usable.length === 0) {
    return { startIso: null, endIso: null, onClock: false, sessions: 0 }
  }

  const startMs = Math.min(...usable.map(i => ms(i.openedAt)))
  const live = usable.some(i => isOnClock(i) && !isStale(i, now, staleAfterMs))

  // The end of the day is the latest end across every interval, not the last
  // row's — rows arrive ordered by open time, and an interval that opened
  // earlier can close later when two devices overlap during a handover.
  const endMs = Math.max(...usable.map(i => effectiveEnd(i, now, staleAfterMs)))

  return {
    startIso: new Date(startMs).toISOString(),
    endIso:   live ? null : new Date(endMs).toISOString(),
    onClock:  live,
    sessions: usable.length,
  }
}

/**
 * Minutes actually signed in, counting overlapping intervals once.
 *
 * Overlap is real: a handover where the outgoing operator has not signed out
 * yet, or the same person on a tablet and a desktop. Summing the intervals
 * would count that stretch twice, so they are merged first — the same reason
 * `stoppages.ts` merges before subtracting.
 *
 * This is NOT worked time. Worked time is the shift window minus the stoppages
 * the operator confirmed; this is only how long they were signed in, and the
 * two differ by every tea break.
 */
export function presenceMinutes(
  intervals: ClockInterval[],
  now: number = Date.now(),
  staleAfterMs: number = STALE_AFTER_MS,
): number {
  const spans = intervals
    .filter(isUsable)
    .map(i => ({ start: ms(i.openedAt), end: effectiveEnd(i, now, staleAfterMs) }))
    .filter(s => s.end > s.start)
    .sort((a, b) => a.start - b.start)

  let total = 0
  let cur: { start: number; end: number } | null = null
  for (const s of spans) {
    if (cur && s.start <= cur.end) {
      if (s.end > cur.end) cur.end = s.end
    } else {
      if (cur) total += cur.end - cur.start
      cur = { start: s.start, end: s.end }
    }
  }
  if (cur) total += cur.end - cur.start
  return Math.round(total / MS_PER_MIN)
}

export interface AwayGap {
  /** ISO — when they signed out. */
  fromIso: string
  /** ISO — when they signed back in. */
  toIso:   string
  minutes: number
}

/**
 * The stretches between one sign-out and the next sign-in, longer than
 * `minMinutes`.
 *
 * Shown, never subtracted. A gap is evidence that something happened; what it
 * was is the operator's to say on the stoppage ledger. The threshold exists
 * because a page reload or a browser that dropped the session produces a gap
 * of seconds, and surfacing those would bury the one that means something.
 */
export function awayGaps(
  intervals: ClockInterval[],
  minMinutes = 10,
  now: number = Date.now(),
  staleAfterMs: number = STALE_AFTER_MS,
): AwayGap[] {
  const spans = intervals
    .filter(isUsable)
    .map(i => ({ start: ms(i.openedAt), end: effectiveEnd(i, now, staleAfterMs) }))
    .sort((a, b) => a.start - b.start)

  const out: AwayGap[] = []
  let reach = -Infinity
  for (const s of spans) {
    if (reach > -Infinity && s.start > reach) {
      const minutes = Math.round((s.start - reach) / MS_PER_MIN)
      if (minutes >= minMinutes) {
        out.push({
          fromIso: new Date(reach).toISOString(),
          toIso:   new Date(s.start).toISOString(),
          minutes,
        })
      }
    }
    if (s.end > reach) reach = s.end
  }
  return out
}
