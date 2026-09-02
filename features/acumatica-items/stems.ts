/**
 * Canonical floor product → the Acumatica id STEM it lives under.
 *
 * A stem is the id without its variant suffix: '15IGST', not '15IGST-C'. This
 * table says WHERE to look; the catalogue says whether the item is actually
 * there. That split is the whole point of the module — see resolve.ts.
 *
 * The names on the left are canonical (lib/core/product-names.ts), so 'Sticks'
 * appears once and every historic spelling of it folds onto that entry before
 * it gets here.
 */

const PACKED_BY_BOM =
  'A packing format, not a material — the finished-good item comes from the BOM of the run (production.bom_components).'

/** Grade letter → the leaf family segment of the stem. */
const LEAF_FAMILY: Readonly<Record<string, string>> = { A: 'E', B: 'BL', C: 'D' }

export interface StemRule {
  /** The stem, or a function of the grade for the grade-dependent leaf items. */
  stem: string | ((grade: string) => string | null)
  /** The production-order phantom this output rolls up to, if any. */
  phantom?: (grade: string) => string | null
  /**
   * Set when the product has no Acumatica item ON PURPOSE — waste and
   * work-in-progress streams that are captured for mass balance but never
   * booked into stock. Distinguishing this from "we could not find it" is the
   * difference between a clean blank and a silent failure.
   */
  noItem?: string
}

export const STEMS: Readonly<Record<string, StemRule>> = {
  // ── Sieving ────────────────────────────────────────────────────────────────
  'Fine Leaf': {
    stem: (g) => (LEAF_FAMILY[g] ? `10LG${LEAF_FAMILY[g]}F` : null),
    phantom: (g) => (LEAF_FAMILY[g] ? `S10LG${LEAF_FAMILY[g]}` : null),
  },
  'Coarse Leaf': {
    stem: (g) => (LEAF_FAMILY[g] ? `10LG${LEAF_FAMILY[g]}C` : null),
    phantom: (g) => (LEAF_FAMILY[g] ? `S10LG${LEAF_FAMILY[g]}` : null),
  },
  'RB Blocks':    { stem: '15IGBL-C' },
  // Floor name Heavy Sticks; Acumatica 15IGST "Sticks". The two layers differ
  // on purpose — see lib/core/product-names.ts.
  'Heavy Sticks': { stem: '15IGST' },
  'Indent Sticks': { stem: '15IGIS' },
  'Brown Dust':   { stem: '15IGDB' },
  'Powder Dust':  { stem: '15IGDPOWDR' },
  'Bucket Elevator Spillage': {
    stem: '',
    noItem: 'Recovered spillage — captured for mass balance, never booked into stock.',
  },

  // ── Refining 1 ─────────────────────────────────────────────────────────────
  'Indent Dust':  { stem: '15IGDIS' },
  'White Dust':   { stem: '15IGDW' },

  // ── Refining 2 ─────────────────────────────────────────────────────────────
  'Cut Heavy Stick Fine':   { stem: '20BGCHS-F' },
  'Cut Heavy Stick Coarse': { stem: '20BGCHS-C' },

  // ── Granule Line ───────────────────────────────────────────────────────────
  // The -001 / -002 pairs are different recipes, not a versioning artefact: the
  // Acumatica description carries the mix (20BGGF-001 is 67BD|25IS|8POW,
  // 20BGGF-002 is 56BD|36IS|8POW). They must not collapse onto one another.
  'SG Granules':         { stem: '20BGGSG-001' },
  'SF Granules':         { stem: '20BGGF-001' },
  'Export Granules':     { stem: '20BGGE-001' },
  'SG Granules 002':     { stem: '20BGGSG-002' },
  'SF Granules 002':     { stem: '20BGGF-002' },
  'Export Granules 002': { stem: '20BGGE-002' },
  'SG Dust':             { stem: '15IGDSG' },
  'SF Dust':             { stem: '15IGDSF' },
  'ALT Dust':            { stem: '15IGDALT' },
  'Blocks Dirty':        { stem: '15IGBLD' },
  'Leaf Grade Dust':     { stem: '15IGDLG' },
  'Pasteurised Dust':    { stem: '15IGPASTDB' },

  // ── Pasteuriser ─────────────────────────────────────────────────────────────────
  // These are PACKING FORMATS, not materials — a 30FP* finished good goes into
  // a bulk bag, a box or a paper bag. The item is the finished good, which comes
  // from the Pasteuriser BOM, so there is nothing for a product name to resolve.
  'Bulk Bag 500kg': { stem: '', noItem: PACKED_BY_BOM },
  'Box 18kg':       { stem: '', noItem: PACKED_BY_BOM },
  'Paper Bag 18kg': { stem: '', noItem: PACKED_BY_BOM },
  'By-product':     { stem: '', noItem: 'Pasteuriser by-product — booked against the by-product line of the BOM for the run, not against a product name.' },

  // ── Blender ────────────────────────────────────────────────────────────────
  'Blended Batch': {
    stem: '',
    noItem: 'A blend\'s output item comes from its BOM (production.bom_components), not from the product name — see lib/production/bom.ts.',
  },
}

/** Grade letter → the raw-material stem consumed at Sieving. */
export const INPUT_STEMS: Readonly<Record<string, string>> = {
  A: '05RMDE',
  B: '05RMDBL',
  C: '05RMDD',
}

/**
 * Older spellings that are NOT product renames — they are alternative labels
 * for the same stem that appear in section configs and stored rows. Folded
 * here rather than in product-names.ts, because product-names owns what the
 * FLOOR calls a material and these are not floor names.
 */
export const STEM_ALIASES: Readonly<Record<string, string>> = {
  'Dirty Blocks': 'Blocks Dirty',
  'LG Dust':      'Leaf Grade Dust',
  'Past Dust':    'Pasteurised Dust',
}
