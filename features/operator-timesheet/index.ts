/**
 * Operator timesheet — the shift's stoppage record.
 *
 * ── The three-way split, same shape as features/changeover ──────────────────
 *
 * | Layer   | Owns                                  | Lives in                         |
 * |---------|---------------------------------------|----------------------------------|
 * | core    | the KINDS and the ARITHMETIC          | lib/core/timesheet/stoppages.ts  |
 * | feature | persistence, prompts, presentation    | here                             |
 * | page    | the session, and who may sign         | capture/[section]/page.tsx       |
 *
 * Worked minutes, downtime, interval merging, the deep-clean rule, which kinds
 * count as downtime, who each kind notifies and which need a signature are all
 * in core, pure and tested. This feature owns the ledger writes and the screens.
 *
 * ── Two entry points, on purpose ────────────────────────────────────────────
 *
 *   `OperatorTimesheet`  — the full sheet, mounted by the SIGN-OFF step. It runs
 *                          all shift and is finalised there.
 *   `StoppageQuickLog`   — "Production stopped", from the capture header. The
 *                          one thing that cannot wait for Sign-off, because a
 *                          stoppage's start time is only accurate if it is
 *                          recorded when the machine stops.
 *
 * `StoppageQuickLog` reads NOTHING until it is opened. That is a hard
 * requirement, not an optimisation: capture is what an operator is mid-shift
 * on, and anything this module does on mount is latency charged to production
 * capture for a feature nobody asked for at that moment.
 *
 * ── What this module does not do, and must not start doing ──────────────────
 *
 * It does not read the `maintenance` schema, and it polls nothing.
 *
 * An earlier version read `maintenance.job_cards` every 45 seconds from the
 * capture screen and offered to log a stoppage when maintenance had a card
 * open. Two things were wrong with it:
 *
 *   1. **The direction was backwards.** The operator stops the machine, so the
 *      operator knows it stopped and when. Taking the start time from a card's
 *      `started_at` meant maintenance's clock decided when the line went down —
 *      and maintenance is told after the fact, so that time is always late.
 *      The flow runs outward now: the operator logs it, the owning team is
 *      notified, and the operator calls a supervisor to sign it.
 *   2. **It taxed capture.** A background read of another schema every 45
 *      seconds, on the screen an operator is working in.
 *
 * It also does not write a job card. Raising and allocating maintenance work is
 * the maintenance module's workflow; a capture screen creating cards would make
 * it a second owner of that lifecycle.
 *
 * `production.capture_activity` — the login heartbeat the shift START is
 * anchored to — is likewise not ours. The capture page writes it; this feature
 * takes the start time as given.
 */

export { OperatorTimesheet } from './OperatorTimesheet'
export type { OperatorTimesheetProps } from './OperatorTimesheet'

export { StoppageQuickLog } from './StoppageQuickLog'
export type { StoppageQuickLogProps } from './StoppageQuickLog'

// The section → maintenance-area name. Exported because the shift report and
// the notification routes need the same mapping, and a second copy would drift
// into naming a place nobody recognises.
export { primaryAreaForSection, hasAreaMapping } from './areas'
