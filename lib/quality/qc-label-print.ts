// Sieving Final QC bag label — 100mm × 50mm.
//
// Same mechanism as the production sieving tower labels
// (lib/production/label-print.ts): the label is rendered as a standalone
// document in its own window sized to the media, so the browser prints the
// label and nothing else. The Final QC modal used to call window.print() on
// the app page itself, which sent the whole screen — sidebar, table and modal
// backdrop — to the printer at A4.
//
// Content is the QC's own result (the two values it measured plus the release
// checks), not the production bag label, so it has its own layout rather than
// reusing buildLabelHtml.

import { encodeCode128, getCode128Width } from '@/lib/production/code128'

export interface QcLabelData {
  serialNumber?: string
  product?:      string
  lotNumber?:    string
  grade?:        string
  variant?:      string
  date?:         string
  qcName?:       string
  bulkDensity?:  string | number
  leafShade?:    string | number
  paLevel?:      string | number
  residue?:      string | number
  passStatus?:   string
  bag?:          { inprocess_out_of_spec?: boolean } | null
}

const LABEL_W_MM = 100
const LABEL_H_MM = 50

// Sieving's full variant words are too long for the badge — "EXPORT BLEND ·
// FT-CONVENTIONAL" truncates mid-word. Shortened the same way the production
// bag label does it (capture-config.ts VARIANT_OPTIONS short values).
const VARIANT_SHORT: Record<string, string> = {
  'Conventional':    'CON',
  'Organic':         'ORG',
  'RA-Conventional': 'RA CON',
  'RA-Organic':      'RA ORG',
  'FT-Conventional': 'FT CON',
  'FT-Organic':      'FT ORG',
}

