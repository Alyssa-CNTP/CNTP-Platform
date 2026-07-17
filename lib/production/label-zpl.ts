import type { OutputBag } from './live-types'
import { VARIANT_LABELS } from './live-types'

const GRADE_SHORT: Record<string, string> = {
  A: 'Export',
  B: 'Export Blend',
  C: 'Domestic',
}

// Escape characters that are special in ZPL field data (^ ~ \).
function clean(s: string): string {
  return String(s ?? '').replace(/[\^~\\]/g, ' ').replace(/[\r\n]/g, ' ')
}

/**
 * Zebra ZD230 label in ZPL II.
 *
 * Geometry: 203dpi = 8 dots/mm. Label 100mm × 50mm = 800 × 400 dots.
 * Origin (^FO) is top-left. ^A0N,h,w = scalable font, height×width in dots.
 * Barcode ^BC = Code 128 — serial-only encoding, matching the existing
 * Code 128 tags the scan-in flow at other sections already reads.
 */
export function buildLabelZpl(bag: OutputBag): string {
  const gradeShort = GRADE_SHORT[bag.grade] ?? bag.grade
  const variant    = VARIANT_LABELS[bag.variant] ?? bag.variant

  const dateFormatted = new Date(bag.created_at).toLocaleDateString('en-ZA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  const lotValue    = bag.lot_number || 'N/A'
  const weightValue = `${bag.weight_kg} kg`
  const productName = clean(bag.product_type).slice(0, 26)
  const sectionName = clean(bag.section_name).slice(0, 30)
  const serial      = clean(bag.serial_number)

  return [
    '^XA',
    '^CI28',              // UTF-8
    '^PW800',             // print width 100mm
    '^LL400',             // label length 50mm
    '^LH0,0',             // label home top-left

    // Header: product name + section
    `^FO20,16^A0N,34,34^FD${productName}^FS`,
    `^FO20,58^A0N,20,20^FD${sectionName}^FS`,

    // Variant/grade badge — box top-right
    '^FO560,8^GB235,68,2^FS',
    `^FO572,16^A0N,26,26^FD${clean(variant)}^FS`,
    `^FO572,48^A0N,18,18^FD${clean(gradeShort)}^FS`,

    // Barcode — Code 128, height 90 dots, no ZPL-drawn text (serial printed below)
    `^FO20,92^BY2^BCN,90,N,N,N^FD${serial}^FS`,

    // Serial text
    `^FO20,190^A0N,30,30^FD${serial}^FS`,

    // Separator line
    '^FO20,228^GB760,0,2^FS',

    // Footer — 4 columns: label over value
    `^FO20,240^A0N,16,16^FDLOT/BATCH^FS`,
    `^FO20,260^A0N,22,22^FD${clean(lotValue)}^FS`,
    `^FO220,240^A0N,16,16^FDWEIGHT^FS`,
    `^FO220,260^A0N,22,22^FD${clean(weightValue)}^FS`,
    `^FO400,240^A0N,16,16^FDDATE^FS`,
    `^FO400,260^A0N,22,22^FD${clean(dateFormatted)}^FS`,
    `^FO580,240^A0N,16,16^FDQC STATUS^FS`,
    `^FO580,260^A0N,22,22^FDPending^FS`,

    // Brand footer
    `^FO20,300^A0N,16,16^FDCNTP  BLACKHEATH  BHW^FS`,

    '^PQ1',               // print quantity 1
    '^XZ',
  ].join('\n') + '\n'
}
