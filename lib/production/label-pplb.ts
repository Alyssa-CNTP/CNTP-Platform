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

// Estimated Code 128 (Set B) symbol width in dots, so the barcode can be
// centered regardless of serial length/format. Modules: START(11) + one 11-module
// symbol per data char + CHECK(11) + STOP(13).
function code128WidthDots(data: string, narrowDots: number): number {
  const modules = 11 * (data.length + 2) + 13
  return modules * narrowDots
}

/**
 * Argox CP-2140EX label in PPLB (EPL2-compatible) command language.
 *
 * PPLB command set (Eltron/EPL2 style):
 *   N                         clear image buffer
 *   q<dots>                   label width
 *   Q<dots>,<gap>             label length, gap between labels
 *   D<0-15>                   print density/darkness
 *   S<speed>                  print speed
 *   A x,y,rot,font,hm,vm,rev,"data"   text
 *   B x,y,rot,type,nw,wd,h,HRI,"data" barcode ("1" = Code 128)
 *   LO x,y,width,height               filled black box (used as a line when height is small)
 *   X x1,y1,thickness,x2,y2           box outline
 *   P<copies>                 print
 *
 * Geometry: 203dpi = 8 dots/mm. Label is landscape, 100mm × 50mm = 800 × 400 dots.
 * Barcode is horizontally centered with generous quiet zone (spec: ≥5–10mm each
 * side) and sized to 25–35mm of vertical height, per the printed-tag spec. Origin
 * is top-left. Commands terminated with CRLF.
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

  const CANVAS_WIDTH = 800   // 100mm
  const NARROW       = 2     // dots per module

  // Centre the barcode horizontally; clamp so it never eats into the minimum
  // 5mm (40 dot) quiet zone even for an unusually long serial.
  const barcodeWidth = code128WidthDots(serial, NARROW)
  const minMargin     = 40
  const barcodeX = Math.max(minMargin, Math.round((CANVAS_WIDTH - barcodeWidth) / 2))

  // Minimalist layout — only the fields an operator actually needs at a glance:
  // product/section, type+grade, barcode+serial, lot/weight/date.
  const lines: string[] = [
    'N',                 // clear buffer
    'q800',              // width 100mm
    'Q400,24',           // length 50mm, gap 3mm
    'D8',                // darkness
    'S4',                // speed

    // Header: product name (font 3) + section (font 1)
    `A20,8,0,3,1,1,N,"${productName}"`,
    `A20,44,0,1,1,1,N,"${sectionName}"`,

    // Type + Grade — bordered box, top-right.
    'X560,4,2,780,84',
    `A568,8,0,1,1,1,N,"TYPE"`,
    `A568,22,0,2,1,1,N,"${clean(bag.variant)}"`,
    `A568,46,0,1,1,1,N,"GRADE"`,
    `A568,60,0,2,1,1,N,"${clean(bag.grade)} ${clean(gradeShort)}"`,

    // Barcode — Code 128, centred, ~27.5mm tall (220 dots, within the 25–35mm
    // spec), narrow bar 2 dots, HRI off (serial printed separately below).
    `B${barcodeX},92,0,1,${NARROW},${NARROW},220,N,"${serial}"`,

    // Serial text (font 3), aligned under the barcode's left edge
    `A${barcodeX},320,0,3,1,1,N,"${serial}"`,

    // Separator line
    'LO20,344,760,2',

    // Footer — 3 columns: label (font 1) over value (font 2)
    `A20,356,0,1,1,1,N,"LOT/BATCH"`,
    `A20,372,0,2,1,1,N,"${clean(lotValue)}"`,
    `A290,356,0,1,1,1,N,"WEIGHT"`,
    `A290,372,0,2,1,1,N,"${clean(weightValue)}"`,
    `A560,356,0,1,1,1,N,"DATE"`,
    `A560,372,0,2,1,1,N,"${clean(dateFormatted)}"`,

    'P1',                // print 1 copy
  ]

  // Lead CRLF flushes any partial command left in the printer buffer.
  return '\r\n' + lines.join('\r\n') + '\r\n'
}
