/**
 * features/shift-clock — the operator's login → logout presence ledger.
 *
 * THE ONLY PUBLIC SURFACE (ARCHITECTURE.md §3). Import from '@/features/shift-clock',
 * never from a file inside it.
 *
 *   <ShiftClock userId={…} />   mounted once in the app shell; starts the clock
 *                              on login, heartbeats while the tab lives
 *   clockOut(reason)           called from signOut(), before the session dies
 *   loadIntervals({…})         what the timesheet reads to find the shift start
 *
 * The arithmetic — shift start, shift end, stale handling, the run day — is in
 * `lib/core/timesheet/shift-clock.ts` and is unit-tested there. This folder is
 * only the wiring.
 */

export { ShiftClock, type ShiftClockProps } from './ShiftClock'
export { clockIn, clockOut, heartbeat, loadIntervals, type ClockPing } from './db'
