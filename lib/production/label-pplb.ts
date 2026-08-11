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
 *   LO x,y,length,thickness           black line
 *   X x1,y1,thickness,x2,y2           box outline
 *   P<copies>                 print
 *
 * Geometry: 203dpi = 8 dots/mm. Label 100mm × 50mm = 800 × 400 dots.
 * Origin is top-left. Commands terminated with CRLF.
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

  // Minimalist layout — only the fields an operator actually needs at a glance:
  // product/section, type+grade, barcode+serial, lot/weight/date. No QC status
  // (not known at bagging time) and no brand footer — the extra whitespace at
  // the bottom is intentional, not empty space to fill.
  const lines: string[] = [
    'N',                 // clear buffer
    'q800',              // width 100mm
    'Q400,24',           // length 50mm, gap 3mm
    'D8',                // darkness
    'S4',                // speed

    // Header: product name (font 4) + section (font 2)
    `A20,16,0,4,1,1,N,"${productName}"`,
    `A20,56,0,2,1,1,N,"${sectionName}"`,

    // Type (CON/ORG/RA CON/RA ORG) and Grade (letter + word) in a single
    // bordered box, top-right.
    'X560,8,2,795,88',
    `A568,11,0,1,1,1,N,"TYPE"`,
    `A568,25,0,3,1,1,N,"${clean(bag.variant)}"`,
    `A568,50,0,1,1,1,N,"GRADE"`,
    `A568,64,0,2,1,1,N,"${clean(bag.grade)} ${clean(gradeShort)}"`,

    // Barcode — Code 128, height 90 dots, narrow bar 2 dots (HRI off; serial printed below)
    `B20,92,0,1,2,2,90,N,"${serial}"`,

    // Serial text (font 3)
    `A20,190,0,3,1,1,N,"${serial}"`,

    // Separator line
    'LO20,228,760,2',

    // Footer — 3 columns: label (font 1) over value (font 2)
    `A20,240,0,1,1,1,N,"LOT/BATCH"`,
    `A20,258,0,2,1,1,N,"${clean(lotValue)}"`,
    `A280,240,0,1,1,1,N,"WEIGHT"`,
    `A280,258,0,2,1,1,N,"${clean(weightValue)}"`,
    `A540,240,0,1,1,1,N,"DATE"`,
    `A540,258,0,2,1,1,N,"${clean(dateFormatted)}"`,

    'P1',                // print 1 copy
  ]

  // Lead CRLF flushes any partial command left in the printer buffer.
  return '\r\n' + lines.join('\r\n') + '\r\n'
}
