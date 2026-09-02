/**
 * One owner for what a material is CALLED.
 *
 * The floor, the platform and Acumatica had drifted into three names for the
 * same thing. Sticks was the worst case — four names for one material:
 *
 *     Acumatica  15IGST-C   "Sticks"          <- what the BOM and the import use
 *     Sieving    "Rolsiev Sticks"             <- what the operator picked
 *     Refining   "Sticks"                     <- and then had to alias back
 *     Serial     RS, later HS                 <- what got printed on the bag
 *
 * A bag could be tagged "ROLSIEV STICKS", carry an HS serial, and import into
 * Acumatica as "Sticks". Nobody could line those up by eye, which is the whole
 * problem: the operator, the tag and the import have to agree.
 *
 * Canonical = whatever Acumatica calls it. Acumatica is the system the data
 * ends up in, and it is the one name we do not control.
 *
 * ── Why an exact-match table and not regexes ────────────────────────────────
 *
 * lib/core/serials.ts folds names with ordered regexes, and that file documents
 * why the order is load-bearing: /\bstick/i matches "Indent Sticks" too, so the
 * indent rule has to be tested first or Indent Sticks silently becomes Heavy
 * Sticks. That works because the list is closed and pinned by tests.
 *
 * Naming is not a closed list — new products get added. A substring rule
 * written today will one day swallow a product that does not exist yet, and it
 * will do it silently, at the point where a bag is being labelled. So this
 * table matches whole names only, and anything it does not recognise passes
 * through UNCHANGED. A new product is then merely unaliased, which is correct
 * by default, rather than quietly mislabelled.
 */

/** Variant words that appear appended to a stored product type, longest first. */
const VARIANT_SUFFIXES = [
  'Fairtrade Conventional', 'Fairtrade Organic',
  'RA Conventional', 'RA Organic', 'RA-Conventional', 'RA-Organic',
  'FT Conventional', 'FT Organic', 'FT-CON', 'FT-ORG',
  'Conventional', 'Organic',
] as const

/**
 * Strips a trailing " - Conventional" style variant word.
 *
 * Some historic rows stored the variant in the product type ("Indent Sticks -
 * Conventional" sits in bag_tags today), which splits one product into two on
 * every group-by. The variant is carried in its own column, so it does not
 * belong in the name.
 */
export function stripVariantSuffix(name: string): string {
  const trimmed = String(name ?? '').trim()
  for (const v of VARIANT_SUFFIXES) {
    const suffix = ` - ${v}`
    if (trimmed.toLowerCase().endsWith(suffix.toLowerCase())) {
      return trimmed.slice(0, -suffix.length).trim()
    }
  }
  return trimmed
}

/**
 * Every name a material has been called => the one Acumatica calls it.
 *
 * Keys are compared case-insensitively with whitespace collapsed. Add a row
 * here when a name changes; never rewrite the history rows that still hold the
 * old one, because a serial already printed on a bag in the warehouse is that
 * bag's identity and the record has to keep matching the sticker.
 */
const CANONICAL_BY_ALIAS: Readonly<Record<string, string>> = {
  // Sticks — Acumatica 15IGST, "Sticks". Renamed in the UI so the operator, the
  // printed tag and the Acumatica import finally read the same word.
  'rolsiev sticks': 'Sticks',
  'rolsiev e sticks': 'Sticks',
  'heavy sticks': 'Sticks',
  'heavy stick': 'Sticks',
  'sticks (rs)': 'Sticks',
  'rs': 'Sticks',

  // NOT aliased, on purpose:
  //   'Indent Sticks'  — Acumatica 15IGIS, a different item with its own code.
  //   'Cut Heavy Stick Fine' / 'Cut Heavy Stick Coarse' — Acumatica 20BGCHS-F /
  //     -C, Refining 2 outputs. "Heavy Stick" appears inside both names, which
  //     is exactly why this table matches whole names and not substrings.
}

function normaliseKey(name: string): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The canonical name for a material, whatever it was called when it was stored.
 *
 * Use this everywhere a product type is grouped, compared, displayed or
 * printed. Unrecognised names come back unchanged (see the header) — the
 * variant suffix is still stripped, since that is a formatting artefact rather
 * than a different name.
 */
export function canonicalProductType(name: string | null | undefined): string {
  const base = stripVariantSuffix(String(name ?? ''))
  if (!base) return ''
  return CANONICAL_BY_ALIAS[normaliseKey(base)] ?? base
}

/** True when two product names refer to the same material. */
export function sameProduct(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalProductType(a)
  const cb = canonicalProductType(b)
  return ca !== '' && normaliseKey(ca) === normaliseKey(cb)
}
