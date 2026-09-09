/**
 * Operator timesheet — the live shift tracker.
 *
 * ── The three-way split, same shape as features/changeover ──────────────────
 *
 * | Layer   | Owns                                  | Lives in                         |
 * |---------|---------------------------------------|----------------------------------|
 * | core    | the ARITHMETIC and the kinds          | lib/core/timesheet/stoppages.ts  |
 * | feature | persistence, prompts, presentation    | here                             |
 * | page    | the session, and who may sign         | capture/[section]/page.tsx       |
 *
 * Worked minutes, downtime, interval merging, the deep-clean rule and which
 * kinds need a signature are all in core, pure and tested. This feature owns
 * the ledger writes, the maintenance polling, and the screen.
 *
 * ── What this replaced, and what was actually wrong ─────────────────────────
 *
 * `components/production/capture/TimesheetConfirm.tsx` held every stoppage in
 * React state and wrote them once, at sign-off. Its load effect depended on
 * `operatorName`, and the capture page passes it the sign-off name INPUT — so
 * typing a name re-ran the effect and reset the list to the standard tea/lunch
 * schedule. Start and end re-derived to the same values, so the sheet looked
 * correct while every logged stoppage was gone. The floor reported it as
 * "start and end are fine, the other stoppages don't save", which is exactly
 * what was happening.
 *
 * Three other defects in the same file, all fixed here:
 *   * `confirm()` set `confirmed: true` in a `finally`, so a failed write still
 *     showed a green tick over data that never saved.
 *   * `if (!sessionId) return` with the button enabled — tapping did nothing
 *     and said nothing.
 *   * Overlapping breaks each subtracted from worked-time independently, so a
 *     breakdown running through lunch subtracted the lunch twice.
 *
 * ── NOT part of this feature ────────────────────────────────────────────────
 *
 * `production.capture_activity` — the login/heartbeat stream the shift START is
 * anchored to. It is written by the capture page on real edits and read by
 * lib/production/timesheet.ts. This feature takes the start time as given;
 * owning the heartbeat too would make it a second author of the session's
 * activity record.
 *
 * Raising or closing a maintenance JOB CARD. This feature reads cards and links
 * to them; the lifecycle belongs to the maintenance module. A capture screen
 * quietly completing a card would make it a second owner of that workflow.
 */

export { OperatorTimesheet } from './OperatorTimesheet'
export type { OperatorTimesheetProps } from './OperatorTimesheet'

// The section ↔ maintenance-area join, exported because the shift report needs
// the same mapping and a second copy would drift.
export { areasForSection, primaryAreaForSection, hasAreaMapping } from './areas'
