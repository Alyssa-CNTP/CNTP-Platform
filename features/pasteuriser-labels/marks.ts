/**
 * Certification marks, as inline SVG.
 *
 * Held as strings rather than files because every consumer needs them in a
 * different place — the React editor, the print HTML written into a popup
 * window, and the PDF proof — and an <img src> to a route would fail silently
 * in exactly the one that matters (the print window renders detached from the
 * app, and a missing certification mark on a printed organic label is not a
 * visual defect, it is a non-compliant bag).
 *
 * Every mark is a single-colour path so it survives a monochrome thermal
 * printer. `currentColor` lets the same string ride the surrounding text colour
 * on screen and go solid black on paper.
 *
 * ACCURACY NOTE — these are faithful renderings for on-screen design, proofing
 * and browser printing. Certification bodies license exact artwork, and where a
 * scheme requires its own supplied file (Rainforest Alliance and Fairtrade both
 * do), `officialArtworkRequired` is set so the editor says so rather than
 * letting a redrawn mark go out on a proof as if it were approved artwork.
 */

import type { LabelMarkKey } from '@/lib/core/labels'

export interface MarkArt {
  key: LabelMarkKey
  label: string
  /** Square viewBox SVG, no fill colour of its own beyond currentColor. */
  svg: string
  /**
   * True when the scheme licenses artwork that must be supplied by them.
   * The editor surfaces this; a redrawn mark is fine for internal layout but
   * must not be what goes to the certifier as final.
   */
  officialArtworkRequired: boolean
  /** Lines printed under the mark, built from the certification's numbers. */
  caption?: (c: { registrationNo?: string; operatorNo?: string; floId?: string }) => string[]
}

/**
 * The JAS mark — the leaf inside two concentric circles, with "JAS" set to its
 * right, over "CONTROL UNION CERTIFICATIONS" and the CU number.
 *
 * This is the mark Japan requires on organic product sold as organic there;
 * without it a consignment cannot be sold as organic and the whole container is
 * a problem. compliance.ts refuses to let a Japan organic template go out for
 * approval without it, which is the actual enforcement — this is just the art.
 */
const JAS_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="JAS organic mark">
  <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="3.5"/>
  <circle cx="50" cy="50" r="39" fill="none" stroke="currentColor" stroke-width="2.4"/>
  <!-- Leaf kept clear of the lettering. An earlier, wider leaf ran under the
       "J" and the mark read as "AS" at label size. -->
  <path d="M34 26 C23 35, 19 51, 24 63 C28 73, 39 75, 45 67 C52 58, 49 41, 34 26 Z"
        fill="currentColor"/>
  <path d="M34 26 C33 40, 31 53, 26 65" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
  <text x="70" y="60" font-family="Arial, Helvetica, sans-serif" font-size="19"
        font-weight="700" text-anchor="middle" fill="currentColor">JAS</text>
</svg>`.trim()

/** Control Union — the two interlocking waves inside a ring of lettering. */
// The lettering rides a full semicircular arc rather than a shallow one. An
// earlier shallow arc was shorter than the text, so "CONTROL UNION" was clipped
// to "CONTROL U" — visible only once rendered at label size.
const CONTROL_UNION_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Control Union">
  <defs>
    <path id="cu-arc" d="M6 52 A44 44 0 0 1 94 52" fill="none"/>
  </defs>
  <path d="M20 56 C32 44, 44 68, 56 56 C66 46, 76 50, 82 58
           C74 55, 68 56, 62 63 C50 77, 36 55, 24 65 Z" fill="currentColor"/>
  <path d="M20 74 C32 62, 44 86, 56 74 C66 64, 76 68, 82 76
           C74 73, 68 74, 62 81 C50 95, 36 73, 24 83 Z" fill="currentColor"/>
  <text font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="700"
        letter-spacing="0.5" fill="currentColor">
    <textPath href="#cu-arc" startOffset="50%" text-anchor="middle">CONTROL UNION</textPath>
  </text>
</svg>`.trim()

/** Rainforest Alliance — the frog seal. */
const RAINFOREST_ALLIANCE_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Rainforest Alliance">
  <circle cx="50" cy="50" r="46" fill="currentColor"/>
  <circle cx="50" cy="50" r="38" fill="#fff"/>
  <circle cx="50" cy="50" r="34" fill="currentColor"/>
  <ellipse cx="50" cy="56" rx="13" ry="16" fill="#fff"/>
  <circle cx="42" cy="40" r="8" fill="#fff"/>
  <circle cx="58" cy="40" r="8" fill="#fff"/>
  <circle cx="42" cy="40" r="3.4" fill="currentColor"/>
  <circle cx="58" cy="40" r="3.4" fill="currentColor"/>
  <path d="M31 52 C22 56, 20 68, 28 74 C31 68, 34 64, 39 62 Z" fill="#fff"/>
  <path d="M69 52 C78 56, 80 68, 72 74 C69 68, 66 64, 61 62 Z" fill="#fff"/>
