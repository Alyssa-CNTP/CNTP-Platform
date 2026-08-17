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

  const metrics: Array<[string, unknown, string]> = [
    ['BULK DENSITY', d.bulkDensity, 'cc/100g'],
    ['LEAF SHADE',   d.leafShade,   '1-11'],
    ['PA LEVEL',     d.paLevel,     ''],
    ['RESIDUE',      d.residue,     ''],
  ]

  const warnText = outOfSpec
    ? 'IN-PROCESS SIEVE OUT OF SPEC - REVIEW BEFORE RELEASE'
    : (failed ? 'FINAL QC FAILED - DO NOT RELEASE' : '')

  // Badge box, top-right — sized to the header text's own width so both
  // header and badge can claim the space between them without a fixed split.
  const badgeW = 264, badgeX0 = W - badgeW - 20, badgeY0 = 10, badgeH = 44
  const headerW = badgeX0 - 20 - 10

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

  // Two size presets, each verified by hand against its own cellH (74 dots
  // with no warning band, 54 with one — see the comment above): label, then
  // value, then — only when there's room — the unit, each stacked with GAP/2
  // clearance and never exceeding cellH.
  function metricCell(i: number, label: string, value: unknown, unit: string): string {
    const cx0 = i % 2 === 0 ? gridX0 : gridMidX
    const cy0 = i < 2 ? gridY0 : gridMidY
    const showUnit = !!unit && cellH >= 70
    const labelY = cy0 + 4
    const valueY = labelY + 14 + 3
    const valueH = showUnit ? 34 : 28
    const unitY  = valueY + valueH + 3
    return [
      textField(cx0 + 10, labelY, cellW - 20, 14, 14, 'C', clean(label, 16)),
      textField(cx0 + 10, valueY, cellW - 20, valueH, Math.round(valueH * 0.9), 'C', clean(value, 9) || '-'),
      showUnit ? textField(cx0 + 10, unitY, cellW - 20, 12, 12, 'C', unit) : '',
    ].filter(Boolean).join('\n')
  }

  // Footer thirds — Lot/Batch, Product, Date.
  const footY0 = footerTop + GAP, footY1 = footY0 + 20, footColW = Math.floor(W / 3) - 30

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

    // Header: product + "FINAL QC · <name>" left, grade/variant badge right
    textField(20, 14, headerW, 32, 32, 'L', clean(d.product, 22).toUpperCase()),
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
      `^FO${Math.max(40, Math.round((W - (serial.length + 2) * 11 * 2.2) / 2))},92^BY2^BCN,64,N,N,N^FD${serial}^FS`,
      textField(20, 166, W - 40, 22, 22, 'C', serial),
    ] : []),

    // Metrics grid — outer box + crossing lines
    `^FO${gridX0},${gridY0}^GB${gridX1 - gridX0},${gridY1 - gridY0},3^FS`,
    `^FO${gridMidX},${gridY0}^GB0,${gridY1 - gridY0},2^FS`,
    `^FO${gridX0},${gridMidY}^GB${gridX1 - gridX0},0,2^FS`,
    ...metrics.map((m, i) => metricCell(i, m[0], m[1], m[2])),

    // Warning band — filled black bar, reversed white bold text
    ...(warnText ? [
      `^FO20,${warnY0}^GB${W - 40},${WARN_H},${WARN_H}^FS`,
      textField(30, warnY0 + 8, W - 60, 18, 18, 'C', clean(warnText, 60), true),
    ] : []),

    // Footer: Lot / Batch · Product · Date
    textField(20, footY0, footColW, 14, 14, 'L', 'LOT/BATCH'),
    textField(20, footY1, footColW, 20, 20, 'L', clean(d.lotNumber, 20).toUpperCase() || '-'),
    textField(Math.round(W / 2) - 80, footY0, footColW, 14, 14, 'L', 'PRODUCT'),
    textField(Math.round(W / 2) - 80, footY1, footColW, 20, 20, 'L', clean(d.product, 22).toUpperCase()),
    textField(W - 200, footY0, 180, 14, 14, 'L', 'DATE'),
    textField(W - 200, footY1, 180, 20, 20, 'L', dateFormatted),

    '^PQ1',
    '^XZ',
  ]

  return lines.filter(Boolean).join('\n') + '\n'
}
