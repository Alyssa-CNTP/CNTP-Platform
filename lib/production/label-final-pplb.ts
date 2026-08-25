/**
 * lib/production/label-final-pplb.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Thermal (PPLB / EPL2) version of the Pasteuriser FINAL-PRODUCT tag, for the
 * Argox CP-2140EX on the pasteuriser line.
 *
 * Sibling to label-final.ts (the browser/HTML version). Kept as its own file
 * rather than extending label-pplb.ts because that file is a signed-off design
 * for the in-process bag tag and must not shift.
 *
 * Geometry is inherited from label-pplb.ts on purpose — those coordinates were
 * corrected against real physical prints (overlapping header lines, badge text
 * clipping against its box, footer crowding the serial), and re-deriving them
 * from scratch would just re-earn the same bugs.
 *
 * DIFFERENCES FROM THE IN-PROCESS BAG TAG
 *   - badge shows the VARIANT ONLY, no grade. Final product is a blend of
 *     grades by definition, so no single letter is true (see label-final.ts).
 *   - a "BOX" / "PALLET" marker under the badge, because the two tags are
 *     physically interchangeable otherwise and a pallet tag scanned as a box
 *     would silently corrupt a stock count.
 *   - four footer cells instead of three: the box/bag number within the batch
 *     ("281 OF 315") is what the floor and the customer count in, and the
 *     bagging report records it per line, so it belongs on the tag.
 *
 * NO LOGO: the browser template carries the Cape Natural logo, this one does
 * not. Putting a bitmap on an Argox needs a GW/GM graphics download to printer
 * memory, and this printer has already been observed silently dropping a
 * downloaded custom font (see label-pplb.ts) — so an unproven bitmap download
 * risks tags that print blank on the floor. The logo stays browser-only until
 * a bitmap download is tested against the physical printer.
 */

import type { FinalProductLabel } from './label-final'

const VARIANT_SHORT: Record<string, string> = {
  'Conventional':    'CON',
  'Organic':         'ORG',
  'RA-Conventional': 'RA CON',
  'RA-Organic':      'RA ORG',
  'FT-ORG':          'FT ORG',
  'FT-CON':          'FT CON',
}

/** Escape/strip characters that would break an EPL2 quoted string. */
function clean(s: unknown): string {
  return String(s ?? '').replace(/"/g, "'").replace(/[\r\n]/g, ' ')
}

// Argox CP-2140EX, 203dpi = 8 dots/mm. Landscape 100mm × 49.2mm = 800 × 394.
const W = 800
const H = 394

// PPLB bitmap font cell widths in dots at multiplier 1 — used to centre text.
const FONT_W: Record<number, number> = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 32 }

function centreX(text: string, font: number, mult = 1): number {
  const w = text.length * FONT_W[font] * mult
  return Math.max(8, Math.round((W - w) / 2))
}

/** Code 128 set B worst case: START(11) + 11/char + CHECK(11) + STOP(13). */
function code128WidthDots(data: string, narrowDots: number): number {
  return (11 * (data.length + 2) + 13) * narrowDots
}

// SAST explicitly — a device with a drifted timezone must still print the South
// African production date (same reasoning as label-final.ts).
function sastDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-ZA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'Africa/Johannesburg',
  })
}

