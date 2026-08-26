import type { OutputBag } from './live-types'

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

  const dateFormatted = new Date(bag.created_at).toLocaleDateString('en-ZA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  const lotValue    = bag.lot_number || 'N/A'
  const weightValue = `${bag.weight_kg} kg`
  const productName = clean(bag.product_type).slice(0, 26)
  const sectionName = clean(bag.section_name).slice(0, 30)
  const serial      = clean(bag.serial_number)

  // Half-bag Top-up distinctive treatment — mirrors buildLabelHtml's
  // approved black-band + history-strip design (lib/production/
  // label-print.ts). Like the rest of this file, exact dot placement has
  // not been confirmed against a physical print — no printer reachable in
  // this environment.
  const hasTopUps = !!bag.topUps?.length
  const hasTarget = bag.targetWeightKg != null
  const remainingToTarget = hasTarget ? Math.max(0, (bag.targetWeightKg as number) - bag.weight_kg) : 0
  const targetReached = hasTarget && remainingToTarget <= 0
  const targetLine = targetReached ? 'REACHED' : `NEED +${remainingToTarget.toFixed(0)}KG`
  const todayFormatted = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: '2-digit' })
  const showBand = hasTopUps || hasTarget
  const addsLine = hasTopUps
    ? clean(bag.topUps!.slice(-3).map(t => `+${t.kg} ${new Date(t.at).toLocaleDateString('en-ZA', { day: '2-digit', month: '2-digit' })}`).join('   '))
    : ''

  // Everything below the header derives from barcodeY/barcodeH so the
  // unbanded case reproduces the original fixed y-positions (92/190/228/
  // 240/260/300) exactly, and the banded case just starts later.
  const barcodeY    = showBand ? 140 : 92
  const barcodeH    = showBand ? 70 : 90
  const serialY     = barcodeY + barcodeH + 8
  const separatorY  = serialY + 38
  const footerLabelY = separatorY + 12
  const footerValueY = separatorY + 32

  return [
    '^XA',
    '^CI28',              // UTF-8
    '^PW800',             // print width 100mm
    '^LL400',             // label length 50mm
    '^LH0,0',             // label home top-left

    // Header: product name + section
    `^FO20,16^A0N,34,34^FD${productName}^FS`,
    `^FO20,58^A0N,20,20^FD${sectionName}^FS`,

    // Type (CON/ORG/RA CON/RA ORG) and Grade (A/B/C + word) — two clearly
    // captioned rows, not one cramped unlabelled badge. Grade shows the
    // LETTER as well as the word (previously dropped) since that's what a
    // floor operator sorts pallets by at a glance. Values use the existing
    // short codes (bag.variant/bag.grade) rather than long descriptive
    // names — comfortably fits this box width; a full name like "RA
    // Conventional" would not. Exact dot positions are conservative but not
    // yet confirmed against a physical print (no printer has been tested
    // end-to-end — see the print-system health page).
    '^FO560,8^GB235,80,2^FS',
    `^FO568,11^A0N,12,12^FDTYPE^FS`,
    `^FO568,25^A0N,22,22^FD${clean(bag.variant)}^FS`,
    `^FO568,50^A0N,12,12^FDGRADE^FS`,
    `^FO568,64^A0N,17,17^FD${clean(bag.grade)} ${clean(gradeShort)}^FS`,

    // ── Half-bag Top-up band: filled black box, reversed (^FR) white text —
    // pushes the barcode down and shortens it to make room. ──
    ...(showBand ? [
      '^FO16,96^GB768,32,32^FS',
      `^FO28,104^FR^A0N,20,20^FD${hasTopUps ? 'TOPPED UP' : 'TARGET SET'}^FS`,
      `^FO560,106^FR^A0N,16,16^FD${hasTopUps ? `REPRINTED ${todayFormatted}` : todayFormatted}^FS`,
    ] : []),

    // Barcode — Code 128, no ZPL-drawn text (serial printed below)
    `^FO20,${barcodeY}^BY2^BCN,${barcodeH},N,N,N^FD${serial}^FS`,

    // Serial text
    `^FO20,${serialY}^A0N,30,30^FD${serial}^FS`,

    // Separator line
    `^FO20,${separatorY}^GB760,0,2^FS`,

    ...(hasTopUps ? [
      // History strip replaces the 4-column footer entirely — original
      // bagging + running total, the last few additions, then the target
      // line if one's set — mirrors the browser label's .history block.
      `^FO20,${footerLabelY}^A0N,14,14^FDBAGGED ${clean(dateFormatted)}${bag.originalWeightKg != null ? ` ${bag.originalWeightKg}KG` : ''}${lotValue !== 'N/A' ? ` ${clean(lotValue)}` : ''}^FS`,
      `^FO560,${footerLabelY - 2}^A0N,20,20^FDNOW ${clean(weightValue)}^FS`,
      `^FO20,${footerLabelY + 24}^A0N,14,14^FD${addsLine}^FS`,
      ...(hasTarget ? [`^FO20,${footerLabelY + 46}^A0N,18,18^FDTARGET ${bag.targetWeightKg}KG - ${targetLine}^FS`] : []),
      `^FO20,${footerLabelY + (hasTarget ? 68 : 46)}^A0N,16,16^FDCNTP  BLACKHEATH  BHW^FS`,
    ] : hasTarget ? [
      // Pre-print (target set, nothing added yet): the usual 4-column
      // footer with WEIGHT relabelled CURRENT, plus a "still needed" row.
      `^FO20,${footerLabelY}^A0N,16,16^FDLOT/BATCH^FS`,
      `^FO20,${footerValueY}^A0N,22,22^FD${clean(lotValue)}^FS`,
      `^FO220,${footerLabelY}^A0N,16,16^FDCURRENT^FS`,
      `^FO220,${footerValueY}^A0N,22,22^FD${clean(weightValue)}^FS`,
      `^FO400,${footerLabelY}^A0N,16,16^FDDATE^FS`,
      `^FO400,${footerValueY}^A0N,22,22^FD${clean(dateFormatted)}^FS`,
      `^FO580,${footerLabelY}^A0N,16,16^FDTARGET^FS`,
      `^FO580,${footerValueY}^A0N,22,22^FD${bag.targetWeightKg}KG^FS`,
      `^FO20,${footerValueY + 26}^A0N,18,18^FDSTILL NEEDED - ${targetLine}^FS`,
      `^FO20,${footerValueY + 48}^A0N,16,16^FDCNTP  BLACKHEATH  BHW^FS`,
    ] : [
      // Footer — 4 columns: label over value — unchanged from before the
      // top-up feature.
      `^FO20,${footerLabelY}^A0N,16,16^FDLOT/BATCH^FS`,
      `^FO20,${footerValueY}^A0N,22,22^FD${clean(lotValue)}^FS`,
      `^FO220,${footerLabelY}^A0N,16,16^FDWEIGHT^FS`,
      `^FO220,${footerValueY}^A0N,22,22^FD${clean(weightValue)}^FS`,
      `^FO400,${footerLabelY}^A0N,16,16^FDDATE^FS`,
      `^FO400,${footerValueY}^A0N,22,22^FD${clean(dateFormatted)}^FS`,
      `^FO580,${footerLabelY}^A0N,16,16^FDQC STATUS^FS`,
      `^FO580,${footerValueY}^A0N,22,22^FDPending^FS`,
      `^FO20,${footerValueY + 40}^A0N,16,16^FDCNTP  BLACKHEATH  BHW^FS`,
    ]),

    '^PQ1',               // print quantity 1
    '^XZ',
  ].join('\n') + '\n'
}
