/**
 * Shift clock — the browser's side of the presence ledger.
 *
 * Everything here goes through `/api/production/shift-clock`, never straight at
 * the table. `production.operator_shift_clock` is SELECT-only to `authenticated`
 * on purpose: it decides paid hours, and the whole point of anchoring the clock
 * to the login is that nobody types it. The route takes the identity from the
 * session and the time from the server.
 *
 * NOTHING HERE THROWS. This runs in the app shell on every page, for every
 * signed-in user, and it is not the operator's problem if a clock write fails —
 * a thrown error would take down the layout that renders the whole app.
 * ARCHITECTURE.md §3: where a feature is consumed as a hook or a plain call, the
 * adapter must be total — catch, log, and fall back to the behaviour that
 * shipped before the feature existed. Here that behaviour is "no clock", which
 * the timesheet already handles, because it is what every shift before this
 * looked like.
 */

import type { ClockInterval, CloseReason } from '@/lib/core/timesheet/shift-clock'

const ROUTE = '/api/production/shift-clock'

export interface ClockPing {
  /** False for anyone not on a production clock — most of the company. */
  eligible: boolean
  /** True only when THIS call created the interval. */
  opened:   boolean
  date:     string | null
  shift:    string | null
  openedAt: string | null
}

const NO_CLOCK: ClockPing = { eligible: false, opened: false, date: null, shift: null, openedAt: null }

async function post(body: Record<string, unknown>): Promise<ClockPing> {
  try {
    const res = await fetch(ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // The clock must not be served from a bfcache/HTTP cache: a cached "you
      // are already open" would mask a session that had actually been swept.
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`shift-clock route returned ${res.status}`)
    const b = await res.json().catch(() => ({}))
    return {
      eligible: !!b.eligible,
      opened:   !!b.opened,
      date:     b.date     ?? null,
      shift:    b.shift    ?? null,
      openedAt: b.openedAt ?? null,
    }
  } catch (e) {
    console.warn('[shift-clock] could not reach the clock:', e)
    return NO_CLOCK
  }
}

/**
 * Start (or re-join) the operator's shift.
 *
 * Find-or-create, server-side: a reload, a second tab or a second device joins
 * the interval already open rather than starting a new one, so the shift start
 * stays the first login of the run day. Safe to call on every mount, and it is.
 */
export function clockIn(device?: string): Promise<ClockPing> {
  return post({ action: 'in', device })
}

/**
 * "Still here." Refreshes `last_seen_at` so an abandoned tab can later be closed
 * at the time the operator actually stopped rather than at whatever time
 * somebody next looked.
 *
 * Deliberately does NOT open an interval. A heartbeat arriving after a sweep or
 * a sign-out in another tab must not restart a shift that has ended.
 */
export function heartbeat(): Promise<ClockPing> {
  return post({ action: 'heartbeat' })
}

/**
 * Stop the clock. Called from `signOut()` BEFORE the session is invalidated —
 * afterwards the route has no caller to attribute the close to.
 */
export function clockOut(reason: CloseReason = 'signed_out'): Promise<ClockPing> {
  return post({ action: 'out', reason })
}

/**
 * One person's intervals for a run day.
 *
 * `userId` is preferred; `operatorName` is the fallback for the capture screen,
 * which knows who signed off by name and does not always hold their auth id.
 * An empty array means "no clock for this person today" — which is a real
 * answer (they never signed in on this account) and not an error.
 */
export async function loadIntervals(args: {
  date:  string
  shift: string
  userId?:       string | null
  operatorName?: string | null
}): Promise<ClockInterval[]> {
  if (!args.date || !args.shift) return []
  if (!args.userId && !args.operatorName) return []
  try {
    const q = new URLSearchParams({ date: args.date, shift: args.shift })
    if (args.userId) q.set('userId', args.userId)
    else if (args.operatorName) q.set('operatorName', args.operatorName)

    const res = await fetch(`${ROUTE}?${q.toString()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`shift-clock route returned ${res.status}`)
    const b = await res.json().catch(() => ({}))
    return Array.isArray(b.intervals) ? (b.intervals as ClockInterval[]) : []
  } catch (e) {
    console.warn('[shift-clock] could not read the clock:', e)
    return []
  }
}
