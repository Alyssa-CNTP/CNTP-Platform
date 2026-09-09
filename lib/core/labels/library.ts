/**
 * Organising the label library.  ARCHITECTURE.md §2 — pure, no React, no I/O.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 *
 * The library is named by certification scheme — EU-ORG, JAS, NOP-USA,
 * EU-NOP-RA-ORG — so a salesperson looking for Lipton's label has to know which
 * union's rules apply to it first. That is backwards: the scheme is a
 * consequence of the customer and the market, not a thing a human should have
 * to search on. The seed set already half-admits it, with nine templates named
 * by scheme and one, KUNITARO-RA, named by customer.
 *
 * So the library groups by CUSTOMER, and the scheme code retreats to a detail
 * you see once you have opened a label.
 *
 * ── Two levels, because a customer has more than one label ──────────────────
 *
 *   customer -> family (a `code`, stable across versions) -> versions
 *
 * The middle level is not optional. A customer legitimately needs several
 * approved labels at once — Alyssa's example is rooibos carrying the importer
 * address and rosehips not — and each is approved separately for its product.
 * Flattening to customer -> versions would make those look like versions of one
 * another, which is exactly the wrong thing to imply about two independently
 * approved labels.
 *
 * ── Why this is in core ─────────────────────────────────────────────────────
 *
 * It decides what an operator is shown and in what order, it is entirely
 * arithmetic on data, and it is the kind of thing that otherwise gets rewritten
 * slightly differently in the list page, the job-card picker and the print
 * screen — and then they disagree about which version is "the" label. One
 * owner, tested (§1A).
 */

/** The status vocabulary of a label template. */
export type LabelStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'superseded'

/**
 * Only the fields the library needs — the same "declare the shape core reads"
 * pattern as lib/core/types/capture-data.ts, so core does not depend on the
 * database row type or on a component.
 */
export interface LibraryTemplate {
  id: string
  /** Stable family identifier, shared across versions. */
  code: string
  name: string
  version: number
  status: LabelStatus
  /** Canonical customer name; null/absent means a generic label. */
  customer?: string | null
}

export interface LabelFamily<T extends LibraryTemplate> {
  code: string
  /** Newest version first. */
  versions: T[]
  /** The one that matters at a glance — see pickHeadline. */
  headline: T
}

export interface CustomerGroup<T extends LibraryTemplate> {
  /** null for the generic group. */
  customer: string | null
  /** What to show as the heading. */
  label: string
  families: LabelFamily<T>[]
}

/** Heading for the group holding labels no customer owns. */
export const GENERIC_GROUP_LABEL = 'Any customer'

/**
 * The version worth showing when the family is collapsed.
 *
 * Approved wins, because that is the one that can actually be printed and the
 * question a salesperson is really asking is "what will go on the bag". Only
 * when nothing is approved does the newest thing in flight matter.
 *
 * `superseded` is deliberately NOT preferred over `draft`: a superseded label
 * is a historical record, and surfacing it as the headline would suggest it is
 * still usable.
 */
export function pickHeadline<T extends LibraryTemplate>(versions: readonly T[]): T {
  const byVersionDesc = [...versions].sort((a, b) => b.version - a.version)
  return (
    byVersionDesc.find(v => v.status === 'approved') ??
    byVersionDesc.find(v => v.status === 'pending_approval') ??
    byVersionDesc.find(v => v.status === 'draft') ??
    byVersionDesc[0]
  )
}

/**
 * Canonical key for grouping. Trims and case-folds so "Kunitaro" and
 * "kunitaro " land together, but the DISPLAY name keeps the spelling the data
 * actually holds — renaming a customer is not this function's job.
 *
 * This is not alias resolution. qms.customer_aliases and resolveCustomerName()
 * own that, and they need the alias table, which means I/O — so it happens
 * before the rows reach here.
 */
function groupKey(customer: string | null | undefined): string | null {
  const t = (customer ?? '').trim()
  return t ? t.toLowerCase() : null
}

/**
 * Group templates by customer, then by family.
 *
 * The generic group sorts LAST regardless of name. It is a fallback, and a
 * salesperson scanning for their customer should not have to read past it.
 */
export function groupLibraryByCustomer<T extends LibraryTemplate>(
  templates: readonly T[],
): CustomerGroup<T>[] {
  const byCustomer = new Map<string | null, { display: string | null; rows: T[] }>()

  for (const t of templates) {
    const key = groupKey(t.customer)
    const existing = byCustomer.get(key)
    if (existing) {
      existing.rows.push(t)
      // First non-empty spelling wins, so the heading is stable rather than
      // flipping with row order.
      if (!existing.display && t.customer?.trim()) existing.display = t.customer.trim()
    } else {
      byCustomer.set(key, { display: t.customer?.trim() || null, rows: [t] })
    }
  }

  const groups: CustomerGroup<T>[] = []
  for (const [key, { display, rows }] of byCustomer) {
    const byCode = new Map<string, T[]>()
    for (const r of rows) {
      const list = byCode.get(r.code)
      if (list) list.push(r)
      else byCode.set(r.code, [r])
    }
    const families = [...byCode.entries()]
      .map(([code, versions]) => {
        const sorted = [...versions].sort((a, b) => b.version - a.version)
        return { code, versions: sorted, headline: pickHeadline(sorted) }
      })
      // Within a customer, sort by what it is called, not by its scheme code —
      // the name is what the salesperson knows.
      .sort((a, b) => a.headline.name.localeCompare(b.headline.name) || a.code.localeCompare(b.code))

    groups.push({ customer: key === null ? null : display, label: display ?? GENERIC_GROUP_LABEL, families })
  }

  return groups.sort((a, b) => {
    if (a.customer === null) return 1          // generic last
    if (b.customer === null) return -1
    return a.label.localeCompare(b.label)
  })
}