/** One final-product tag as a PPLB command block. */
export function buildFinalLabelPplb(l: FinalProductLabel): string {
  const isPallet = l.kind === 'pallet'

  const serial      = clean(l.serial).toUpperCase()
  const productName = clean(l.item).slice(0, 18).toUpperCase()
  const subLine     = clean([l.itemCode, l.packaging].filter(Boolean).join(' · ')).slice(0, 30).toUpperCase()
  const variant     = clean(VARIANT_SHORT[l.variant] ?? l.variant).toUpperCase()
  const lotValue    = clean(l.lot || 'N/A').toUpperCase()
  const dateValue   = clean(sastDate(l.date))

  // Third footer cell: what this unit is within the batch.
  const countLabel = isPallet ? 'BOXES' : 'BAG'
  const countValue = isPallet
    ? (l.boxCount != null
        ? `${l.boxCount}${l.startBagNo != null && l.endBagNo != null ? ` (${l.startBagNo}-${l.endBagNo})` : ''}`
        : '-')
    : (l.bagNo != null ? `${l.bagNo}${l.bagTotal ? ` OF ${l.bagTotal}` : ''}` : '-')

  // ── Badge: variant only, filled black box with reversed white text. Font 2
  // for the same reason label-pplb.ts pins it there — font 3 clipped against
  // the box edge on the physical printer. ──
  const BADGE_X0 = 528, BADGE_Y0 = 6, BADGE_W = 264, BADGE_H = 44
  const badgeFont = 2
  const badgeTextW = variant.length * FONT_W[badgeFont]
  const badgeTextX = Math.max(BADGE_X0 + 8, Math.round(BADGE_X0 + (BADGE_W - badgeTextW) / 2))
  const badgeTextY = BADGE_Y0 + 17

  // ── Kind marker directly under the badge: outlined box, normal text. ──
  const KIND_Y0 = BADGE_Y0 + BADGE_H + 6
  const KIND_H  = 30
  const kindText = isPallet ? 'PALLET' : 'BOX'
  const kindTextW = kindText.length * FONT_W[2]
  const kindTextX = Math.max(BADGE_X0 + 8, Math.round(BADGE_X0 + (BADGE_W - kindTextW) / 2))

  const NARROW = 3
  const barcodeW = code128WidthDots(serial, NARROW)
  const barcodeX = Math.max(40, Math.round((W - barcodeW) / 2))
  const BARCODE_Y = 112
  const BARCODE_H = 150   // ~18.5mm

  // ── Footer: four cells across 800 dots. Values use font 2 (10 dots/char)
  // rather than the 3-cell layout's font 3 — the widest real value, a batch
  // like "26249-CON-SFC" (13 chars), is 156 dots at font 3 and would run into
  // the next cell's 185-dot column. ──
  const FOOTER_X = [20, 215, 410, 600]
  const footer: [string, string][] = [
    ['LOT/BATCH', lotValue],
    [countLabel, clean(countValue).toUpperCase()],
    ['NET KG', `${l.weightKg.toFixed(1)} KG`],
    ['DATE', dateValue],
  ]

  const lines: string[] = [
    'N',                 // clear buffer
    `q${W}`,             // width 100mm
    `Q${H},24`,          // length 49.2mm, 3mm gap
    'D8',                // darkness
    'S4',                // speed

    // A pallet tag gets the double border — the same at-a-glance marker the
    // browser template uses, so the two versions of the tag read identically.
    // Header text shifts in to clear the inner border's y12 edge, matching how
    // label-pplb.ts handles its Fine Leaf border.
    ...(isPallet ? [`X4,4,2,${W - 4},${H - 4}`, `X12,12,2,${W - 12},${H - 12}`] : []),

    // ── Header ──
    `A${isPallet ? 24 : 20},${isPallet ? 20 : 6},0,4,2,2,N,"${productName}"`,
    `A${isPallet ? 24 : 20},78,0,3,1,1,N,"${subLine}"`,

    // ── Variant badge (filled, reversed) + kind marker (outlined) ──
    ...(variant ? [
      `LO${BADGE_X0},${BADGE_Y0},${BADGE_W},${BADGE_H}`,
      `A${badgeTextX},${badgeTextY},0,${badgeFont},1,1,R,"${variant}"`,
    ] : []),
    `X${BADGE_X0},${KIND_Y0},1,${BADGE_X0 + BADGE_W},${KIND_Y0 + KIND_H}`,
    `A${kindTextX},${KIND_Y0 + 8},0,2,1,1,N,"${kindText}"`,

    // ── Barcode, centred (HRI off — serial printed below in a real font) ──
    `B${barcodeX},${BARCODE_Y},0,1,${NARROW},${NARROW},${BARCODE_H},N,"${serial}"`,

    // ── Serial, centred under the barcode ──
    `A${centreX(serial, 4)},272,0,4,1,1,N,"${serial}"`,

    // ── Footer, four cells ──
    ...footer.flatMap(([label, value], i) => [
      `A${FOOTER_X[i]},326,0,1,1,1,N,"${label}"`,
      `A${FOOTER_X[i]},344,0,2,1,1,N,"${value}"`,
    ]),

    'P1',                // print 1 copy
  ]

  // Lead CRLF flushes any partial command left in the printer buffer.
  return '\r\n' + lines.join('\r\n') + '\r\n'
}

/**
 * A whole run of tags as one printer payload.
 *
 * Each label is a self-contained N…P1 block, so concatenating them queues the
 * range as a single job — the printer prints them back to back. This is the
 * thermal equivalent of the HTML sheet's one-page-per-label, and the reason a
 * 315-box batch is one socket write instead of 315.
 */
export function buildFinalLabelPplbBatch(labels: FinalProductLabel[]): string {
  return labels.map(buildFinalLabelPplb).join('')
}
