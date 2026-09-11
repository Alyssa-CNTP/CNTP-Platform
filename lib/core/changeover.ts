/**
 * Changeover — the rules, in one place.
 *
 * A changeover is a supervisor closing the current batch record off and opening
 * a new one mid-shift, because the line has switched grade or variant. It is not
 * a Sieving feature and not a capture-screen feature: the same rules apply
 * wherever a line changes over, so they live here rather than inside a page.
 *
 * ── Why this is core and not a component ────────────────────────────────────
 *
 * Everything below used to be inline in
 * `app/(app)/production/capture/[section]/page.tsx`: the supervisor gate in one
 * expression, the organic rule in a second, the leftover arithmetic in a third,
 * and the button's `disabled` in a fourth. Four expressions that all have to
 * agree, none of which could be tested.
 *
 * ARCHITECTURE.md §4 names the failure that arrangement produces — "gate
 * validation on the same condition as the render", a recurring class with three
 * PRs against it (#722, #752, #756). `planChangeover()` is that rule made
 * structural: the dialog renders what the plan says is available and the handler
 * acts on the same plan, so they cannot drift apart.
 *
 * ── The rules ───────────────────────────────────────────────────────────────
 *
 * 1. A changeover starts a CLEAN record. On the floor the leftover is normally
 *    all bagged out before switching, so the new record begins at zero.
 * 2. Only a supervisor may start one. An operator who needs a changeover fetches
 *    one — a control that silently does nothing is what sends them looking
 *    anyway, so the reason is returned rather than the button disabled.
 * 3. Carrying leftover material into the new record is the SUPERVISOR'S EXPLICIT
 *    EXCEPTION, for when the material physically continues into the next run.
 * 4. Organic material is never carried. It is segregated, and the pool it would
 *    be carried into is keyed on variant family — so the rule is a property of
 *    the ledger, not only a check here.
 * 5. An UNRECOGNISED variant is refused too. `mayPoolMaterial()` asks the
 *    positive question — is this definitely conventional — so "we do not know"
 *    fails closed. See lib/core/variants.ts.
 *
 * Nothing here performs I/O or knows about React. Writing the carry-over to
 * `production.bucket_elevator_log` and opening the new session are the caller's
 * job; this module only decides what is allowed and by how much.
 */
import { mayPoolMaterial, variantFamily, isOrganicVariant, type VariantFamily } from '@/lib/core/variants'

export interface ChangeoverContext {
  /** The variant of the record being closed off. */
  variant: string | null | undefined
  /** Total input kg on the record being closed off. */
  totalIn: number
  /** Total output kg on the record being closed off. */
  totalOut: number
  /**
   * Whether the actor may perform a changeover. Supervisors, IT and admin — the
   * same signal sign-off already uses. Resolved by the caller, because who
   * counts as a supervisor is an auth question, not a production one.
   */
  isSupervisor: boolean
  /**
   * The status of the record being closed off.
   *
   * A changeover waits for the operator to SUBMIT. That is a floor decision
   * (2026-09-11), and it is the one that collapses two controls into one: a
   * changeover and "start a new batch record" were always the same act — open
   * the next record — and the only thing separating them was whether the
   * current one was still a draft. Once submitting comes first, there is one
   * act and one control.
   *
   * It also removes the reason the old version was dangerous. Closing a live
   * draft early meant snapshotting a balance that was still moving and
   * flushing half-typed edits; against a submitted record there is nothing
   * in flight to lose.
   */
  recordStatus: string | null | undefined
  /**
   * Does this section have a ledger that can hold carried-over material?
   *
   * Sieving has `production.bucket_elevator_log`, keyed on variant family.
   * Nothing equivalent exists for Refining or the Blender, and the Granule
   * line's `dust_carryover_log` is keyed per dust type rather than per run, so
   * a changeover has no single figure to write to it.
   *
   * Passed in rather than decided here: which ledger a section owns is a fact
   * about the database, and core performs no I/O (ARCHITECTURE.md §2). Where
   * there is no ledger the material is not lost — it is bagged out under the
   * new record, which is what happens on almost every changeover anyway.
   */
  carrySupported: boolean
}

export type CarryRefusal = 'organic' | 'unknown-variant' | 'nothing-left' | 'no-ledger'

export interface ChangeoverPlan {
  /** May a changeover be started at all? */
  allowed: boolean
  /** Why not, phrased for the floor. `null` when allowed. */
  blockedReason: string | null
  /** Unaccounted material on the record being closed, rounded to 0.1 kg, never negative. */
  leftoverKg: number
  /**
   * May the leftover be carried into the new record?
   * Always false when `allowed` is false — there is no changeover to carry into.
   */
  mayCarry: boolean
  /** Which pool it would be carried into. `null` whenever `mayCarry` is false. */
  carryFamily: VariantFamily | null
  /**
   * Why carrying the MATERIAL is refused — organic, unrecognised variant, or
   * nothing left. Permission is a separate axis: when the actor is not a
   * supervisor this stays `null` and `blockedReason` carries the explanation,
   * because "you may not do this" is not a fact about the material.
   */
  carryRefusal: CarryRefusal | null
  /** The refusal, phrased for the floor. `null` when there is no refusal. */
  carryRefusalReason: string | null
}

