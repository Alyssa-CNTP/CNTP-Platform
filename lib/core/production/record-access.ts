/**
 * Who may change a production record, and where.
 *
 * ── Why this is core ───────────────────────────────────────────────────────
 *
 * The rule is asked in at least four places — the History page deciding whether
 * to render a control, the capture screen deciding whether its fields are live,
 * the route that accepts the write, and the banner that tells a reader why they
 * cannot type. Four expressions that must agree is the shape ARCHITECTURE.md §4
 * keeps naming, and the one the changeover rules were extracted for. So it is
 * answered once, here, and everything reads the same answer.
 *
 * Pure: no I/O, no React, no clock. Both production days are arguments so this
 * cannot drift from `productionDayFor()` (§9) — a rule that read the clock
 * itself would decide "today" differently at 00h30 than the run it is deciding
 * about.
 *
 * ── The shape of it, in the words it was given in ──────────────────────────
 *
 *   1. Previous days, for an operator: read-only.
 *   2. Today's record, one variant and grade: read-only in History, edited on
 *      the capture page.
 *   3. Today with a changeover: the operator captures the record they changed
 *      over TO. The earlier record is read-only to them — edits go through the
 *      supervisor, and only until sign-off. Once signed, only the relevant
 *      higher-ups can open it.
 *   4. History is read-only. Every record, every reader, no buttons.
 *
 * ── Two things this deliberately does NOT do ───────────────────────────────
 *
 * It does not name roles. `isSupervisor` and `canReopenSignedOff` arrive as
 * booleans the caller resolved, because who counts as a supervisor is an auth
 * question, not a production one — the same split `planChangeover()` makes.
 * `canReopenSignedOff` is `can_approve_reopen_request` today, held by the
 * Production Manager and IT.
 *
 * It does not perform the edit or decide the mechanism. A signed-off record is
 * reopened through the existing request flow, which flips the status back to
 * `draft`; this only answers whether the door is shut and who has the key.
 */

/** Where the reader is standing. */
export type RecordSurface = 'history' | 'capture'

/** Who to go and find. `null` when there is nothing to ask for. */
export type AskWho = 'supervisor' | 'management' | null

/**
 * Why a record is read-only. A stable key for tests and branching; the sentence
 * beside it is what a person reads.
 */
export type ReadOnlyReason =
  | 'history-is-a-record'
  | 'signed-off'
  | 'submitted'
  | 'earlier-day'
  | 'not-the-open-record'

export interface RecordAccessContext {
  surface: RecordSurface
  /** `prod_sessions.status` — 'new' | 'draft' | 'submitted' | 'approved'. */
  status: string | null | undefined
  /**
   * Is this the record the line is currently capturing onto?
   *
   * After a changeover a shift has two live records and only the newer one is
   * being captured. The older one is still a draft, so status alone cannot
   * tell them apart — which is exactly the case rule 3 is about.
   */
  isCurrentRecord: boolean
  /** The record's PRODUCTION day (07h00→01h00), not its calendar date. */
  recordProductionDay: string
  /** The production day it is now. Passed in; core reads no clock. */
  todayProductionDay: string
  /** Resolved by the caller — production supervisor, or above. */
  isSupervisor: boolean
  /** `can_approve_reopen_request`: Production Manager / IT. */
  canReopenSignedOff: boolean
}

export interface RecordAccess {
  canEdit: boolean
  /** `null` exactly when `canEdit` is true. */
  readOnly: ReadOnlyReason | null
  /** The reason, phrased for the floor. Screens show this verbatim. */
  readOnlyReason: string | null
  /**
   * Who could change it, when the reader cannot.
   *
   * Present on the History page too, and that is the point of rule 4: History
   * shows no buttons, but a reader who spots a mistake still has to be told
   * whose door to knock on. A read-only screen that says only "read-only" sends
   * them to the supervisor to ask who to ask.
   */
  askWho: AskWho
}

const TEXT: Record<ReadOnlyReason, string> = {
  'history-is-a-record':
    'History is the record of what was done — it is read here, not changed here.',
  'signed-off':
    'This record is signed off. Reopening it is the production manager’s call.',
  submitted:
    'This record has been submitted. A supervisor can still change it until they sign it off.',
  'earlier-day':
    'This is an earlier production day. A supervisor can still change it until it is signed off.',
  'not-the-open-record':
    'This is not the record the line is on — it was closed when the changeover opened the next one. A supervisor can change it until it is signed off.',
}

/** Statuses that mean the operator has handed the record over. */
const HANDED_OVER: ReadonlySet<string> = new Set(['submitted', 'approved'])

/**
 * What this reader may do with this record, on this screen.
 *
 * The capture answer is computed first and History then overrides `canEdit`,
 * rather than short-circuiting on the surface. That keeps `askWho` truthful on
 * both screens: the History page tells you who could change it, which is the
 * same person whether or not you happen to be looking at History.
 */
export function recordAccess(ctx: RecordAccessContext): RecordAccess {
  const inner = captureAccess(ctx)

  if (ctx.surface === 'history') {
    return {
      canEdit: false,
      readOnly: 'history-is-a-record',
      readOnlyReason: TEXT['history-is-a-record'],
      // Someone who could edit it elsewhere is worth naming; when the reader
      // could edit it themselves on the capture page there is nobody to ask.
      askWho: inner.canEdit ? null : inner.askWho,
    }
  }
  return inner
}

function captureAccess(ctx: RecordAccessContext): RecordAccess {
  const status = String(ctx.status ?? '')

  const shut = (readOnly: ReadOnlyReason, askWho: AskWho): RecordAccess => ({
    canEdit: false, readOnly, readOnlyReason: TEXT[readOnly], askWho,
  })
  const open = (): RecordAccess => ({
    canEdit: true, readOnly: null, readOnlyReason: null, askWho: null,
  })

  // ── Signed off ───────────────────────────────────────────────────────────
  // Checked FIRST and applies to everyone including the supervisor who signed
  // it. Their signature is against this content; letting them edit underneath
  // it would leave the record saying they approved something they did not see.
  // Reopening is a separate, recorded act (ARCHITECTURE.md §6).
  if (status === 'approved') {
    return ctx.canReopenSignedOff ? open() : shut('signed-off', 'management')
  }

  // ── Supervisor ───────────────────────────────────────────────────────────
  // Anything not yet signed. This is the whole of rule 3's "they ask the
  // supervisor to change it, but that is before he signs off".
  if (ctx.isSupervisor) return open()

  // ── Operator ─────────────────────────────────────────────────────────────
  // Ordered by what is most useful to hear. "This is yesterday" explains more
  // than "you submitted it", and both explain more than "this is not the open
  // record" — which only makes sense once you know the day is right.
  if (ctx.recordProductionDay !== ctx.todayProductionDay) {
    return shut('earlier-day', 'supervisor')
  }
  if (HANDED_OVER.has(status)) {
    return shut('submitted', 'supervisor')
  }
  if (!ctx.isCurrentRecord) {
    return shut('not-the-open-record', 'supervisor')
  }
  return open()
}
