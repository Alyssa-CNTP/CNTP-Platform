import type { OutputBag } from './live-types'

const GRADE_SHORT: Record<string, string> = {
  A: 'Export',
  B: 'Export Blend',
  C: 'Domestic',
}

// Escape/strip characters that would break an EPL2 quoted string.
function clean(s: string): string {
  return String(s ?? '').replace(/"/g, "'").replace(/[\r\n]/g, ' ')
}

// ── Geometry ────────────────────────────────────────────────────────────────
// Argox CP-2140EX / CP-2140EX PRO, 203dpi = 8 dots/mm.
// Landscape label 100mm × 50mm = 800 × 400 dots. Origin top-left.
const W = 800
const H = 400

// PPLB bitmap font cell sizes in dots at multiplier 1 — used to centre text.
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
 * Layout — "barcode hero", balanced for a 100 × 50mm landscape label:
 *   product name + section          top-left
 *   TYPE / GRADE box                top-right
 *   Code 128 barcode                centred, ~18.5mm tall (spec: 25-35mm was
 *                                   over half the label height and forced the
 *                                   header/footer against the edges)
 *   serial in human-readable text   centred beneath the barcode
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

  const lotValue    = bag.lot_number || 'N/A'
  const weightValue = `${bag.weight_kg} kg`
  const productName = clean(bag.product_type).slice(0, 26)
  const sectionName = clean(bag.section_name).slice(0, 30)
  const serial      = clean(bag.serial_number)
  const variant     = clean(bag.variant)
  const gradeText   = `${clean(bag.grade)} ${clean(gradeShort)}`.trim()

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
    `Q${H},24`,          // length 50mm, 3mm gap
    'D8',                // darkness
    'S4',                // speed

    // ── Header ──
    `A20,12,0,4,1,1,N,"${productName}"`,
    `A20,42,0,1,1,1,N,"${sectionName}"`,

    // ── Type / grade box, top-right ──
    'X556,6,2,792,78',
    `A566,12,0,1,1,1,N,"TYPE"`,
    `A566,26,0,3,1,1,N,"${variant}"`,
    `A566,48,0,1,1,1,N,"GRADE"`,
    `A566,60,0,2,1,1,N,"${gradeText}"`,

    // ── Barcode, centred (HRI off — serial is printed below in a real font) ──
    `B${barcodeX},${BARCODE_Y},0,1,${NARROW},${NARROW},${BARCODE_H},N,"${serial}"`,

    // ── Serial, centred under the barcode ──
    `A${centreX(serial, 4)},250,0,4,1,1,N,"${serial}"`,

    // ── Footer ──
    `LO20,292,760,2`,
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
