/**
 * The two rules that decide what a COA will let you do.
 *
 * Pulled out of app/(app)/quality/coa/page.tsx because both are quality
 * decisions with real consequences — one stops a certificate claiming an
 * analysis nobody ran, the other stops results changing under two managers'
 * signatures — and neither was testable inside a 1300-line component.
 */

// The same "is this analysis asked for?" test the COA builder and the spec
// editor use. Blank means the spec is silent; the literal 'NOT REQUIRED' is how
// the client spec sheets write an analysis the buyer does not want. Treating
// either as a requirement is what puts an unsatisfiable row on a certificate.
import { specFieldRequired } from './heavy-metals'

/** The analyses a COA can include. Mirrors CoaModel['sections']. */
export type CoaSectionKey =
  | 'micro' | 'cutLength' | 'residue' | 'pa'
  | 'heavyMetals' | 'moshMoah' | 'chloratePerchlorate' | 'glyphosate'

/** Whether each data source was found for this batch. */
export type CoaFound = {
  pasteuriser?: boolean; micro?: boolean; sieving?: boolean; residue?: boolean
  pa?: boolean; heavyMetals?: boolean; moshMoah?: boolean
  chloratePerchlorate?: boolean; glyphosate?: boolean
}

export type CoaGap = {
  label: string
  /**
   * The section to untick to drop this analysis, or null when it cannot be
   * dropped — the pasteuriser batch is the COA's own subject.
   */
  section: CoaSectionKey | null
  /** Where the result is captured. */
  href: string
  where: string
}

const LAB = '/quality/lab-results'
const PAST = '/quality/pasteuriser'

/**
 * Section → the `found` flag that satisfies it, and where to go and capture it.
 * A table rather than a chain of ifs so a new section cannot be added to the
 * COA without also declaring where its result comes from.
 *
 * Note `cutLength` is satisfied by `found.sieving`: the section is named for
 * what it prints, the flag for where the data lives. That mismatch is exactly
 * the kind of thing a hand-written chain gets wrong.
 */
const SECTION_SOURCE: Record<CoaSectionKey, { found: keyof CoaFound; label: string; href: string; where: string }> = {
  micro:               { found: 'micro',               label: 'Microbiology results',                          href: LAB,  where: 'Lab Results → Micro' },
  cutLength:           { found: 'sieving',             label: 'Sieving / cut-length (pasteuriser sieve samples)', href: PAST, where: 'Pasteuriser (sieve samples)' },
  residue:             { found: 'residue',             label: 'Pesticide residue',                             href: LAB,  where: 'Lab Results → Residue' },
  pa:                  { found: 'pa',                  label: 'Pyrrolizidine Alkaloids',                       href: LAB,  where: 'Lab Results → PA' },
  heavyMetals:         { found: 'heavyMetals',         label: 'Heavy metals',                                  href: LAB,  where: 'Lab Results → Heavy Metals' },
  moshMoah:            { found: 'moshMoah',            label: 'MOSH/MOAH',                                     href: LAB,  where: 'Lab Results → MOSH/MOAH' },
  chloratePerchlorate: { found: 'chloratePerchlorate', label: 'Chlorate/Perchlorate',                          href: LAB,  where: 'Lab Results → Chlorate/Perchlorate' },
  glyphosate:          { found: 'glyphosate',          label: 'Glyphosate',                                    href: LAB,  where: 'Lab Results → Glyphosate' },
}

/**
 * Does this COA include a Glyphosate row?
 *
 * This was `src.isOrganic || (spec ? req(spec.glyphosate) : found)`, which
 * forced the section on for EVERY organic batch no matter what the matched
 * customer spec said. Kunitaro's IPS-KUN-006 (RA-Organic) asks for no
 * glyphosate at all, so the section came on, no glyphosate result existed to
 * satisfy it, and the COA could not be generated — and because both managers
 * had already signed, the section was locked and the "Drop from COA" button
 * was disabled. A signed COA in that state can never be printed.
 *
 * The rule now: **when a customer spec matched, the spec is the authority.**
 * The buyer's specification is the document that says which analyses their
 * certificate carries; a blanket override defeats the point of matching one.
 * The organic default still applies where there is no spec to consult, which
 * is the case it was really written for.
 *
 * A result that exists never forces the section on by itself — an analysis the
 * buyer did not ask for does not belong on their certificate just because the
 * lab happened to run it. It can still be ticked by hand.
 */
export function wantsGlyphosateSection(a: {
  /** Did a customer spec match this batch at all? */
  specMatched: boolean
  /** The spec's glyphosate field, if a spec matched. */
  specValue?: unknown
  /** Is this an organic batch? */
  isOrganic?: boolean
  /** Is there a glyphosate lab result for this batch? */
  foundResult?: boolean
}): boolean {
  if (a.specMatched) return specFieldRequired(a.specValue)
  return !!a.isOrganic || !!a.foundResult
}

