// THERMAL PRINTER UPGRADE PATH
// When a Zebra/Brother/Dymo thermal printer is connected:
// 1. Replace window.open/print with ZPL commands sent to http://localhost:9100 (Zebra)
// 2. ZPL template stored in lib/production/label-zpl.ts
// 3. Module width changes: moduleWidth: 0.3 (Zebra 203dpi) or 0.5 (300dpi)
// Current: browser print to regular printer (100mm × 75mm page size)

import type { OutputBag } from './live-types'
import { VARIANT_LABELS, GRADE_LABELS } from './live-types'
import { encodeCode128 } from '@/lib/production/code128'

// Type = the organic/RA classification (RA CON / CON / ORG / RA ORG).
// Grade = the export/domestic classification (Export A / Export Blend B / Domestic C).
// These are the two things an operator must read at a glance, so they get their
// own clearly-labelled fields — not one cramped badge.
const GRADE_FULL: Record<string, string> = {
  'A': 'Export',
  'B': 'Export Blend',
  'C': 'Domestic / Local',
}

function buildLabelHtml(bag: OutputBag): string {
  const typeLabel  = VARIANT_LABELS[bag.variant] ?? bag.variant
  const gradeName  = GRADE_FULL[bag.grade] ?? GRADE_LABELS[bag.grade] ?? bag.grade

  const dateFormatted = new Date(bag.created_at).toLocaleDateString('en-ZA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  // The barcode encodes ONLY the serial — every other field lives in
  // production.bag_tags keyed by that serial, so a data change never invalidates
  // a printed label.
  const barcodeSvg = encodeCode128(bag.serial_number, { height: 20, moduleWidth: 1.9 })

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Bag Label — ${bag.serial_number}</title>
<style>
  @page { size: 100mm 75mm; margin: 0; }
  @media print {
    html, body { margin: 0; padding: 0; width: 100mm; height: 75mm; }
    .no-print { display: none !important; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    width: 100mm; min-height: 75mm;
    padding: 3.5mm 4.5mm;
    display: flex; flex-direction: column;
    background: #fff; color: #000;
  }
  /* Header: product + section */
  .head { border-bottom: 0.4mm solid #000; padding-bottom: 1.8mm; margin-bottom: 2mm; }
  .product-name { font-size: 13pt; font-weight: 800; line-height: 1.05; }
  .section-name { font-size: 6.5pt; color: #555; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 0.8mm; }
  /* Type + Grade — the two classifications, side by side, each labelled */
  .class-row { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm; margin-bottom: 2mm; }
  .class-cell { border: 0.3mm solid #000; border-radius: 1.5mm; padding: 1.3mm 2.2mm; }
  .class-label { font-size: 5.5pt; text-transform: uppercase; letter-spacing: 0.1em; color: #666; font-weight: 700; }
  .class-value { font-size: 9pt; font-weight: 800; line-height: 1.1; margin-top: 0.5mm; }
  .class-value small { font-size: 6.5pt; font-weight: 700; color: #444; }
  /* Barcode */
  .barcode-area {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 1.5mm 0;
  }
  .barcode-area svg { display: block; max-width: 100%; }
  .serial {
    font-family: 'Courier New', monospace;
    font-size: 11pt; font-weight: 700;
    letter-spacing: 0.14em; margin-top: 1.2mm;
  }
  /* Footer facts */
  .footer-row {
    display: grid; grid-template-columns: 1.3fr 1fr 1fr;
    gap: 2mm; border-top: 0.3mm solid #ccc; padding-top: 1.8mm; margin-top: 1mm;
  }
  .footer-cell { display: flex; flex-direction: column; }
  .footer-label { font-size: 5.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #999; margin-bottom: 0.6mm; }
  .footer-value { font-size: 8.5pt; font-weight: 700; word-break: break-all; }
  .footer-brand { text-align: center; font-size: 5.5pt; color: #bbb; margin-top: 1.3mm; letter-spacing: 0.1em; }
  .print-btn {
    position: fixed; bottom: 12px; right: 12px;
    background: #1A3A0E; color: #fff; border: none; border-radius: 10px;
    padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer; z-index: 99;
  }
</style>
</head>
<body>
  <div class="head">
    <div class="product-name">${bag.product_type}</div>
    <div class="section-name">${bag.section_name}</div>
  </div>

  <div class="class-row">
    <div class="class-cell">
      <div class="class-label">Type</div>
      <div class="class-value">${typeLabel} <small>(${bag.variant})</small></div>
    </div>
    <div class="class-cell">
      <div class="class-label">Grade</div>
      <div class="class-value">${gradeName} <small>(${bag.grade})</small></div>
    </div>
  </div>

  <div class="barcode-area">
    ${barcodeSvg}
    <div class="serial">${bag.serial_number}</div>
  </div>

  <div class="footer-row">
    <div class="footer-cell">
      <div class="footer-label">Lot / Batch</div>
      <div class="footer-value">${bag.lot_number || '—'}</div>
    </div>
    <div class="footer-cell">
      <div class="footer-label">Weight</div>
      <div class="footer-value">${bag.weight_kg} kg</div>
    </div>
    <div class="footer-cell">
      <div class="footer-label">Date</div>
      <div class="footer-value">${dateFormatted}</div>
    </div>
  </div>

  <div class="footer-brand">CNTP · Blackheath · BHW</div>

  <button class="print-btn no-print" onclick="window.print()">Print Label</button>
</body>
</html>`
}

function openAndPrint(html: string): void {
  const win = window.open('', '_blank', 'width=440,height=360')
  if (!win) { alert('Allow pop-ups to print labels'); return }
  win.document.write(html)
  win.document.close()
  win.focus()
  // Short delay lets the page render before the print dialog opens
  setTimeout(() => win.print(), 600)
}

export function printLabel(bag: OutputBag): void {
  openAndPrint(buildLabelHtml(bag))
}

export function reprintLabel(bag: OutputBag): void {
  openAndPrint(buildLabelHtml(bag))
}