/** Leftover on the record being closed: input not yet accounted for as output. */
export function changeoverLeftoverKg(totalIn: number, totalOut: number): number {
  const raw = (Number(totalIn) || 0) - (Number(totalOut) || 0)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.round(raw * 10) / 10
}

/**
 * What this actor may do, on this record, right now.
 *
 * Ask this once and use the answer for BOTH the dialog and the handler. Deriving
 * the button's visibility from one expression and the handler's guard from
 * another is the defect class in ARCHITECTURE.md §4.
 */
export function planChangeover(ctx: ChangeoverContext): ChangeoverPlan {
  const leftoverKg = changeoverLeftoverKg(ctx.totalIn, ctx.totalOut)

  const shut = (blockedReason: string): ChangeoverPlan => ({
    allowed: false,
    blockedReason,
    leftoverKg,
    mayCarry: false,
    carryFamily: null,
    // Permission and timing are not facts about the MATERIAL, so they stay off
    // this axis — `blockedReason` carries them. Two axes, deliberately.
    carryRefusal: null,
    carryRefusalReason: null,
  })

  // Order matters: say the most useful thing. An operator standing at the
  // machine needs to hear "submit it first", not "ask a supervisor" — the
  // submit is theirs to do and is the step that actually unblocks this.
  if (!SUBMITTED_STATUSES.has(String(ctx.recordStatus ?? ''))) {
    return shut('Submit this record first — a changeover opens the next one, and this one has to be closed off before it can.')
  }

  if (!ctx.isSupervisor) {
    return shut('This record is submitted. A supervisor opens the next one.')
  }

  let carryRefusal: CarryRefusal | null = null
  // Checked FIRST. Where there is no ledger, whether the material could
  // otherwise have been carried is not a question worth answering, and
  // reporting "nothing left to carry" on a section that could never carry
  // anything reads as a balance statement rather than a capability one.
  if (!ctx.carrySupported) carryRefusal = 'no-ledger'
  else if (isOrganicVariant(ctx.variant)) carryRefusal = 'organic'
  else if (!mayPoolMaterial(ctx.variant)) carryRefusal = 'unknown-variant'
  else if (leftoverKg <= 0) carryRefusal = 'nothing-left'

  const mayCarry = carryRefusal === null

  return {
    allowed: true,
    blockedReason: null,
    leftoverKg,
    mayCarry,
    // Non-null ONLY when carrying is allowed, so a caller cannot reach for a
    // family on a plan that refused.
    carryFamily: mayCarry ? variantFamily(ctx.variant) : null,
    carryRefusal,
    carryRefusalReason: carryRefusal === null ? null : CARRY_REFUSAL_TEXT[carryRefusal],
  }
}

const CARRY_REFUSAL_TEXT: Record<CarryRefusal, string> = {
  organic:
    'Organic material must stay segregated, so it cannot be carried into the new record. ' +
    'Bag out what is left before switching.',
  'unknown-variant':
    'This run’s variant is not recognised, so the material cannot be filed as conventional ' +
    'or organic. Set the variant on the batch record first.',
  'nothing-left':
    'There is nothing left to carry — the record balances.',
  'no-ledger':
    'This line has no carry-over ledger, so leftover material is bagged out under ' +
    'the new record rather than carried across as material in.',
}

/**
 * The statuses a changeover may follow.
 *
 * `approved` as well as `submitted`: a supervisor who signs off before opening
 * the next record has done MORE than the rule asks, and refusing them would be
 * the silent-latch shape — a control that disappears exactly when everything is
 * in order. `draft` and `new` are the ones that mean "not closed off yet".
 */
const SUBMITTED_STATUSES: ReadonlySet<string> = new Set(['submitted', 'approved'])

/**
 * Is the 16h00 shift hand-over due?
 *
 * Only a morning session, only on its own date, only from 16h00. Two shifts:
 * Morning 07h00–16h00, Afternoon/Night 16h00–01h00.
 *
 * `now` is injected rather than read from the clock so this is testable and so
 * callers cannot accidentally compare a session date against a different day's
 * clock — see ARCHITECTURE.md §9 on `productionDayFor()`.
 */
export function isPastShiftChangeover(shift: string, sessionDate: string, now: Date): boolean {
  return shift === 'morning' && sessionDate === isoDate(now) && now.getHours() >= 16
}

/**
 * Should submitting prompt "was there a changeover?"
 *
 * Only on an EARLY morning submit — before 15h30 — that already captured two or
 * more production orders. A normal end-of-morning submit near 16h00 is not a
 * changeover, so it never nags.
 */
export function isEarlyChangeoverLikely(
  shift: string,
  sessionDate: string,
  capturedProductionCount: number,
  now: Date,
): boolean {
  if (shift !== 'morning') return false
  if (sessionDate !== isoDate(now)) return false
  const beforeCutoff = now.getHours() < 15 || (now.getHours() === 15 && now.getMinutes() < 30)
  return beforeCutoff && capturedProductionCount >= 2
}

/** Local-date `yyyy-MM-dd`, matching what the capture screens store. */
function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
