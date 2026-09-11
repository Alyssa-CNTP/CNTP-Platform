/**
 * Reading the label signature register.
 *
 * `lib/core/labels/approval.ts` owns the RULES — who has to sign, what that
 * unlocks, and the two-different-people check. This file owns getting the rows
 * out of `public.label_sign_offs` and into the shape core reasons over, which
 * is I/O and therefore cannot live in core (ARCHITECTURE.md §2).
 *
 * It exists because the mapping was written three times: twice inline in the
 * two sign-off routes and about to be a fourth time in the UI. A row shape
 * copied per caller is the `n()`-in-twelve-files pattern §1A names, and the
 * failure mode here is worse than a duplicated helper — a caller that forgets
 * `template_version` silently counts a v1 signature against v2 artwork.
 *
 * ── Everything fails soft, and the gate fails SHUT ──────────────────────────
 *
 * A read that errors returns no signatures, and no signatures means every role
 * is outstanding, which means the gate is closed. That is the right direction
 * to fail: a label that cannot prove it was signed does not print. The opposite
 * — treating an unreadable register as "probably fine" — would print unapproved
 * artwork on a customer's bag.
 *
 * This also covers the database where `20260909_005` has not been run yet. The
 * table is simply absent, the read fails, and the screens still render with the
 * chain shown as unsigned rather than crashing (`prod_sessions`-style PGRST205
 * is an error like any other here).
 */

import {
  PRINT_SIGN_OFFS, TEMPLATE_SIGN_OFFS, signOffState, signOffsForVersion,
  type SignOff, type SignOffRole,
} from '@/lib/core/labels'
import type { PermissionKey } from '@/lib/auth/permissions'

/**
 * Who may sign as whom.
 *
 * ONE map, read by the two routes that enforce it and by the UI that decides
 * whether to offer a Sign button. It was written twice before this — once per
 * route — and a third copy was about to appear in the component. Three lists
 * of who may sign a certification document is three chances for one of them to
 * quietly grant Sales the Quality signature.
 *
 * `quality` is deliberately NOT `can_approve_labels`. One key held by both
 * halves would let one person produce two names, and two names one person can
 * produce is one name — which is the entire reason the chain has four roles
 * and the print check has two.
 *
 * Recording an external approval is a sales act; the approval itself happens
 * outside the building, which is why `customer` and `certifier` also sit on
 * `can_approve_labels` and carry `recorded_by` (20260909_006).
 */
export const SIGN_OFF_PERMISSION: Readonly<Record<SignOffRole, PermissionKey>> = {
  sales:              'can_approve_labels',
  quality:            'can_quality_sign_labels',
  customer:           'can_approve_labels',
  certifier:          'can_approve_labels',
  sales_lead:         'can_approve_labels',
  quality_supervisor: 'can_quality_sign_labels',
}

/** The roles whose signer is not in this building, so their name is typed in. */
export const EXTERNAL_SIGN_OFF_ROLES: ReadonlySet<SignOffRole> =
  new Set<SignOffRole>(['customer', 'certifier'])

/**
 * One row of `public.label_sign_offs`, as PostgREST hands it back.
 *
 * Deliberately wider than `SignOff`: `external_ref`, `note` and the
 * `recorded_by_*` pair are for DISPLAY — who here stood behind a customer's
 * approval — and core has no business reasoning about them.
 */
export interface SignOffRow {
  scope: 'template' | 'print'
  role: SignOffRole
  template_id: string
  template_version: number
  job_card_id: string | null
  actor_name: string | null
  actor_employee_id: string | null
  actor_signature?: string | null
  signed_at: string
  external_ref?: string | null
  note?: string | null
  recorded_by_name?: string | null
}

/** The columns every caller needs. One list, so no reader forgets one. */
export const SIGN_OFF_COLUMNS =
  'scope, role, template_id, template_version, job_card_id, actor_name, ' +
  'actor_employee_id, actor_signature, signed_at, external_ref, note, recorded_by_name'

