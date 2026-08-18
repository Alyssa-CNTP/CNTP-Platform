import type { QcLabelData } from './qc-label-print'

// Sieving Final QC bag label, direct to the lab's Intermec PD printer (ZSim —
// Zebra ZPL emulation), bypassing the browser entirely. The browser print path
// (qc-label-print.ts) turned out to be unworkable on this printer: the print
// dialog's Portrait/Landscape control can't change the page's physical feed
// direction, so the label always came out rotated and clipped regardless of
// what was chosen there. Sending raw ZPL over the network sidesteps that class
// of problem — there is no page box or browser print dialog involved, the
// printer places dots exactly where told, in the label's native feed
// orientation.
//
// Geometry: 203dpi = 8 dots/mm. Label 100mm × 50mm = 800 × 400 dots, matching
// lib/production/label-zpl.ts (same printer family assumption, same dpi).
//
// If the first physical print still comes out upside down, ^POI right after
// ^XA below is the correct one-line ZPL fix — it flips the whole label 180°
// (top/bottom and left/right together), unlike rotating individual fields,
// which would need every box/line coordinate below recomputed to match or the
// layout misaligns. If it instead comes out turned a quarter turn, that is
// the label stock loaded rotated relative to the print head, not something
// ZPL controls — reload the roll turned 90°, or check the Intermec's own
// front-panel "print direction"/media-orientation setting (separate from the
// ZPL emulation it's running).
const FLIP_180 = false

const W = 800  // 100mm
const H = 400  // 50mm

// Full Acumatica variant word → short code — same mapping as the browser
// label and the production bag tag, so the badge reads consistently
// everywhere this variant shows up.
const VARIANT_SHORT: Record<string, string> = {
  'Conventional':    'CON',
  'Organic':         'ORG',
  'RA-Conventional': 'RA CON',
  'RA-Organic':      'RA ORG',
  'FT-Conventional': 'FT CON',
  'FT-Organic':      'FT ORG',
}

