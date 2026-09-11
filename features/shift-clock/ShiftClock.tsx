'use client'

/**
 * The shift clock, mounted once in the app shell.
 *
 * Renders NOTHING. Its whole job is to say "this operator is signed in, and
 * still is" for as long as the app is open, so the timesheet can stop guessing
 * when their shift began.
 *
 * ── Why it lives in the layout and not on the capture page ──────────────────
 *
 * That is the bug. The old start was the first `capture_activity` heartbeat,
 * and only `/production/capture/[section]` writes those — so an operator who
 * did the handover, walked the line and reached the tablet at 08h40 had a
 * timesheet that began at 08h40, and one who never opened Sign-off had no
 * start at all. Signing in happens in the shell, before any section is chosen,
 * so the clock belongs in the shell.
 *
 * ── The three things it does ────────────────────────────────────────────────
 *
 *   1. Clock IN once per signed-in user. Find-or-create server-side, so a
 *      reload or a second tab joins the open interval rather than opening a
 *      second one and moving the shift start.
 *   2. Heartbeat while the tab is alive, and once more on `pagehide`. This is
 *      what lets a tablet with a flat battery be closed at the moment the
 *      operator actually stopped, instead of at now (paying for hours nobody
 *      was there) or at zero (paying for none of the ones they were).
 *   3. Nothing on unmount. Navigating between pages unmounts and remounts the
 *      tree constantly; closing the interval there would end a shift every
 *      time somebody opened a different screen. The close belongs to
 *      `signOut()`, which is the only place that knows a logout is a logout —
 *      see lib/auth/context.tsx.
 *
 * Every call is total: `db.ts` catches, logs and returns "no clock". A feature
 * mounted in the layout must not be able to blank the app (ARCHITECTURE.md §3).
 */

import { useEffect, useRef } from 'react'
import { clockIn, heartbeat } from './db'

/**
 * How often to say "still here".
 *
 * Two minutes. Cheap — one tiny POST — and it bounds how much of a shift can be
 * lost when a device dies without warning: the close lands within two minutes
 * of when the operator actually stopped. Matching the app's 60-minute idle
 * window instead would put that error at up to an hour of someone's pay.
 */
const HEARTBEAT_MS = 2 * 60 * 1000

export interface ShiftClockProps {
  /** The signed-in auth user id, or null while loading / signed out. */
  userId: string | null
}

export function ShiftClock({ userId }: ShiftClockProps) {
  // The user this component has already clocked in. Keyed on the id rather than
  // on "have we run", so an account switch on a shared tablet opens the new
  // person's interval instead of being swallowed as a duplicate mount.
  const clockedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!userId) { clockedFor.current = null; return }

    let alive = true

    if (clockedFor.current !== userId) {
      clockedFor.current = userId
      void clockIn(typeof navigator === 'undefined' ? undefined : navigator.userAgent)
    }

    const beat = () => { if (alive) void heartbeat() }
    const timer = setInterval(beat, HEARTBEAT_MS)

    // One last beat as the tab goes away. `pagehide` fires where `unload` does
    // not on mobile Safari — the tablets — and `visibilitychange` catches a
    // screen lock, which on the floor is far more common than a closed tab.
    const onHide = () => { if (document.visibilityState === 'hidden') beat() }
    window.addEventListener('pagehide', beat)
    document.addEventListener('visibilitychange', onHide)
    // Coming back from a locked screen: beat immediately rather than waiting
    // out the interval, so a supervisor looking right then sees a live clock.
    window.addEventListener('focus', beat)

    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('pagehide', beat)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('focus', beat)
    }
  }, [userId])

  return null
}