// Keep a value from breaking the fixed layout — a long free-text entry in a
// numeric field would otherwise push the grid past the bottom of the label.
function esc(v: unknown, max = 24): string {
  const s = (v === null || v === undefined || v === '') ? '—' : String(v)
  const t = s.length > max ? s.slice(0, max - 1) + '…' : s
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildQcLabelHtml(d: QcLabelData): string {
  const serial     = (d.serialNumber || '').trim()
  const isFineLeaf = d.product === 'Fine Leaf'
  const outOfSpec  = !!d.bag?.inprocess_out_of_spec
  const failed     = String(d.passStatus || '').toLowerCase() === 'fail'
  const variant    = d.variant ? (VARIANT_SHORT[d.variant] ?? d.variant) : ''
  const badge      = [d.grade, variant].filter(Boolean).join(' · ')

  const dateFormatted = d.date
    ? new Date(d.date + 'T00:00:00').toLocaleDateString('en-ZA', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—'

  // Only barcode a serial we actually have — Code 128 of an empty string is a
  // scannable-looking symbol that decodes to nothing.
  const mw = 1.5
  const barcode = serial
    ? encodeCode128(serial, { height: Math.round(getCode128Width(serial, mw) * 0.14), moduleWidth: mw })
    : ''

  const metrics: Array<[string, unknown, string]> = [
    ['Bulk Density', d.bulkDensity, 'cc/100g'],
    ['Leaf Shade',   d.leafShade,   '1–11'],
    ['PA Level',     d.paLevel,     ''],
    ['Residue',      d.residue,     ''],
  ]

  return `<!DOCTYPE html>
<html data-feed="long">
<head>
<meta charset="UTF-8">
<title>Final QC Label — ${esc(serial, 40)}</title>
<!-- Rewritten by setFeed() to match how the printer feeds the label. -->
<style id="page-rule">@page { size: ${LABEL_W_MM}mm ${LABEL_H_MM}mm; margin: 0; }</style>
<style>
  /* The @page rule is rewritten by setFeed() below — the page box has to match
     how the printer actually feeds the label, which the print dialog's
     Portrait/Landscape control cannot do on its own. See setFeed(). */
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { overflow: hidden; background: #fff; color: #000; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; }

  /* Long edge first: the page box is the label as designed. */
  html[data-feed="long"], html[data-feed="long"] body {
    width: ${LABEL_W_MM}mm; height: ${LABEL_H_MM}mm;
  }
  /* Short edge first: the printer images a ${LABEL_H_MM}mm x ${LABEL_W_MM}mm page,
     so the page box is turned and the label rotated a quarter turn onto it.
     Rotating about the top-left corner puts the label off the page to the left,
     hence the translate back across the page width. */
  html[data-feed="short"], html[data-feed="short"] body {
    width: ${LABEL_H_MM}mm; height: ${LABEL_W_MM}mm;
  }
  html[data-feed="short"] .label {
    transform: translateX(${LABEL_H_MM}mm) rotate(90deg);
    transform-origin: top left;
  }

  .label {
    width: ${LABEL_W_MM}mm; height: ${LABEL_H_MM}mm;
    padding: 1.2mm 2.2mm;
    display: flex; flex-direction: column;
    ${isFineLeaf ? 'border: 1.2px solid #000; outline: 1.2px solid #000; outline-offset: -2.2px;' : ''}
  }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 2mm; }
  .product { font-size: 15pt; font-weight: 900; line-height: 1.0; text-transform: uppercase; }
  .qc-tag  { font-size: 6pt; font-weight: 700; letter-spacing: .1em; color: #333; margin-top: .5mm; text-transform: uppercase; }
  .badge {
    background: #000; color: #fff; padding: 1mm 2mm; flex-shrink: 0;
    font-size: 6.5pt; font-weight: 700; white-space: nowrap; text-transform: uppercase;
  }
  .idrow { display: flex; flex-direction: column; align-items: center; margin-top: .8mm; }
  .idrow svg { display: block; height: 6mm; width: auto; max-width: 62mm; }
  .serial { font-family: 'Courier New', monospace; font-size: 8pt; font-weight: 700; letter-spacing: .12em; margin-top: .4mm; }
  .metrics {
    flex: 1; min-height: 0; margin-top: .8mm;
    display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
    border: 1.2px solid #000;
  }
  /* Type sizes are budgeted against the tightest case — warning band present,
     which leaves each row ~9mm. overflow:hidden is the backstop so an
     unexpected value can never spill across the grid lines. */
  .cell {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 0 1mm; min-height: 0; overflow: hidden;
  }
  .cell:nth-child(2), .cell:nth-child(4) { border-left: 1px solid #000; }
  .cell:nth-child(3), .cell:nth-child(4) { border-top: 1px solid #000; }
  .m-label { font-size: 5pt; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #444; line-height: 1.2; }
  .m-value { font-size: 12pt; font-weight: 800; line-height: 1.0; }
  .m-unit  { font-size: 5pt; color: #444; line-height: 1.2; }
  .warn {
    margin-top: .8mm; border: 1.2px solid #000; background: #000; color: #fff;
    font-size: 6pt; font-weight: 800; letter-spacing: .05em; text-align: center;
    padding: .7mm 1mm; text-transform: uppercase;
  }
  .foot {
    display: grid; grid-template-columns: 1fr auto auto; gap: 2mm;
    margin-top: .8mm; align-items: end;
  }
  .f-label { font-size: 5pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #666; }
  .f-value { font-size: 7.5pt; font-weight: 800; line-height: 1.15; text-transform: uppercase; }
  .foot > div:not(:first-child) { text-align: right; }
  /* Screen-only controls, laid out clear of the label so they never sit on top
     of it, and never printed. */
  .bar {
    position: fixed; left: 0; right: 0; bottom: 0;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 8px 10px; background: #f3f4f6; border-top: 1px solid #d1d5db;
    font: 12px -apple-system, 'Helvetica Neue', Arial, sans-serif; z-index: 99;
  }
  .bar button {
    border: 1px solid #d1d5db; border-radius: 7px; background: #fff;
    padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .bar button.primary { background: #166534; border-color: #166534; color: #fff; }
  .bar .hint { color: #4b5563; font-size: 11px; flex-basis: 100%; }
  @media print { .no-print { display: none !important; } }
</style>
</head>
<body>
  <div class="label">
    <div class="head">
      <div>
        <div class="product">${esc(d.product, 22)}</div>
        <div class="qc-tag">Final QC${d.qcName ? ' · ' + esc(d.qcName, 28) : ''}</div>
      </div>
      ${badge ? `<div class="badge">${esc(badge, 26)}</div>` : ''}
    </div>

    <div class="idrow">
      ${barcode}
      <div class="serial">${esc(serial, 30)}</div>
    </div>

    <div class="metrics">
      ${metrics.map(([label, value, unit]) => `
      <div class="cell">
        <div class="m-label">${label}</div>
        <div class="m-value">${esc(value, 9)}</div>
        ${unit ? `<div class="m-unit">${unit}</div>` : ''}
      </div>`).join('')}
    </div>

    ${outOfSpec ? '<div class="warn">⚠ In-process sieve out of spec — review before release</div>' : ''}
    ${failed && !outOfSpec ? '<div class="warn">⚠ Final QC failed — do not release</div>' : ''}

    <div class="foot">
      <div>
        <div class="f-label">Lot / Batch</div>
        <div class="f-value">${esc(d.lotNumber, 20)}</div>
      </div>
      <div>
        <div class="f-label">Date</div>
        <div class="f-value">${dateFormatted}</div>
      </div>
    </div>
  </div>

  <div class="bar no-print">
    <button class="primary" onclick="window.print()">🖨 Print Label</button>
    <button onclick="toggleFeed()">↻ Rotate (feed: <span id="feed-name">long edge</span>)</button>
    <span class="hint">
      If the label prints sideways or cut off, press Rotate and print again — the setting is
      remembered. In the print dialog set Margins to <b>None</b> and Scale to <b>100%</b> (not
      "Fit to page"), and turn Headers and footers off.
    </span>
  </div>

<script>
  // The print dialog's Portrait/Landscape control only rotates the drawing on a
  // page whose size the browser has already fixed — it cannot change the page
  // box. When the printer feeds this label short-edge first, the page box has to
  // become ${LABEL_H_MM}mm x ${LABEL_W_MM}mm and the label be turned a quarter
  // turn onto it, or the label images sideways and clipped. That is what this
  // switches, and it is per-printer, so it is remembered.
  var PAGE = {
    long:  '@page { size: ${LABEL_W_MM}mm ${LABEL_H_MM}mm; margin: 0; }',
    short: '@page { size: ${LABEL_H_MM}mm ${LABEL_W_MM}mm; margin: 0; }'
  }
  function setFeed(mode) {
    if (mode !== 'short') mode = 'long'
    document.getElementById('page-rule').textContent = PAGE[mode]
    document.documentElement.setAttribute('data-feed', mode)
    document.getElementById('feed-name').textContent = mode === 'short' ? 'short edge' : 'long edge'
    try { localStorage.setItem('cntp.qcLabelFeed', mode) } catch (e) { /* private mode */ }
  }
  function toggleFeed() {
    setFeed(document.documentElement.getAttribute('data-feed') === 'short' ? 'long' : 'short')
  }
  var saved = 'long'
  try { saved = localStorage.getItem('cntp.qcLabelFeed') || 'long' } catch (e) { /* private mode */ }
  setFeed(saved)
</script>
</body>
</html>`
}

/**
 * Open the label in its own correctly-sized window and raise the print dialog,
 * so only the 100mm × 50mm label is sent to the printer. The window is left
 * open afterwards so it can be re-printed (or sent to a different printer)
 * without re-saving the QC.
 */
export function printQcLabel(data: QcLabelData): void {
  const win = window.open('', '_blank', 'width=460,height=320')
  if (!win) { alert('Allow pop-ups to print the QC label'); return }
  win.document.write(buildQcLabelHtml(data))
  win.document.close()
  win.focus()
  // Short delay lets the barcode render before the print dialog opens.
  setTimeout(() => win.print(), 600)
}