// ZPL field data can't contain ^ ~ \ (command delimiters) or newlines.
function clean(s: unknown, max = 40): string {
  const t = String(s ?? '').replace(/[\^~\\]/g, ' ').replace(/[\r\n]/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '.' : t
}

type Justify = 'L' | 'C' | 'R'

// A bounded single-line text field. ^FB (Field Block) is what makes this safe
// against long values: unlike the browser build's CSS, ZPL does not wrap or
// ellipsize text that doesn't fit a box on its own — it just draws past the
// edge, onto whatever's next to it or off the label. ^FB<width>,1 caps it to
// one line inside `width` dots and drops whatever doesn't fit, rather than
// spilling it. `reverse` prints white-on-black, for the badge and warning
// band, which are filled boxes.
function textField(x: number, y: number, width: number, fontH: number, fontW: number, justify: Justify, text: string, reverse = false): string {
  if (!text) return ''
  return `^FO${x},${y}^FB${width},1,0,${justify},0${reverse ? '^FR' : ''}^A0N,${fontH},${fontW}^FD${text}^FS`
}

/**
 * Sieving Final QC bag label — Zebra ZPL II, for the lab's networked Intermec
 * (running in ZSim / Zebra emulation mode).
 */
export function buildQcLabelZpl(d: QcLabelData): string {
  const serial     = clean(d.serialNumber, 30).toUpperCase()
  const isFineLeaf = d.product === 'Fine Leaf'
  const outOfSpec  = !!d.bag?.inprocess_out_of_spec
  const failed     = String(d.passStatus || '').toLowerCase() === 'fail'
  const variant    = d.variant ? (VARIANT_SHORT[d.variant] ?? d.variant) : ''
  const badgeText  = clean([d.grade, variant].filter(Boolean).join(' - '), 30).toUpperCase()

  const dateFormatted = d.date
    ? new Date(d.date + 'T00:00:00').toLocaleDateString('en-ZA', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '-'

  const metrics: Array<[string, unknown]> = [
    ['BULK DENSITY', d.bulkDensity],
    ['LEAF SHADE',   d.leafShade],
    ['PA LEVEL',     d.paLevel],
    ['RESIDUE',      d.residue],
  ]

  const warnText = outOfSpec
    ? 'IN-PROCESS SIEVE OUT OF SPEC - REVIEW BEFORE RELEASE'
    : (failed ? 'FINAL QC FAILED - DO NOT RELEASE' : '')

  // Badge box, top-right — sized to the header text's own width so both
  // header and badge can claim the space between them without a fixed split.
  const badgeW = 264, badgeX0 = W - badgeW - 20, badgeY0 = 10, badgeH = 44
  const headerW = badgeX0 - 20 - 10

  // "QC-LABEL" shares the product name's row and font size, right-justified
  // against the same edge the badge lines up with. Carved out of headerW so
  // the two ^FB fields never overlap — the product name's own field shrinks
  // to what's left, same as elsewhere in this file, rather than the two
  // sharing one width and risking one drawing over the other for a long name.
  const qcTagW  = 200
  const productW = headerW - qcTagW - 10

  // Barcode geometry, computed once and reused both to draw the barcode
  // itself and to size the Lot/Batch and Date fields that sit in its side
  // margins — Code128 subset B's width is exact for a given character
  // count, unlike a text glyph's, so this can be sized precisely rather than
  // guessed.
  const barcodeW  = (serial.length + 2) * 11 * 2.2
  const barcodeX0 = Math.max(40, Math.round((W - barcodeW) / 2))
  const barcodeX1 = Math.round(barcodeX0 + barcodeW)
  const MIN_SIDE_W = 60
  const sideW = Math.round(barcodeX0 - 20 - 10)

  // Vertical layout, laid out bottom-up from the footer so nothing can ever
  // overlap — ZPL doesn't auto-flow the way the browser build's flexbox does,
  // so each block's extent has to be derived from its neighbours' rather than
  // asserted as fixed numbers that happen to agree today. An earlier version
  // hardcoded the grid's bottom edge and the warning band's position
  // independently; with the warning band present they both landed on top of
  // the footer. GAP is the minimum clearance kept between every pair of
  // blocks below.
  const GAP = 6, WARN_H = 34
  const footerTop = H - 52
  const gridX0 = 20, gridX1 = W - 20, gridY0 = 194
  const gridY1   = warnText ? footerTop - GAP - WARN_H - GAP : footerTop - GAP
  const warnY0   = gridY1 + GAP
  const gridMidX = Math.round((gridX0 + gridX1) / 2)
  const gridMidY = Math.round((gridY0 + gridY1) / 2)
  const cellW = gridMidX - gridX0
  const cellH = gridMidY - gridY0

  // Label + value only now (no third "unit" line) — centred within cellH
  // (which still varies, 74 dots with no warning band vs 54 with one) rather
  // than anchored to the top, so leftover room splits evenly above and below
  // instead of landing as a single gap underneath, which is what a fixed
  // top-anchor was doing to PA Level/Residue once they had one line less to
  // fill than Bulk Density/Leaf Shade's old unit line gave them.
  const CELL_CONTENT_H = 14 + 3 + 28   // label + gap + value, verified against both cellH values above
  function metricCell(i: number, label: string, value: unknown): string {
    const cx0 = i % 2 === 0 ? gridX0 : gridMidX
    const cy0 = i < 2 ? gridY0 : gridMidY
    const topPad = Math.max(4, Math.round((cellH - CELL_CONTENT_H) / 2))
    const labelY = cy0 + topPad
    const valueY = labelY + 14 + 3
    return [
      textField(cx0 + 10, labelY, cellW - 20, 14, 14, 'C', clean(label, 16)),
      textField(cx0 + 10, valueY, cellW - 20, 28, 25, 'C', clean(value, 9) || '-'),
    ].filter(Boolean).join('\n')
  }

  const lines: string[] = [
    '^XA',
    ...(FLIP_180 ? ['^POI'] : []),
    '^CI28',              // UTF-8
    `^PW${W}`,
    `^LL${H}`,
    '^LH0,0',

    // Fine Leaf double border — same treatment as the browser label and the
    // production bag tag, since paper colour no longer carries the distinction.
    ...(isFineLeaf ? [`^FO4,4^GB${W - 8},${H - 8},3^FS`, `^FO12,12^GB${W - 24},${H - 24},2^FS`] : []),

    // Header: product + "QC-LABEL" left, "FINAL QC · <name>" below, grade/variant badge right
    textField(20, 14, productW, 32, 32, 'L', clean(d.product, 22).toUpperCase()),
    textField(20 + productW + 10, 14, qcTagW, 32, 32, 'R', 'QC-LABEL'),
    textField(20, 52, headerW, 18, 18, 'L', clean(`FINAL QC${d.qcName ? ' - ' + clean(d.qcName, 22) : ''}`, 40)),
    ...(badgeText ? [
      `^FO${badgeX0},${badgeY0}^GB${badgeW},${badgeH},${badgeH}^FS`,
      textField(badgeX0 + 8, badgeY0 + 14, badgeW - 16, 20, 20, 'C', badgeText, true),
    ] : []),

    // Barcode + human-readable serial, centred. Code128 subset B width is
    // exact for a given length (unlike text glyph widths, which ^FB above
    // exists precisely because they aren't), so it's centred by computing it
    // rather than needing ^FB.
    ...(serial ? [
      `^FO${barcodeX0},92^BY2^BCN,64,N,N,N^FD${serial}^FS`,
      textField(20, 166, W - 40, 22, 22, 'C', serial),
    ] : []),

    // Lot/Batch and Date, in the margins left and right of the barcode —
    // moved here from a bottom footer row (kept blank below, see gridY1/
    // footerTop) so both read at a glance next to the serial they belong to.
    // Skipped below MIN_SIDE_W: a long enough serial leaves no usable margin,
    // and a squeezed-in field there is worse than the blank margin it'd cost.
    ...(sideW >= MIN_SIDE_W ? [
      textField(20, 96, sideW, 12, 12, 'L', 'LOT/BATCH'),
      textField(20, 112, sideW, 20, 18, 'L', clean(d.lotNumber, 16).toUpperCase() || '-'),
      textField(barcodeX1 + 10, 96, sideW, 12, 12, 'R', 'DATE'),
      textField(barcodeX1 + 10, 112, sideW, 20, 18, 'R', dateFormatted),
    ] : []),

    // Metrics grid — outer box + crossing lines
    `^FO${gridX0},${gridY0}^GB${gridX1 - gridX0},${gridY1 - gridY0},3^FS`,
    `^FO${gridMidX},${gridY0}^GB0,${gridY1 - gridY0},2^FS`,
    `^FO${gridX0},${gridMidY}^GB${gridX1 - gridX0},0,2^FS`,
    ...metrics.map((m, i) => metricCell(i, m[0], m[1])),

    // Warning band — filled black bar, reversed white bold text
    ...(warnText ? [
      `^FO20,${warnY0}^GB${W - 40},${WARN_H},${WARN_H}^FS`,
      textField(30, warnY0 + 8, W - 60, 18, 18, 'C', clean(warnText, 60), true),
    ] : []),

    // Bottom strip below the grid/warning band is intentionally left blank —
    // it used to hold a Lot/Product/Date footer; Lot and Date moved up beside
    // the barcode above, and Product was dropped as a duplicate of the
    // product name already in the header.

    '^PQ1',
    '^XZ',
  ]

  return lines.filter(Boolean).join('\n') + '\n'
}
