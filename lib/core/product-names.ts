/**
 * One owner for what a material is CALLED.
 *
 * The floor, the platform and Acumatica had drifted into several names for the
 * same thing. Heavy Sticks was the worst case — four names for one material:
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
 * ── Canonical here is the FLOOR name, not the Acumatica one ─────────────────
 *
 * These two layers are allowed to differ, and for Heavy Sticks they do:
 *
 *     floor / tag / this module     "Heavy Sticks"   <- what an operator says
 *     Acumatica item                15IGST "Sticks"  <- what the import needs
 *
 * The operator is the one who has to recognise the material in a picker and on
 * a printed tag at the machine, so the floor name wins here. The Acumatica name
 * is not lost — it is resolved separately, from the item id, by
 * features/acumatica-items. One material, one floor name, one item id, and an
 * explicit mapping between them instead of four names and no mapping.
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
 * Every name a material has been called => its canonical FLOOR name.
 *
 * Keys are compared case-insensitively with whitespace collapsed. Add a row
 * here when a name changes; never rewrite the history rows that still hold the
 * old one, because a serial already printed on a bag in the warehouse is that
 * bag's identity and the record has to keep matching the sticker.
 */
const CANONICAL_BY_ALIAS: Readonly<Record<string, string>> = {
  // Heavy Sticks. Acumatica knows this item as 15IGST / "Sticks"; the floor
  // calls it Heavy Sticks, and so now do the picker and the printed tag.
  // 'Sticks' on its own is an alias, not the canonical name — it is what
  // Acumatica and the older Refining input lists call it.
  'rolsiev sticks': 'Heavy Sticks',
  'rolsiev e sticks': 'Heavy Sticks',
  'sticks': 'Heavy Sticks',
  'sticks (rs)': 'Heavy Sticks',
  'heavy stick': 'Heavy Sticks',
  'rs': 'Heavy Sticks',

  // RB Blocks. Same shape as Heavy Sticks: Acumatica's item description is
  // "Blocks: Clean" (15IGBL-C), so the picker showed
  // "15IGBL-C-C · Blocks: Clean - Conventional" while the Sieving capture
  // screen, its output grouping and the Acumatica summary all say "RB Blocks".
  // Quality had a third name again, "Rooibos Blocks".
  //
  // RB Blocks is canonical because it is what the operator reads on the
  // capture screen and what OUTPUT_GROUP_ORDER in SievingCapture already
  // sorts by. The Acumatica description is not lost — it is resolved from the
  // item id by features/acumatica-items, exactly as for Sticks.
  'blocks: clean': 'RB Blocks',
  'blocks clean': 'RB Blocks',
  'rooibos blocks': 'RB Blocks',
  'rb block': 'RB Blocks',
  'blocks': 'RB Blocks',

  // NOT aliased, on purpose:
  //   'Blocks: Cut' / 'Blocks Cut' / 'CHS' — Acumatica 15IGBL-D and the
  //     20BGCHS-* items. A different material from clean Blocks, and the
  //     Acumatica summary reports the two on separate lines (C vs D).
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