/**
 * An organic batch whose matched spec is silent on glyphosate. Not an error and
 * not a blocker — but the old code force-ticked exactly this case, so if the
 * lab does want glyphosate on an organic certificate they need to be told the
 * spec is not asking for it rather than discovering it missing after printing.
 */
export function glyphosateAdvisory(a: {
  specMatched: boolean
  specValue?: unknown
  isOrganic?: boolean
  sectionOn?: boolean
}): boolean {
  return !!a.isOrganic && a.specMatched && !specFieldRequired(a.specValue) && !a.sectionOn
}

/** Section order on the COA, so the blocker list reads in document order. */
export const COA_SECTION_ORDER: CoaSectionKey[] = [
  'micro', 'cutLength', 'residue', 'pa', 'heavyMetals', 'moshMoah', 'chloratePerchlorate', 'glyphosate',
]

/**
 * Analyses this COA includes but has no result for. Empty means it may be
 * generated.
 *
 * A section that is switched OFF is never a gap — dropping it IS the other
 * legitimate way to resolve one, and a COA that does not claim an analysis owes
 * no result for it.
 */
export function coaGaps(
  sections: Partial<Record<CoaSectionKey, boolean>> | null | undefined,
  found: CoaFound | null | undefined,
): CoaGap[] {
  const sec = sections ?? {}
  const f = found ?? {}
  const gaps: CoaGap[] = []

  // The batch itself comes first: without it there is no grade, moisture or
  // bulk density, so nothing else on the certificate means anything.
  if (!f.pasteuriser) {
    gaps.push({ label: 'Pasteuriser batch (grade, moisture, bulk density)', section: null, href: PAST, where: 'Pasteuriser' })
  }
  for (const key of COA_SECTION_ORDER) {
    if (!sec[key]) continue
    const src = SECTION_SOURCE[key]
    if (!f[src.found]) gaps.push({ label: src.label, section: key, href: src.href, where: src.where })
  }
  return gaps
}

/** Can this COA be printed / exported? */
export function canGenerateCoa(
  sections: Partial<Record<CoaSectionKey, boolean>> | null | undefined,
  found: CoaFound | null | undefined,
): boolean {
  return coaGaps(sections, found).length === 0
}

/**
 * Header fields that stay editable after both managers have signed, and whose
 * edits do NOT send the COA back for approval.
 *
 * These are commercial, not analytical: they are routinely filled in by
 * logistics after the analyses are done, and none of them changes what was
 * tested or what the result was.
 *
 * `destination` is deliberately NOT here. It names the customer, and the
 * customer decides which sieve spec the analyses were checked against — so
 * changing it after sign-off would silently re-point the certificate at a
 * different specification.
 */
export const COA_POST_SIGNOFF_EDITABLE: readonly string[] = [
  'date_of_issue', 'invoice_no', 'order_number', 'quantity_kg', 'quantity_bags',
]

/**
 * Is this header field locked? Only once BOTH managers have signed — a COA
 * mid-approval is still being worked on, and locking it at the lab signature
 * would leave the Quality Manager unable to correct anything before signing.
 */
export function coaHeaderFieldLocked(field: string, labSigned: boolean, qaSigned: boolean): boolean {
  if (!(labSigned && qaSigned)) return false
  return !COA_POST_SIGNOFF_EDITABLE.includes(field)
}

/** Are the results, specs and section choices fixed? */
export function coaContentLocked(labSigned: boolean, qaSigned: boolean): boolean {
  return labSigned && qaSigned
}

/**
 * Who may delete a generated COA: the two managers who sign it, and nobody
 * else. Deliberately not extended to full admins — this destroys a quality
 * record, and the people accountable for the document are its signatories.
 */
export function canDeleteGeneratedCoa(me: { isLab?: boolean; isQa?: boolean } | null | undefined): boolean {
  return !!(me?.isLab || me?.isQa)
}

/**
 * Who may withdraw a sign-off, sending a COA back down the chain to be
 * corrected. The same two managers who may delete one: a withdrawal removes a
 * signature, so only the people whose signatures are on the document.
 *
 * This exists because the lock had no way out. Once both managers signed, the
 * included sections were fixed — including a section ticked in error, which
 * then blocked generation with the "Drop from COA" button disabled. The answer
 * is not to let signed content be edited quietly; it is to withdraw the
 * sign-off, correct the COA, and have it signed again.
 */
export function canWithdrawCoaSignoff(me: { isLab?: boolean; isQa?: boolean } | null | undefined): boolean {
  return !!(me?.isLab || me?.isQa)
}
