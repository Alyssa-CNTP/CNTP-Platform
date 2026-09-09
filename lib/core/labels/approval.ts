/**
 * Who has to sign a label, and what that unlocks.
 *
 * Two gates, and they are not the same question.
 *
 *   GATE A — may a JOB CARD be raised against this label?
 *     The artwork is settled and the commercial chain is complete. By the time
 *     the production manager sees it, nothing about the label is still open.
 *
 *   GATE B — may these labels be PRINTED?
 *     The run-specific facts have been checked against the order: batch number,
 *     dates, customer PO. Two names, because they verify different halves.
 *
 * Splitting them matters. Gate A is about the TEMPLATE and is answered once per
 * version; gate B is about THIS RUN and is answered once per job card. Folding
 * them into one approval would mean either re-approving artwork nobody changed,
 * or printing a run nobody checked.
 *
 * Pure: no I/O, no React, no dates from the clock. `now` is always an argument
 * so a gate cannot drift from the session it is deciding about.
 */

// ── Who signs what ───────────────────────────────────────────────────────────

/**
 * The template chain. Order is the order they happen in, which is also the
 * order the screen lists them — a reader should see where it is stuck without
 * comparing two lists.
 */
export type TemplateSignOffRole = 'sales' | 'quality' | 'customer' | 'certifier'

/** The pre-print check, per job card. Two names, deliberately. */
export type PrintSignOffRole = 'sales_lead' | 'quality_supervisor'

export type SignOffRole = TemplateSignOffRole | PrintSignOffRole

export const TEMPLATE_SIGN_OFFS: readonly TemplateSignOffRole[] =
  ['sales', 'quality', 'customer', 'certifier'] as const

export const PRINT_SIGN_OFFS: readonly PrintSignOffRole[] =
  ['sales_lead', 'quality_supervisor'] as const

/** What each one is, in the words the screen uses. */
export const SIGN_OFF_LABEL: Readonly<Record<SignOffRole, string>> = {
  sales:             'Sales lead',
  quality:           'Quality department',
  customer:          'Customer',
  certifier:         'Control Union / label regulation',
  sales_lead:        'Sales lead',
  quality_supervisor:'Quality supervisor',
}

/**
 * One recorded signature.
 *
 * `templateVersion` is not decoration. A sign-off is against a specific version
 * of the artwork; carrying it forward onto a later version would mean the
 * record says "Quality approved this" about wording Quality never saw. See
 * `signOffsForVersion`.
 */
export interface SignOff {
  role: SignOffRole
  /** Who signed, as it should read on the record. */
  actorName: string
  /** production.employees.id where the signer is staff; null for the customer
   *  and the certifier, who are not in the Staff Directory. */
  actorEmployeeId: string | null
  /** ISO timestamp. */
  signedAt: string
  templateVersion: number
}

export interface SignOffState<R extends SignOffRole> {
  complete: boolean
  signed: SignOff[]
  outstanding: R[]
}

/**
 * Discard sign-offs that belong to an earlier version of the artwork.
 *
 * Editing an approved label supersedes it and starts a new version — so a
 * signature against v1 says nothing about v2, and silently counting it is how a
 * label reaches the floor carrying an approval nobody gave.
 */
export function signOffsForVersion(
  signOffs: readonly SignOff[],
  templateVersion: number,
): SignOff[] {
  return signOffs.filter(s => s.templateVersion === templateVersion)
}

/**
 * Which of `required` are signed and which are not.
 *
 * The LAST signature for a role wins, so a re-sign after a rejection replaces
 * the earlier one rather than sitting beside it.
 */
export function signOffState<R extends SignOffRole>(
  required: readonly R[],
  signOffs: readonly SignOff[],
): SignOffState<R> {
  const latest = new Map<SignOffRole, SignOff>()
  for (const s of signOffs) {
    const prev = latest.get(s.role)
    if (!prev || s.signedAt > prev.signedAt) latest.set(s.role, s)
  }
  const signed = required.map(r => latest.get(r)).filter(Boolean) as SignOff[]
  const outstanding = required.filter(r => !latest.has(r))
  return { complete: outstanding.length === 0, signed, outstanding }
}

// ── The gates ────────────────────────────────────────────────────────────────

/** Why a gate is shut. Sentences, not codes — the screen shows these verbatim. */
export interface Blocker {
  /** Stable key for tests and for grouping; never rendered on its own. */
  key: string
  reason: string
}

