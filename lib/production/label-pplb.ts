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

  const lotValue     = (bag.lot_number || 'N/A').toUpperCase()
  const weightValue  = `${bag.weight_kg} KG`
  // Shorter cap than before — the header font is now much larger (see below),
  // so it can't fit as many characters across the available width.
  const productName  = clean(bag.product_type).slice(0, 18).toUpperCase()
  const sectionName  = clean(bag.section_name).slice(0, 30).toUpperCase()
  const serial       = clean(bag.serial_number).toUpperCase()
  const variantShort = clean(VARIANT_SHORT[bag.variant] ?? bag.variant).toUpperCase()

  // TYPE/GRADE badge: filled black box, single reversed (white) line, e.g.
  // "CON - Export" — the two facts an operator needs at a glance, no separate
  // labels. Always font 2 — the larger font 3 clipped against the box edge on
  // the physical printer even for "CON - Domestic" (14 chars), so the FONT_W
  // table's assumed glyph width for font 3 can't be trusted for this badge.
  const badgeText  = `${variantShort} - ${clean(gradeShort).toUpperCase()}`
  const BADGE_X0 = 528, BADGE_Y0 = 6, BADGE_W = 264, BADGE_H = 44
  const badgeFont  = 2
  const badgeTextW = badgeText.length * FONT_W[badgeFont]
  const badgeTextX = Math.max(BADGE_X0 + 8, Math.round(BADGE_X0 + (BADGE_W - badgeTextW) / 2))
  const badgeTextY = BADGE_Y0 + 17

  // Half-bag Top-up distinctive treatment — mirrors buildLabelHtml's
  // approved black-band + history-strip design (lib/production/
  // label-print.ts), adapted to fixed-position PPLB text/box commands.
  // Geometry below has NOT been verified against a physical print (no
  // printer reachable in this environment) — check the first real print
  // carefully, same caveat as the ZPL template.
  const hasTopUps = !!bag.topUps?.length
  const hasTarget = bag.targetWeightKg != null
  const remainingToTarget = hasTarget ? Math.max(0, (bag.targetWeightKg as number) - bag.weight_kg) : 0
  const targetReached = hasTarget && remainingToTarget <= 0
  const targetLine = targetReached ? 'REACHED' : `NEED +${remainingToTarget.toFixed(0)}KG`
  const todayFormatted = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: '2-digit' })
  const showBand = hasTopUps || hasTarget

  // Narrow bar 3 dots makes the symbol span ~2/3 of the label width — wider bars
  // scan more reliably than the previous 2-dot version, and it fills the dead
  // space either side while keeping a quiet zone well above the 5mm minimum.
  const NARROW = 3
  const barcodeW = code128WidthDots(serial, NARROW)
  const barcodeX = Math.max(40, Math.round((W - barcodeW) / 2))
  // Pushed down from 90 — the section name at y78 was printing straight into
  // the barcode on every label (all products, not just Fine Leaf); font 3's
  // real glyph height is taller than the old 12-dot gap allowed for.
  // When the top-up band is shown, the barcode is pushed down further and
  // shortened to make room, and the serial follows it at the same 10-dot gap.
  const BAND_Y0 = 96, BAND_H = 36
  const BARCODE_Y = showBand ? 140 : 112
  const BARCODE_H = showBand ? 106 : 150   // ~18.5mm, ~13.1mm when banded
  const SERIAL_Y = BARCODE_Y + BARCODE_H + 10

  // Fine Leaf is the "more important" product — since the paper roll can no
  // longer colour-code it, it gets a double border around the whole label
  // instead. Coarse Leaf and everything else stays plain. Compare against the
  // untruncated product type, not the header's shortened display string.
  const isFineLeaf = bag.product_type === 'Fine Leaf'

  const lines: string[] = [
    'N',                 // clear buffer
    `q${W}`,             // width 100mm
    `Q${H},24`,          // length 49.2mm, 3mm gap
    'D8',                // darkness
    'S4',                // speed

    // ── Fine Leaf double border ──
    ...(isFineLeaf ? [`X4,4,2,${W - 4},${H - 4}`, `X12,12,2,${W - 12},${H - 12}`] : []),

    // ── Header — no colour-coded paper anymore (one printer/roll per station),
    // so the product name has to carry the Fine/Coarse Leaf distinction on its
    // own: doubled size (hm2,vm2) instead of the old single-size inline line,
    // stacked over a correspondingly bigger section name. Section name's y is
    // pushed well below the product name's y — vm2 roughly doubles the glyph
    // height, and the first physical print showed the two lines overlapping
    // at the old 44-dot gap. All header/badge/footer text is uppercase now.
    // For Fine Leaf, the text also starts at x24/y20 instead of x20/y6 — the
    // inner border's top edge sits at y12, and the tall vm2 text was starting
    // above it and printing straight through the line. ──
    `A${isFineLeaf ? 24 : 20},${isFineLeaf ? 20 : 6},0,4,2,2,N,"${productName}"`,
    `A${isFineLeaf ? 24 : 20},78,0,3,1,1,N,"${sectionName}"`,

    // ── Type / grade badge, top-right: filled black box, reversed white text ──
    `LO${BADGE_X0},${BADGE_Y0},${BADGE_W},${BADGE_H}`,
    `A${badgeTextX},${badgeTextY},0,${badgeFont},1,1,R,"${badgeText}"`,

    // ── Half-bag Top-up band: filled black box, reversed white text — same
    // treatment as the TYPE/GRADE badge above, spanning the full width. ──
    ...(showBand ? [
      `LO16,${BAND_Y0},${W - 32},${BAND_H}`,
      `A28,${BAND_Y0 + 9},0,2,1,1,R,"${hasTopUps ? 'TOPPED UP' : 'TARGET SET'}"`,
      `A${W - 32 - 'REPRINTED 00/00'.length * FONT_W[1]},${BAND_Y0 + 11},0,1,1,1,R,"${hasTopUps ? `REPRINTED ${todayFormatted}` : todayFormatted}"`,
    ] : []),

    // ── Barcode, centred (HRI off — serial is printed below in a real font) ──
    `B${barcodeX},${BARCODE_Y},0,1,${NARROW},${NARROW},${BARCODE_H},N,"${serial}"`,

    // ── Serial, centred under the barcode ──
    `A${centreX(serial, 4)},${SERIAL_Y},0,4,1,1,N,"${serial}"`,

    // ── Footer — label/value rows always at SERIAL_Y+54/+72 (reproduces the
    // original, unbanded y326/y344 exactly, since SERIAL_Y is 272 when
    // there's no band); any extra row(s) below step down from there. ──
    ...(hasTopUps ? [
      // History strip: original bagging + running total, then the last few
      // additions, then the target line if one's set — mirrors the browser
      // label's .history block.
      `A20,${SERIAL_Y + 54},0,1,1,1,N,"BAGGED ${clean(dateFormatted)}${bag.originalWeightKg != null ? ` ${bag.originalWeightKg}KG` : ''}${lotValue !== 'N/A' ? ` ${clean(lotValue)}` : ''}"`,
      `A560,${SERIAL_Y + 50},0,3,1,1,R,"NOW ${clean(weightValue)}"`,
      `A20,${SERIAL_Y + 74},0,1,1,1,N,"${clean(bag.topUps!.slice(-3).map(t => `+${t.kg} ${new Date(t.at).toLocaleDateString('en-ZA', { day: '2-digit', month: '2-digit' })}`).join('   '))}"`,
      ...(hasTarget ? [`A20,${SERIAL_Y + 96},0,2,1,1,N,"TARGET ${bag.targetWeightKg}KG - ${targetLine}"`] : []),
    ] : hasTarget ? [
      // Pre-print (target set, nothing added yet): plain 3-cell footer with
      // Current/Target in place of the usual single Weight cell, plus a
      // "still needed" line — mirrors the browser label's target-only case.
      `A20,${SERIAL_Y + 54},0,1,1,1,N,"LOT/BATCH"`,
      `A20,${SERIAL_Y + 72},0,3,1,1,N,"${clean(lotValue)}"`,
      `A290,${SERIAL_Y + 54},0,1,1,1,N,"CURRENT"`,
      `A290,${SERIAL_Y + 72},0,3,1,1,N,"${clean(weightValue)}"`,
      `A560,${SERIAL_Y + 54},0,1,1,1,N,"TARGET"`,
      `A560,${SERIAL_Y + 72},0,3,1,1,N,"${bag.targetWeightKg}KG"`,
      `A20,${SERIAL_Y + 96},0,2,1,1,N,"STILL NEEDED - ${targetLine}"`,
    ] : [
      // ── Plain footer (no rule — matches the browser preview), unchanged
      // from before the top-up feature. ──
      `A20,${SERIAL_Y + 54},0,1,1,1,N,"LOT/BATCH"`,
      `A20,${SERIAL_Y + 72},0,3,1,1,N,"${clean(lotValue)}"`,
      `A290,${SERIAL_Y + 54},0,1,1,1,N,"WEIGHT"`,
      `A290,${SERIAL_Y + 72},0,3,1,1,N,"${clean(weightValue)}"`,
      `A560,${SERIAL_Y + 54},0,1,1,1,N,"DATE"`,
      `A560,${SERIAL_Y + 72},0,3,1,1,N,"${clean(dateFormatted)}"`,
    ]),

    'P1',                // print 1 copy
  ]

  // Lead CRLF flushes any partial command left in the printer buffer.
  return '\r\n' + lines.join('\r\n') + '\r\n'
}
