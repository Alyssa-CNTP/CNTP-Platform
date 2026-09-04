/**
 * Customer-spec identity: one spec per (customer, family, grade, variant).
 *
 * Why this exists. A pasteuriser run and a COA both have to resolve "which
 * sieve spec is this batch judged against?", and both resolve it by customer
 * name. Names were free text at every entry point, so production ended up with
 * three Entyce rows for Rooibos / Super Grade / Conventional — 'Entyce ',
 * 'ENTYCE ' and 'Entyce' — carrying DIFFERENT bulk-density limits (280-300 vs
 * 280-320), and two Edelweiss rows differing on three sieve fractions. Both
 * Edelweiss rows match a case-insensitive lookup for "Edelweiss", so which
 * limits a batch was judged against came down to Postgres row order.
 *
 * Every comparison in here is therefore on a normalised key (trimmed, internal
 * whitespace collapsed, case-folded) rather than the raw string. Where a
 * customer legitimately holds several documents for one product, the highest
 * document number wins (the lab's rule: Entyce runs on IPS-ENT-007); only a tie
 * on version is reported as ambiguous instead of resolved by row order. Storage keeps the operator's own capitalisation — 'ADM WILD' is how
 * that customer is written and it is not this module's job to restyle it.
 */

/** Comparison key. Never store this — it is lossy on purpose. */
export function normCustomerKey(s: string | null | undefined): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Storage form: trimmed, internal whitespace collapsed, case preserved.
 * This is what stops "Entyce" and "Entyce " ever becoming two rows again.
 */
export function cleanCustomerName(s: string | null | undefined): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

/** A spec row is "generic" when it carries no customer — null or blank. */
export function isGenericSpec(row: { customer?: string | null }): boolean {
  return normCustomerKey(row.customer) === ''
}

/**
 * Version number carried in a controlled document number: the trailing digits.
 * 'IPS-ENT-007' -> 7. Anchored to the END of the string, because the customer
 * code in the middle can itself contain digits, and parsed from the digits only
 * so 007 and 7 are the same version.
 *
 * Returns null for a row with no document number — the in-house generic specs
 * have none, and null must sort below any real version rather than beat it.
 */
export function docVersionOf(docNo: string | null | undefined): number | null {
  const m = /(\d+)\s*$/.exec(String(docNo ?? '').trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

/**
 * The lab's rule: when a customer holds several documents for one product, the
 * highest document number is the current spec. Entyce has IPS-ENT-001..007 and
 * 007 is the one that applies.
 *
 * Sorts descending by version, with a stable tie-break so two rows on the same
 * version (or both unnumbered) cannot swap between renders.
 */
function byLatestDoc<T extends { doc_no?: string | null; id?: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const va = docVersionOf(a.doc_no), vb = docVersionOf(b.doc_no)
    if (va !== vb) {
      if (va == null) return 1
      if (vb == null) return -1
      return vb - va
    }
    return (b.id ?? 0) - (a.id ?? 0)
  })
}

export type SpecPick<T> = {
  spec: T | null
  /** How it was found — surfaced in the UI so "generic" is never mistaken for "yours". */
  via: 'customer' | 'generic' | 'fallback' | 'none'
  /**
   * Rows that tie for the win and cannot be separated — same document version,
   * or all unnumbered. Genuinely ambiguous: which one applies comes down to row
   * order, so the caller must say so rather than pretend one is authoritative.
   * Several rows on DIFFERENT document numbers are NOT ambiguous — the highest
   * wins, and the rest are listed in `superseded`.
   */
  ambiguous: T[]
  /** Older documents for the same customer and product, newest first. */
  superseded: T[]
}

/**
 * Resolve the spec for a customer out of the rows already filtered to one
 * product/grade/variant. Priority: the customer's own row, then the generic
 * row, then anything left (so a batch is never left with no limits at all).
 */
export function pickSpecForCustomer<T extends { customer?: string | null }>(
  rows: T[] | null | undefined,
  customer: string | null | undefined,
): SpecPick<T> {
  const all = rows ?? []
  if (!all.length) return { spec: null, via: 'none', ambiguous: [], superseded: [] }

  // Within each tier the LATEST document wins, and only a tie on version is
  // ambiguous. Before doc_no existed every multi-row case was ambiguous, which
  // is why three Entyce rows resolved by luck.
  const resolve = (rows2: T[], via: 'customer' | 'generic'): SpecPick<T> => {
    const ranked = byLatestDoc(rows2 as (T & { doc_no?: string | null; id?: number })[]) as T[]
    const topV = docVersionOf((ranked[0] as { doc_no?: string | null }).doc_no)
    const tied = ranked.filter(r => docVersionOf((r as { doc_no?: string | null }).doc_no) === topV)
    return {
      spec: ranked[0],
      via,
      ambiguous: tied.length > 1 ? tied : [],
      superseded: ranked.filter(r => !tied.includes(r)),
    }
  }

  const key = normCustomerKey(customer)
  const mine = key ? all.filter(r => normCustomerKey(r.customer) === key) : []
  if (mine.length) return resolve(mine, 'customer')

  const generic = all.filter(isGenericSpec)
  if (generic.length) return resolve(generic, 'generic')

  return {
    spec: byLatestDoc(all as (T & { doc_no?: string | null; id?: number })[])[0] as T,
    via: 'fallback', ambiguous: [], superseded: [],
  }
}