export interface Gate {
  open: boolean
  blockedBy: Blocker[]
}

const shut = (blockedBy: Blocker[]): Gate => ({ open: blockedBy.length === 0, blockedBy })

export type TemplateStatus =
  'draft' | 'pending_approval' | 'approved' | 'rejected' | 'superseded'

export interface JobCardGateInput {
  status: TemplateStatus
  templateVersion: number
  signOffs: readonly SignOff[]
  /** A customer PO bound to this approved template. Without one there is
   *  nothing to make. */
  poAssigned: boolean
}

/**
 * GATE A — may a job card be raised against this label?
 *
 * Everything upstream of production, checked here so the production manager
 * never has to ask whether a label is settled. If this is open, it is.
 */
export function jobCardGate(input: JobCardGateInput): Gate {
  const blockers: Blocker[] = []

  if (input.status === 'superseded') {
    blockers.push({ key: 'superseded', reason: 'This version has been superseded by a newer one.' })
  } else if (input.status === 'rejected') {
    blockers.push({ key: 'rejected', reason: 'This label was rejected and has not been reworked.' })
  } else if (input.status !== 'approved') {
    blockers.push({
      key: 'not_approved',
      reason: input.status === 'draft'
        ? 'Still a draft — no proof has been issued.'
        : 'Awaiting approval.',
    })
  }

  const state = signOffState(
    TEMPLATE_SIGN_OFFS,
    signOffsForVersion(input.signOffs, input.templateVersion),
  )
  for (const role of state.outstanding) {
    blockers.push({
      key: `unsigned:${role}`,
      reason: `${SIGN_OFF_LABEL[role]} has not signed off version ${input.templateVersion}.`,
    })
  }

  if (!input.poAssigned) {
    blockers.push({ key: 'no_po', reason: 'No customer PO is assigned to this label.' })
  }

  return shut(blockers)
}

export interface PrintGateInput extends JobCardGateInput {
  /** The pre-print check on THIS job card. */
  printSignOffs: readonly SignOff[]
}

/**
 * GATE B — may these labels be printed?
 *
 * Gate A, plus the two-name check on the run itself.
 *
 * The two signatures must be DIFFERENT PEOPLE. One person signing both halves
 * is one pair of eyes wearing two hats, which is the thing a second signature
 * exists to prevent — and it is worth refusing loudly rather than recording a
 * check that did not happen.
 */
export function printGate(input: PrintGateInput): Gate {
  const blockers = [...jobCardGate(input).blockedBy]

  const state = signOffState(PRINT_SIGN_OFFS, input.printSignOffs)
  for (const role of state.outstanding) {
    blockers.push({
      key: `unsigned:${role}`,
      reason: `${SIGN_OFF_LABEL[role]} has not signed the test label.`,
    })
  }

  if (state.complete) {
    const ids = state.signed.map(s => s.actorEmployeeId).filter(Boolean)
    const names = state.signed.map(s => s.actorName.trim().toLowerCase())
    const sameId = ids.length === 2 && ids[0] === ids[1]
    // Fall back to the name when neither signer is linked to the Staff
    // Directory — weaker, but better than letting an unlinked pair through.
    const sameName = ids.length < 2 && names.length === 2 && names[0] === names[1]
    if (sameId || sameName) {
      blockers.push({
        key: 'same_signer',
        reason: 'The sales lead and the quality supervisor must be two different people.',
      })
    }
  }

  return shut(blockers)
}

// ── Reading the state back ───────────────────────────────────────────────────

export interface ApprovalSummary {
  templateVersion: number
  template: SignOffState<TemplateSignOffRole>
  print: SignOffState<PrintSignOffRole>
  jobCard: Gate
  print_: Gate
}

/**
 * Everything a screen needs about where a label stands, from one call — so the
 * library, the job-card picker and the print screen cannot disagree about
 * whether a label is ready.
 */
export function approvalSummary(input: PrintGateInput): ApprovalSummary {
  return {
    templateVersion: input.templateVersion,
    template: signOffState(
      TEMPLATE_SIGN_OFFS,
      signOffsForVersion(input.signOffs, input.templateVersion),
    ),
    print: signOffState(PRINT_SIGN_OFFS, input.printSignOffs),
    jobCard: jobCardGate(input),
    print_: printGate(input),
  }
}
