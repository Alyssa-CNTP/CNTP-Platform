/**
 * The smart tracker — deciding what to ask the operator, and when.
 *
 * Pure. Given the maintenance job cards on this line and the stoppages already
 * on the operator's sheet, this returns the prompts to show. No I/O, no React,
 * so the rules can be pinned by tests instead of inferred from a screen.
 *
 * It lives in the feature rather than in lib/core because it reasons about a
 * maintenance job card, which is a feature-shaped concept core is not allowed
 * to know about (ARCHITECTURE.md §2 — core never knows a feature exists).
 *
 * ── The one rule that matters ────────────────────────────────────────────────
 *
 * A prompt is an OFFER, never a requirement. Nothing here can block a sign-off,
 * and nothing here writes anything on the operator's behalf. Two reasons:
 *
 *   * A maintenance card is raised against an AREA, and an area can hold
 *     machines that were not stopping the line the operator is running. Auto-
 *     logging a stoppage from a card would put downtime on a shift that never
 *     had it, and the operator would have no way to explain the gap.
 *   * A prompt that became a requirement is the hidden-field validation trap in
 *     ARCHITECTURE.md §4: a week where the deep clean happened on Wednesday
 *     would leave every Tuesday operator unable to submit.
 *
 * A declined prompt therefore has to STAY declined for the shift — hence
 * `dismissedCardIds` / `dismissedKinds` being inputs here rather than state
 * hidden inside a component.
 */

import { deepCleanDue, isOpen, isLive, type Stoppage } from '@/lib/core/timesheet/stoppages'
import { isCardOpen, type LineJobCard } from './db'

export type PromptKind =
  /** Maintenance has a live card on this line and it is not on the sheet. */
  | 'log_breakdown'
  /** A linked card has been completed; the operator's stoppage is still open. */
  | 'close_stoppage'
  /** Tuesday morning, and no deep clean logged yet. */
  | 'log_deep_clean'
  /** Something is still running as the operator reaches sign-off. */
  | 'still_open'

export interface TimesheetPrompt {
  /** Stable across polls, so a prompt does not flicker or re-appear once acted on. */
  key:      string
  kind:     PromptKind
  title:    string
  detail:   string
  /** Label for the affirmative action. */
  action:   string
  /** Present when the prompt came from a maintenance card. */
  card?:    LineJobCard
  /** Present when the prompt is about a stoppage already on the sheet. */
  stoppageId?: string
  /** For `close_stoppage`: the time to close it at (the card's completion). */
  closeAt?: string
  /** Breakdowns sort above planned work, which sorts above housekeeping. */
  urgency:  'high' | 'normal'
}

export interface PromptInput {
  cards:            LineJobCard[]
  stoppages:        Stoppage[]
  date:             string
  shift:            string
  /** Card ids the operator has said aren't theirs, for this shift. */
  dismissedCardIds: ReadonlySet<number>
  /** Prompt kinds the operator has waved away, for this shift. */
  dismissedKinds:   ReadonlySet<PromptKind>
  /** True once the operator is on the sign-off step — enables `still_open`. */
  atSignOff:        boolean
}

/** Cards a stoppage on the sheet already accounts for (voided rows do not). */
function linkedCardIds(stoppages: Stoppage[]): Set<number> {
  const ids = new Set<number>()
  for (const s of stoppages) {
    if (isLive(s) && s.jobCardId != null) ids.add(s.jobCardId)
  }
  return ids
}

const URGENCY_RANK: Record<'high' | 'normal', number> = { high: 0, normal: 1 }

/**
 * What to ask the operator right now, most urgent first.
 *
 * Deterministic in its inputs: the same cards and stoppages always produce the
 * same prompts, which is what lets this be polled every few seconds without the
 * panel jumping around.
 */
export function derivePrompts(input: PromptInput): TimesheetPrompt[] {
  const { cards, stoppages, date, shift, dismissedCardIds, dismissedKinds, atSignOff } = input
  const linked = linkedCardIds(stoppages)
  const out: TimesheetPrompt[] = []

  // ── 1. A live card on this line that nobody has logged ────────────────────
  for (const card of cards) {
    if (!isCardOpen(card)) continue
    if (linked.has(card.id)) continue
    if (dismissedCardIds.has(card.id)) continue
    const isBreakdown = card.workflow === 'breakdown'
    out.push({
      key:     `log_breakdown:${card.id}`,
      kind:    'log_breakdown',
      title:   isBreakdown
        ? `Breakdown on ${card.machine || card.area}`
        : `Maintenance on ${card.machine || card.area}`,
      detail:  `${card.cardNo} — ${card.description}${card.assignedTo ? ` · ${card.assignedTo}` : ''}`,
      action:  'Log the stoppage',
      card,
      urgency: isBreakdown ? 'high' : 'normal',
    })
  }

  // ── 2. A linked card has been finished, but the stoppage is still open ────
  const cardById = new Map(cards.map(c => [c.id, c]))
  for (const s of stoppages) {
    if (!isOpen(s) || s.jobCardId == null) continue
    const card = cardById.get(s.jobCardId)
    if (!card || isCardOpen(card)) continue
    // No completion timestamp means we cannot offer a time to close it at, so
    // the prompt would be asking the operator to guess. Leave it to `still_open`.
    if (!card.completedAt) continue
    out.push({
      key:        `close_stoppage:${s.id}:${card.completedAt}`,
      kind:       'close_stoppage',
      title:      `${card.machine || card.area} is back up`,
      detail:     `${card.cardNo} was completed by maintenance. Close your stoppage at that time?`,
      action:     'Close it',
      card,
      stoppageId: s.id,
      closeAt:    card.completedAt,
      urgency:    'high',
    })
  }

  // ── 3. The Tuesday deep clean ─────────────────────────────────────────────
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

  // ── 4. Anything still running at sign-off ─────────────────────────────────
  if (atSignOff) {
    for (const s of stoppages) {
      if (!isOpen(s)) continue
      // Already covered by a specific close prompt — don't ask twice.
      if (out.some(p => p.kind === 'close_stoppage' && p.stoppageId === s.id)) continue
      out.push({
        key:        `still_open:${s.id}`,
        kind:       'still_open',
        title:      'A stoppage is still running',
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

/**
 * Cards worth showing in the panel even when they raise no prompt — so an
 * operator can see what maintenance is doing on their line, and attach a
 * stoppage to a card they had earlier dismissed.
 *
 * Ordered newest first, open before closed: an open breakdown is what the
 * operator needs to reach for.
 */
export function panelCards(cards: LineJobCard[]): LineJobCard[] {
  return cards.slice().sort((a, b) => {
    const ao = isCardOpen(a) ? 0 : 1
    const bo = isCardOpen(b) ? 0 : 1
    if (ao !== bo) return ao - bo
    return (b.raisedAt ?? '').localeCompare(a.raisedAt ?? '')
  })
}