/**
 * One customer, many spellings.
 *
 * Normalising case and whitespace made 'ENTYCE' / 'Entyce ' / 'Entyce' resolve
 * to one another, but it cannot match two genuinely different strings — and
 * production runs carry exactly that: 'EWTC' against a spec row named
 * 'East West Tea Company (EWTC)', 'Afri Tea and Coffee Blenders' against
 * 'Afri Tea and Coffee\'s', 'Lipton&Infusion (Ekaterra)' against
 * 'Lipton and Infusion'. Those runs were resolving to the GENERIC spec.
 *
 * Renaming the spec row cannot fix it: both spellings already exist in the data
 * and both keep being typed, so any single name fixes some runs and breaks
 * others. See qms.customer_aliases.
 */
export type CustomerAlias = { alias?: string | null; canonical_name?: string | null }

/**
 * Map a typed customer name to the spelling customer_specs uses. Returns the
 * input (cleaned) when there is no alias — so this is always safe to call.
 *
 * Resolution is a SINGLE hop on purpose. Chaining aliases (a -> b -> c) invites
 * cycles and makes "which spec applies?" depend on traversal order, which is
 * the class of problem this whole area is being dug out of. The unique index on
 * alias means a name resolves to at most one canonical target.
 */
export function resolveCustomerName(
  name: string | null | undefined,
  aliases: CustomerAlias[] | null | undefined,
): string {
  const cleaned = cleanCustomerName(name)
  if (!cleaned) return ''
  const key = normCustomerKey(cleaned)
  for (const a of aliases ?? []) {
    if (normCustomerKey(a.alias) === key) {
      const target = cleanCustomerName(a.canonical_name)
      // A blank or self-referential row is ignored rather than trusted: the DB
      // constraints forbid both, but this function must not depend on that to
      // avoid returning '' for a real customer.
      if (target && normCustomerKey(target) !== key) return target
    }
  }
  return cleaned
}

/** True when the name was reached through an alias rather than used as typed. */
export function wasAliased(
  name: string | null | undefined,
  aliases: CustomerAlias[] | null | undefined,
): boolean {
  const cleaned = cleanCustomerName(name)
  return !!cleaned && normCustomerKey(resolveCustomerName(cleaned, aliases)) !== normCustomerKey(cleaned)
}

/**
 * Resolve through aliases, then pick the spec. The two steps are separate
 * functions but nearly always wanted together, and a caller that forgot the
 * alias hop would silently reintroduce the bug.
 */
export function pickSpecForCustomerWithAliases<T extends { customer?: string | null }>(
  rows: T[] | null | undefined,
  customer: string | null | undefined,
  aliases: CustomerAlias[] | null | undefined,
): SpecPick<T> & { resolvedCustomer: string; aliased: boolean } {
  const resolved = resolveCustomerName(customer, aliases)
  return {
    ...pickSpecForCustomer(rows, resolved),
    resolvedCustomer: resolved,
    aliased: wasAliased(customer, aliases),
  }
}

export type SpecKeyFields = {
  customer?: string | null
  product_family?: string | null
  grade?: string | null
  variant?: string | null
  /**
   * Part of the identity: one customer legitimately holds several specs for one
   * product, separated only by document number (Entyce has IPS-ENT-001..007,
   * six of them under one family/grade/variant). Rows with no document number
   * all share the empty key, so there can still be only one of those.
   */
  doc_no?: string | null
}

/**
 * Product identity, normalised the same way as the customer name. Joined on a
 * character that cannot appear in any of the parts, so 'Rooibos' + 'Super Grade'
 * cannot collide with 'Rooibos Super' + 'Grade'.
 */
function productKey(r: SpecKeyFields): string {
  return [r.product_family, r.grade, r.variant, r.doc_no].map(v => normCustomerKey(v)).join('|')
}

/**
 * The row that already owns this (customer, family, grade, variant), if any —
 * the guard that refuses to create a second spec for one customer. `excludeId`
 * lets an edit of an existing row skip itself.
 */
export function findDuplicateSpec<T extends SpecKeyFields & { id?: number }>(
  rows: T[] | null | undefined,
  candidate: SpecKeyFields,
  excludeId?: number,
): T | null {
  const ck = normCustomerKey(candidate.customer)
  const pk = productKey(candidate)
  for (const r of rows ?? []) {
    if (excludeId != null && r.id === excludeId) continue
    if (normCustomerKey(r.customer) === ck && productKey(r) === pk) return r
  }
  return null
}

/**
 * Existing customer names for a dropdown: one entry per distinct customer,
 * whitespace-cleaned, sorted case-insensitively. Generic (blank) rows are not
 * customers and are left out — callers offer that as an explicit choice.
 *
 * Where the same customer exists under several spellings that differ only by
 * whitespace or case, the most common spelling wins, ties broken alphabetically
 * so the list is stable between renders.
 */
export function customerOptions(rows: { customer?: string | null }[] | null | undefined): string[] {
  const byKey = new Map<string, Map<string, number>>()
  for (const r of rows ?? []) {
    const name = cleanCustomerName(r.customer)
    if (!name) continue
    const key = normCustomerKey(name)
    const variants = byKey.get(key) ?? new Map<string, number>()
    variants.set(name, (variants.get(name) ?? 0) + 1)
    byKey.set(key, variants)
  }
  return [...byKey.values()]
    .map(variants => [...variants.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0])
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
