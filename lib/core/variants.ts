/**
 * Variant identity and segregation — the one owner.
 *
 * A variant answers two different questions and they must never drift apart:
 *
 *   1. WHICH variant is this?   -> normaliseVariant()  — for storage and codes
 *   2. May these two mix?       -> variantFamily()     — for segregation
 *
 * Organic and conventional are separate physical pools. Keeping them apart is a
 * certification requirement, not a preference, so the rule that decides it is
 * core: pure, tested, and impossible for a feature to hold a private opinion
 * about.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 *
 * It didn't, and by 2026-09-03 there were FOUR copies of this rule that did not
 * agree with each other:
 *
 *   lib/production/capture-config.ts   isOrganicVariant()  exact Set lookup, no
 *                                                          normalisation at all
 *   lib/production/bucket-elevator.ts  variantFamily()     built on the above
 *   lib/production/scan-utils.ts       variantFamily()     normalised first
 *   lib/production/validate-scan.ts    variantFamily()     private 4th copy
 *
 * On the short codes the app's own forms send, they returned opposite answers:
 *
 *   input      capture-config/ledger   scan-utils
 *   'ORG'      conventional            organic      <- disagree
 *   'RA-ORG'   conventional            organic      <- disagree
 *   'O'        conventional            organic      <- disagree
 *   'RO'       conventional            organic      <- disagree
 *   'FO'       conventional            organic      <- disagree
 *
 * The carry-over ledger was on the wrong side of that table. It is keyed on
 * variant family precisely so organic and conventional can never pool — and it
 * would have filed organic leftovers into the conventional pool for any of
 * those five spellings.
 *
 * ── Fail closed ─────────────────────────────────────────────────────────────
 *
 * `variantFamily()` returns `null` for anything it does not recognise. It never
 * guesses 'conventional'. The ledger copy did guess, which meant an
 * unrecognised variant — a typo, a variant added to the DB but not to the list
 * — silently became conventional. An unknown variant must stop the operation
 * and ask a human, because the cost of pooling organic into conventional is a
 * certification failure and the cost of stopping is one question.
 */

/** Canonical variant, as stored. Matches the bag_tags.variant CHECK constraint. */
export type Variant =
  | 'Conventional'
  | 'Organic'
  | 'RA-Conventional'
  | 'RA-Organic'
  | 'FT-CON'
  | 'FT-ORG'

/** The two physical pools. Material never crosses between them. */
export type VariantFamily = 'conventional' | 'organic'

export const VARIANTS: readonly Variant[] = [
  'Conventional', 'Organic', 'RA-Conventional', 'RA-Organic', 'FT-CON', 'FT-ORG',
]

/**
 * Every spelling the app, the database and Acumatica have produced for a
 * variant, mapped to the canonical one. Keys are compared lower-cased and
 * trimmed, so only distinct spellings need listing, not distinct casings.
 *
 * Be generous on input and exact on output: these strings arrive from six
 * different places (form values, short UI labels, inventory id suffixes,
 * Acumatica words, legacy rows, OCR of a paper tag) and rejecting a legitimate
 * spelling is what makes a caller fall back to a guess.
 */
const ALIASES: Readonly<Record<string, Variant>> = {
  // Canonical, passed through
  'conventional':      'Conventional',
  'organic':           'Organic',
  'ra-conventional':   'RA-Conventional',
  'ra-organic':        'RA-Organic',
  'ft-con':            'FT-CON',
  'ft-org':            'FT-ORG',

  // Short codes the capture forms send
  'con':               'Conventional',
  'org':               'Organic',
  'ra-con':            'RA-Conventional',
  'ra-org':            'RA-Organic',
  'ft con':            'FT-CON',
  'ft org':            'FT-ORG',

  // Acumatica inventory id suffixes (05RMDE-FC -> Fairtrade Conventional)
  'c':                 'Conventional',
  'o':                 'Organic',
  'rc':                'RA-Conventional',
  'ro':                'RA-Organic',
  'fc':                'FT-CON',
  'fo':                'FT-ORG',

  // Spaced / spelled-out forms from legacy rows, Acumatica and the QC screens
  'ra conventional':        'RA-Conventional',
  'ra organic':             'RA-Organic',
  'ft-conventional':        'FT-CON',
  'ft-organic':             'FT-ORG',
  'ft conventional':        'FT-CON',
  'ft organic':             'FT-ORG',
  'fairtrade conventional': 'FT-CON',
  'fairtrade organic':      'FT-ORG',
}

/** Which family each canonical variant belongs to. Exhaustive by construction. */
const FAMILY: Readonly<Record<Variant, VariantFamily>> = {
  'Conventional':    'conventional',
  'RA-Conventional': 'conventional',
  'FT-CON':          'conventional',
  'Organic':         'organic',
  'RA-Organic':      'organic',
  'FT-ORG':          'organic',
}

/** Acumatica inventory id suffix for a variant. */
const SUFFIX: Readonly<Record<Variant, string>> = {
  'Conventional':    'C',
  'Organic':         'O',
  'RA-Conventional': 'RC',
  'RA-Organic':      'RO',
  'FT-CON':          'FC',
  'FT-ORG':          'FO',
}

/**
 * Resolve any spelling of a variant to the canonical one.
 * Returns `null` when the input is not a variant we know — never a guess.
 */
export function normaliseVariant(v: string | null | undefined): Variant | null {
  if (!v) return null
  return ALIASES[String(v).trim().toLowerCase()] ?? null
}

/**
 * Which physical pool this material belongs to.
 *
 * `null` means "not determinable" and must be treated as a stop, not as
 * conventional. See the fail-closed note in the module header.
 */
export function variantFamily(v: string | null | undefined): VariantFamily | null {
  const canonical = normaliseVariant(v)
  return canonical ? FAMILY[canonical] : null
}

/**
 * Organic — including Fairtrade Organic, which does not contain the word
 * "Organic" and was missed by the string-matching version of this check.
 *
 * Note the asymmetry with `mayPoolMaterial()`: an unrecognised variant is not
 * organic (this returns false) but is also not safe to pool (that returns false
 * too). Use this one to describe material, and that one to decide whether an
 * operation may proceed.
 */
export function isOrganicVariant(v: string | null | undefined): boolean {
  return variantFamily(v) === 'organic'
}

/**
 * Whether two lots of material may occupy the same pool — the same bucket
 * elevator, the same carry-over balance, the same blend.
 *
 * False when either side is unrecognised. Two unknowns are not "probably the
 * same".
 */
export function sameVariantFamily(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const fa = variantFamily(a)
  return fa !== null && fa === variantFamily(b)
}

/**
 * Whether leftover material of this variant may be pooled into a record it did
 * not come from — carried across a changeover, added to a carry-over ledger,
 * combined with another run's balance.
 *
 * Only conventional material, and only when we are certain it is conventional.
 * Organic is segregated; an unknown variant is refused rather than assumed.
 */
export function mayPoolMaterial(v: string | null | undefined): boolean {
  return variantFamily(v) === 'conventional'
}

/** Acumatica inventory id suffix, or `null` if the variant is unrecognised. */
export function variantSuffix(v: string | null | undefined): string | null {
  const canonical = normaliseVariant(v)
  return canonical ? SUFFIX[canonical] : null
}