</svg>`.trim()

/** Fairtrade — the black-and-white rendering of the FAIRTRADE Mark. */
const FAIRTRADE_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Fairtrade Mark">
  <rect x="4" y="4" width="92" height="92" rx="4" fill="currentColor"/>
  <path d="M18 62 C30 34, 52 26, 72 30 C60 34, 48 44, 40 62 Z" fill="#fff"/>
  <circle cx="62" cy="46" r="11" fill="#fff"/>
  <text x="50" y="86" font-family="Arial, Helvetica, sans-serif" font-size="13"
        font-weight="700" text-anchor="middle" fill="#fff">FAIRTRADE</text>
</svg>`.trim()

/** EU organic — the leaf of stars. */
const EU_ORGANIC_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="EU Organic">
  <rect x="4" y="18" width="92" height="64" rx="3" fill="currentColor"/>
  <g fill="#fff">
    <circle cx="24" cy="66" r="2.6"/><circle cx="31" cy="60" r="2.6"/>
    <circle cx="38" cy="55" r="2.6"/><circle cx="46" cy="51" r="2.6"/>
    <circle cx="55" cy="49" r="2.6"/><circle cx="64" cy="49" r="2.6"/>
    <circle cx="72" cy="51" r="2.6"/><circle cx="66" cy="41" r="2.6"/>
    <circle cx="57" cy="37" r="2.6"/><circle cx="48" cy="36" r="2.6"/>
    <circle cx="39" cy="38" r="2.6"/><circle cx="32" cy="43" r="2.6"/>
  </g>
</svg>`.trim()

/** USDA Organic. */
const USDA_ORGANIC_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="USDA Organic">
  <circle cx="50" cy="50" r="46" fill="currentColor"/>
  <path d="M4 50 A46 46 0 0 1 96 50 Z" fill="#fff"/>
  <text x="50" y="42" font-family="Arial, Helvetica, sans-serif" font-size="19"
        font-weight="700" text-anchor="middle" fill="currentColor">USDA</text>
  <text x="50" y="76" font-family="Arial, Helvetica, sans-serif" font-size="17"
        font-weight="700" text-anchor="middle" fill="#fff">ORGANIC</text>
</svg>`.trim()

/** Cape Natural Tea Products — the house mark. */
const CAPE_NATURAL_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cape Natural Tea Products">
  <ellipse cx="50" cy="56" rx="44" ry="26" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M50 20 C40 26, 36 34, 40 40 C46 38, 52 32, 50 20 Z" fill="currentColor"/>
  <text x="50" y="52" font-family="Georgia, serif" font-size="15" font-weight="700"
        text-anchor="middle" fill="currentColor">Cape</text>
  <text x="50" y="70" font-family="Georgia, serif" font-size="15" font-weight="700"
        text-anchor="middle" fill="currentColor">Natural</text>
</svg>`.trim()

export const MARK_ART: Readonly<Record<LabelMarkKey, MarkArt>> = {
  jas: {
    key: 'jas',
    label: 'JAS (Japan organic)',
    svg: JAS_SVG,
    officialArtworkRequired: false,
    caption: c => ['CONTROL UNION', 'CERTIFICATIONS', c.operatorNo ? `CU${c.operatorNo}` : ''].filter(Boolean),
  },
  control_union: {
    key: 'control_union',
    label: 'Control Union',
    svg: CONTROL_UNION_SVG,
    officialArtworkRequired: false,
    caption: c => (c.operatorNo ? [`CU ${c.operatorNo}`] : []),
  },
  rainforest_alliance: {
    key: 'rainforest_alliance',
    label: 'Rainforest Alliance',
    svg: RAINFOREST_ALLIANCE_SVG,
    officialArtworkRequired: true,
  },
  fairtrade: {
    key: 'fairtrade',
    label: 'Fairtrade (FLO)',
    svg: FAIRTRADE_SVG,
    officialArtworkRequired: true,
    caption: c => (c.floId ? [`FLO ID ${c.floId}`] : []),
  },
  eu_organic: {
    key: 'eu_organic',
    label: 'EU Organic leaf',
    svg: EU_ORGANIC_SVG,
    officialArtworkRequired: true,
    caption: c => (c.registrationNo ? [c.registrationNo] : []),
  },
  usda_organic: {
    key: 'usda_organic',
    label: 'USDA Organic',
    svg: USDA_ORGANIC_SVG,
    officialArtworkRequired: true,
  },
  cape_natural: {
    key: 'cape_natural',
    label: 'Cape Natural Tea Products',
    svg: CAPE_NATURAL_SVG,
    officialArtworkRequired: false,
  },
}

export const MARK_KEYS = Object.keys(MARK_ART) as LabelMarkKey[]