/**
 * Customers offered in the editor's picker.
 *
 * The union of the names already in use on labels and the names the quality
 * module knows, so a label can be assigned to a customer that has specs but no
 * label yet — which is every customer, the first time. De-duplicated
 * case-insensitively, keeping the first spelling seen, because two spellings of
 * one customer in a dropdown is how the drift starts.
 */
export function customerOptions(
  fromSpecs: readonly string[],
  fromLabels: readonly (string | null | undefined)[] = [],
): string[] {
  const seen = new Map<string, string>()
  for (const raw of [...fromSpecs, ...fromLabels]) {
    const name = (raw ?? '').trim()
    if (!name) continue
    const k = name.toLowerCase()
    if (!seen.has(k)) seen.set(k, name)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

// ── Account ownership ────────────────────────────────────────────────────────
//
// `sales.customers` records who owns each account. The library groups by
// customer already; this layer says WHOSE each group is, and floats the
// viewer's own accounts to the top.
//
// It is here rather than in the page because three screens need the same
// answer — the library, the job-card picker and the approval queue — and a rep
// seeing a different set of "my customers" depending on which one they opened
// is the class of drift this module exists to prevent.

export interface CustomerAccount {
  /** Canonical spelling — `sales.customers.name`, the natural key. */
  name: string
  /** `production.employees.id`, or null when nobody owns the account yet. */
  salesRepEmployeeId: string | null
  /** Display name for the rep, when it has been resolved. */
  salesRepName?: string | null
}

export interface OwnedCustomerGroup<T extends LibraryTemplate> extends CustomerGroup<T> {
  salesRepEmployeeId: string | null
  salesRepName: string | null
  /** True when this account belongs to the person looking at the screen. */
  mine: boolean
}

/**
 * Annotate customer groups with their sales lead, and float the viewer's own
 * accounts to the top.
 *
 * Matching is on the TRIMMED, LOWERCASED name, the same key
 * `groupLibraryByCustomer` groups on. `label_templates.customer` is free text
 * while `sales.customers.name` is a unique canonical spelling, so an exact
 * comparison would silently drop ownership the first time someone typed
 * "kunitaro" — and a rep whose customer quietly stops being theirs has no way
 * to tell that from not owning it.
 *
 * Order within each half is preserved, so the alphabetical ordering
 * `groupLibraryByCustomer` established still holds inside "mine" and inside
 * the rest. The generic group carries no owner and can never be "mine", so it
 * stays last exactly as before.
 *
 * `viewerEmployeeId` of null — someone with no Staff Directory link — gets
 * every group in its original order and nothing marked mine, rather than
 * everything marked mine, which is the safer way for an unresolved identity to
 * fail.
 */
export function withOwnership<T extends LibraryTemplate>(
  groups: readonly CustomerGroup<T>[],
  accounts: readonly CustomerAccount[],
  viewerEmployeeId: string | null,
): OwnedCustomerGroup<T>[] {
  const byName = new Map<string, CustomerAccount>()
  for (const a of accounts) {
    const k = groupKey(a.name)
    if (k) byName.set(k, a)
  }

  const annotated = groups.map(g => {
    const account = g.customer === null ? undefined : byName.get(groupKey(g.customer)!)
    const salesRepEmployeeId = account?.salesRepEmployeeId ?? null
    return {
      ...g,
      salesRepEmployeeId,
      salesRepName: account?.salesRepName ?? null,
      mine: !!viewerEmployeeId && salesRepEmployeeId === viewerEmployeeId,
    }
  })

  // Stable partition, not a sort: a comparator returning 0 for two groups on
  // the same side is not guaranteed to keep their relative order in every
  // engine, and the alphabetical order underneath is the point.
  return [...annotated.filter(g => g.mine), ...annotated.filter(g => !g.mine)]
}

/**
 * The accounts nobody owns. Shown to whoever can assign, because an unassigned
 * customer is invisible work — no rep sees it under "my customers", so nobody
 * is prompted to approve its labels.
 */
export function unassignedAccounts(accounts: readonly CustomerAccount[]): CustomerAccount[] {
  return accounts
    .filter(a => !a.salesRepEmployeeId)
    .sort((a, b) => a.name.localeCompare(b.name))
}
