import type { OutputBag } from './live-types'

const GRADE_SHORT: Record<string, string> = {
  A: 'Export',
  B: 'Export Blend',
  C: 'Domestic',
}

// Full Acumatica variant word → short code shown in the TYPE/GRADE badge —
// must match capture-config.ts VARIANT_OPTIONS short values.
const VARIANT_SHORT: Record<string, string> = {
  'Conventional':    'CON',
  'Organic':         'ORG',
  'RA-Conventional': 'RA CON',
  'RA-Organic':      'RA ORG',
  'FT-ORG':          'FT ORG',
  'FT-CON':          'FT CON',
}

// Escape/strip characters that would break an EPL2 quoted string.
function clean(s: string): string {
  return String(s ?? '').replace(/"/g, "'").replace(/[\r\n]/g, ' ')
}

// ── Geometry ────────────────────────────────────────────────────────────────
// Argox CP-2140EX / CP-2140EX PRO, 203dpi = 8 dots/mm.
// Landscape label 100mm × 49.2mm = 800 × 394 dots. Origin top-left.
const W = 800
const H = 394

// PPLB bitmap font cell sizes in dots at multiplier 1 — used to centre text.
// A downloaded custom font (id 900, Arial) was tried here for the product
// name/serial but the printer silently dropped both lines — the built-in
// bitmap fonts are what's confirmed to actually print.
const FONT_W: Record<number, number> = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 32 }

function centreX(text: string, font: number, mult = 1): number {
  const w = text.length * FONT_W[font] * mult
  return Math.max(8, Math.round((W - w) / 2))
}

// Code 128 symbol width in dots. Set B worst case: START(11) + 11 per data char
// + CHECK(11) + STOP(13). Used to centre the barcode for any serial length.
function code128WidthDots(data: string, narrowDots: number): number {
  return (11 * (data.length + 2) + 13) * narrowDots
}

/**
 * Bag tag in PPLB (EPL2-compatible), for the Argox printers.
 *
 * Layout — "barcode hero", balanced for a 100 × 49.2mm landscape label:
 *   product name + section          top-left
 *   TYPE/GRADE badge                top-right, filled black box, white text
 *   Code 128 barcode                centred, ~18.5mm tall (spec: 25-35mm was
 *                                   over half the label height and forced the
 *                                   header/footer against the edges)
 *   serial in human-readable text   centred beneath the barcode, no rule above it
 *   LOT/BATCH · WEIGHT · DATE       footer row, three columns
 *
 * PPLB command reference:
 *   N                                 clear image buffer
 *   q<dots> / Q<dots>,<gap>           label width / length,gap
 *   D<0-15> / S<speed>                darkness / print speed
 *   A x,y,rot,font,hm,vm,rev,"data"   text
 *   B x,y,rot,type,nw,wd,h,HRI,"data" barcode ("1" = Code 128)
 *   LO x,y,width,height               filled black box (thin = rule line)
 *   X x1,y1,thickness,x2,y2           box outline
 *   P<copies>                         print
 */
export function buildLabelPplb(bag: OutputBag): string {
  const gradeShort = GRADE_SHORT[bag.grade] ?? bag.grade

  const dateFormatted = new Date(bag.created_at).toLocaleDateString('en-ZA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  const lotValue     = bag.lot_number || 'N/A'
  const weightValue  = `${bag.weight_kg} kg`
  const productName  = clean(bag.product_type).slice(0, 26)
  const sectionName  = clean(bag.section_name).slice(0, 30)
  const serial       = clean(bag.serial_number)
  const variantShort = clean(VARIANT_SHORT[bag.variant] ?? bag.variant)

  // TYPE/GRADE badge: filled black box, single reversed (white) line, e.g.
  // "CON - Export" — the two facts an operator needs at a glance, no separate
  // labels. Grade B ("Export Blend") makes this noticeably longer than grade A
  // ("Export") — drop to the smaller font well before the box edge, not right
  // up against it, so it never looks cramped/clipped like "CON - Export Blen".
  const badgeText  = `${variantShort} - ${clean(gradeShort)}`
  const BADGE_X0 = 528, BADGE_Y0 = 6, BADGE_W = 264, BADGE_H = 44
  const badgeFont  = badgeText.length <= 14 ? 3 : 2
  const badgeTextW = badgeText.length * FONT_W[badgeFont]
  const badgeTextX = Math.max(BADGE_X0 + 8, Math.round(BADGE_X0 + (BADGE_W - badgeTextW) / 2))
  const badgeTextY = BADGE_Y0 + (badgeFont === 3 ? 15 : 17)

  // Narrow bar 3 dots makes the symbol span ~2/3 of the label width — wider bars
  // scan more reliably than the previous 2-dot version, and it fills the dead
  // space either side while keeping a quiet zone well above the 5mm minimum.
  const NARROW = 3
  const barcodeW = code128WidthDots(serial, NARROW)
  const barcodeX = Math.max(40, Math.round((W - barcodeW) / 2))
  const BARCODE_Y = 90
  const BARCODE_H = 150   // ~18.5mm

  const lines: string[] = [
    'N',                 // clear buffer
    `q${W}`,             // width 100mm
    `Q${H},24`,          // length 49.2mm, 3mm gap
    'D8',                // darkness
    'S4',                // speed

    // ── Header ──
    `A20,12,0,4,1,1,N,"${productName}"`,
    `A20,42,0,1,1,1,N,"${sectionName}"`,

    // ── Type / grade badge, top-right: filled black box, reversed white text ──
    `LO${BADGE_X0},${BADGE_Y0},${BADGE_W},${BADGE_H}`,
    `A${badgeTextX},${badgeTextY},0,${badgeFont},1,1,R,"${badgeText}"`,

    // ── Barcode, centred (HRI off — serial is printed below in a real font) ──
    `B${barcodeX},${BARCODE_Y},0,1,${NARROW},${NARROW},${BARCODE_H},N,"${serial}"`,

    // ── Serial, centred under the barcode ──
    `A${centreX(serial, 4)},250,0,4,1,1,N,"${serial}"`,

    // ── Footer (no rule — matches the browser preview) ──
    `A20,304,0,1,1,1,N,"LOT/BATCH"`,
    `A20,322,0,3,1,1,N,"${clean(lotValue)}"`,
    `A290,304,0,1,1,1,N,"WEIGHT"`,
    `A290,322,0,3,1,1,N,"${clean(weightValue)}"`,
    `A560,304,0,1,1,1,N,"DATE"`,
    `A560,322,0,3,1,1,N,"${clean(dateFormatted)}"`,

    'P1',                // print 1 copy
  ]

  // Lead CRLF flushes any partial command left in the printer buffer.
  return '\r\n' + lines.join('\r\n') + '\r\n'
}
