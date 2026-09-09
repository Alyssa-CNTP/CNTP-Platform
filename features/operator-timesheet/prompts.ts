/**
 * What to ask the operator, and when.
 *
 * Pure. Given the stoppages already on the operator's sheet, this returns the
 * prompts to show. No I/O, no React, so the rules can be pinned by tests
 * instead of inferred from a screen.
 *
 * ── What this used to do, and why it stopped ─────────────────────────────────
 *
 * An earlier version polled `maintenance.job_cards` every 45 seconds and
 * offered to log a stoppage when maintenance had a card open on the line. Two
 * things were wrong with that, and they are worth writing down so it does not
 * come back:
 *
 *   1. **It had the direction backwards.** The OPERATOR stops the machine, so
 *      the operator is the one who knows it stopped and when. Taking the start
 *      time from a job card's `started_at` meant maintenance's clock decided
 *      when the line went down — and maintenance is told after the fact, so
 *      that time is always late and sometimes hours late. The flow runs the
 *      other way now: the operator logs it, maintenance is notified, and the
 *      operator is prompted to get a supervisor's signature.
 *   2. **It cost the capture screen a poll it did not need.** Capture is what
 *      an operator is mid-shift on; a background read of another schema every
 *      45 seconds is latency spent on something no operator asked for.
 *
 * So there is no polling here at all, and nothing reads the maintenance schema.
 *
 * ── The one rule that matters ────────────────────────────────────────────────
 *
 * A prompt is an OFFER, never a requirement. Nothing here blocks a sign-off and
 * nothing writes on the operator's behalf. A prompt that became a requirement
 * is the hidden-field validation trap in ARCHITECTURE.md §4: a week where the
 * deep clean happened on Wednesday would leave every Tuesday operator unable to
 * submit.
 *
 * A declined prompt therefore has to STAY declined for the shift — hence
 * `dismissedKinds` being an input here rather than state hidden in a component.
 */

import {
  deepCleanDue, isOpen, isLive, needsAttestation, STOPPAGE_META,
  type Stoppage,
} from '@/lib/core/timesheet/stoppages'

export type PromptKind =
  /** Tuesday morning, and no deep clean logged yet. */
  | 'log_deep_clean'
  /** A breakdown is logged; a supervisor still has to sign it. */
  | 'confirm_with_supervisor'
  /** Something is still running as the operator reaches sign-off. */
  | 'still_open'

export interface TimesheetPrompt {
  /** Stable across renders, so a prompt does not flicker or re-appear. */
  key:      string
  kind:     PromptKind
  title:    string
  detail:   string
  /** Label for the affirmative action, or null when the prompt is only telling
   *  the operator something they have to do away from the screen. */
  action:   string | null
  /** Present when the prompt is about a stoppage already on the sheet. */
  stoppageId?: string
  urgency:  'high' | 'normal'
}

export interface PromptInput {
  stoppages:      Stoppage[]
  date:           string
  shift:          string
  /** Prompt kinds the operator has waved away, for this shift. */
  dismissedKinds: ReadonlySet<PromptKind>
  /** True once the operator is finalising — enables `still_open`. */
  atSignOff:      boolean
}

const URGENCY_RANK: Record<'high' | 'normal', number> = { high: 0, normal: 1 }

/**
 * What to ask the operator right now, most urgent first.
 *
 * Deterministic in its inputs: the same stoppages always produce the same
 * prompts, so the panel does not move under the operator's finger.
 */
export function derivePrompts(input: PromptInput): TimesheetPrompt[] {
  const { stoppages, date, shift, dismissedKinds, atSignOff } = input
  const out: TimesheetPrompt[] = []

  // ── 1. A logged breakdown still needs a supervisor ────────────────────────
  //
  // Not dismissable. This is not a suggestion the operator can decline — it is
  // the state of their sheet, and it stays visible until somebody signs. It
  // still does not BLOCK anything: an operator at 01h00 with no supervisor on
  // the floor must be able to submit.
  for (const s of stoppages) {
    if (!needsAttestation(s)) continue
    out.push({
      key:    `confirm_with_supervisor:${s.id}`,
      kind:   'confirm_with_supervisor',
      title:  'Get your supervisor to confirm this breakdown',
      detail: s.notifiedAt
        ? 'Maintenance has been told the machine is stopped. A supervisor still needs to sign that it happened.'
        : 'A supervisor needs to sign that this happened. Maintenance is being told.',
      action: null,
      stoppageId: s.id,
      urgency: 'high',
    })
  }

  // ── 2. The Tuesday deep clean ─────────────────────────────────────────────
  if (deepCleanDue(date, shift) && !dismissedKinds.has('log_deep_clean')) {
    const already = stoppages.some(s => isLive(s) && s.kind === 'deep_clean')
    if (!already) {
      out.push({
        key:     'log_deep_clean',
        kind:    'log_deep_clean',
        title:   'Deep clean this morning?',
        detail:  'Tuesday morning is the usual deep-clean shift. Log it so the time is not counted as production.',
        action:  'Log deep clean',
        urgency: 'normal',
      })
    }
  }

  // ── 3. Anything still running at sign-off ─────────────────────────────────
  if (atSignOff) {
    for (const s of stoppages) {
      if (!isOpen(s)) continue
      const label = STOPPAGE_META[s.kind]?.label ?? 'A stoppage'
      out.push({
        key:        `still_open:${s.id}`,
        kind:       'still_open',
        title:      `${label} is still running`,
        detail:     'It will be closed at your shift end unless you set a time.',
        action:     'Close it now',
        stoppageId: s.id,
        urgency:    'normal',
      })
    }
  }

  return out.sort((a, b) => {
    const u = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
    return u !== 0 ? u : a.key.localeCompare(b.key)
  })
}