/** A row → the shape core reasons over. */
export function toSignOff(r: SignOffRow): SignOff {
  return {
    role: r.role,
    actorName: String(r.actor_name ?? ''),
    actorEmployeeId: r.actor_employee_id ?? null,
    signedAt: String(r.signed_at ?? ''),
    templateVersion: Number(r.template_version),
  }
}

/**
 * Split one read into the two scopes the two gates need.
 *
 * `jobCardId` narrows the print half: print signatures belong to ONE run, and
 * folding another card's pair in would let a card print on someone else's
 * check. Template signatures are shared across every card on that version,
 * which is the point of approving artwork once.
 */
export function splitSignOffs(
  rows: readonly SignOffRow[],
  jobCardId?: string | null,
): { template: SignOff[]; print: SignOff[] } {
  return {
    template: rows.filter(r => r.scope === 'template').map(toSignOff),
    print: rows
      .filter(r => r.scope === 'print' && (!jobCardId || r.job_card_id === jobCardId))
      .map(toSignOff),
  }
}

/**
 * The rows to SHOW for one version, newest first per role.
 *
 * `signOffState()` in core answers "is it complete" and returns the bare
 * `SignOff`; a screen also wants the reference the certifier gave and who
 * recorded an external approval, so this keeps whole rows. The last signature
 * per role wins, matching core exactly — a re-sign after a rejection replaces
 * rather than stacking.
 */
export function latestByRole(
  rows: readonly SignOffRow[],
  scope: 'template' | 'print',
  opts: { templateVersion?: number; jobCardId?: string | null } = {},
): Map<SignOffRole, SignOffRow> {
  const out = new Map<SignOffRole, SignOffRow>()
  for (const r of rows) {
    if (r.scope !== scope) continue
    if (opts.templateVersion != null && Number(r.template_version) !== opts.templateVersion) continue
    if (opts.jobCardId != null && r.job_card_id !== opts.jobCardId) continue
    const prev = out.get(r.role)
    if (!prev || String(r.signed_at) > String(prev.signed_at)) out.set(r.role, r)
  }
  return out
}

/**
 * Which template roles are still outstanding for a version.
 *
 * A thin wrapper over core so callers do not have to remember to run
 * `signOffsForVersion` first — forgetting it is how a v1 signature silently
 * satisfies v2.
 */
export function outstandingTemplateRoles(
  rows: readonly SignOffRow[],
  templateVersion: number,
): readonly SignOffRole[] {
  const signed = signOffsForVersion(
    rows.filter(r => r.scope === 'template').map(toSignOff),
    templateVersion,
  )
  return signOffState(TEMPLATE_SIGN_OFFS, signed).outstanding
}

/** Which print roles are still outstanding on one job card. */
export function outstandingPrintRoles(
  rows: readonly SignOffRow[],
  jobCardId: string,
): readonly SignOffRole[] {
  const signed = rows
    .filter(r => r.scope === 'print' && r.job_card_id === jobCardId)
    .map(toSignOff)
  return signOffState(PRINT_SIGN_OFFS, signed).outstanding
}

/**
 * The minimum a Supabase-ish client has to offer to be read through here.
 *
 * Typed structurally rather than importing a client type, so the same function
 * serves the browser client (`publicDb()`) and the admin client (`labelDb()`),
 * which are different types carrying the same shape. Importing either one would
 * drag a server-only module into a client bundle or the other way round.
 */
export interface SignOffReadable {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): PromiseLike<{ data: unknown; error: unknown }>
    }
  }
}

/**
 * Every signature attached to one template — both scopes, every job card.
 *
 * One read rather than two because the print gate needs both halves and a
 * screen showing one without the other tells half a story. Returns `[]` on any
 * failure; see the fail-shut note at the top.
 */
export async function readSignOffs(
  db: SignOffReadable,
  templateId: string,
): Promise<SignOffRow[]> {
  try {
    const { data, error } = await db
      .from('label_sign_offs')
      .select(SIGN_OFF_COLUMNS)
      .eq('template_id', templateId)
    if (error) return []
    return (data ?? []) as SignOffRow[]
  } catch {
    return []
  }
}
