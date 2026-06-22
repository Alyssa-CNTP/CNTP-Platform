// THERMAL PRINTER UPGRADE PATH
// When a Zebra/Brother/Dymo thermal printer is connected:
// 1. Replace window.open/print with ZPL commands sent to http://localhost:9100 (Zebra)
// 2. ZPL template stored in lib/production/label-zpl.ts
// 3. Module width changes: moduleWidth: 0.3 (Zebra 203dpi) or 0.5 (300dpi)
// Current: browser print to regular printer (100mm × 75mm page size)

import type { OutputBag } from './live-types'
import { VARIANT_LABELS, GRADE_LABELS } from './live-types'
import { encodeCode128 } from '@/lib/production/code128'

function buildLabelHtml(bag: OutputBag): string {
  const variantLabel = VARIANT_LABELS[bag.variant] ?? bag.variant
  const gradeLabel   = GRADE_LABELS[bag.grade]    ?? bag.grade

  // Badge: short grade label that reflects exactly what's on the card
  const GRADE_SHORT: Record<string, string> = {
    'A': 'Export',
    'B': 'Export Blend',
    'C': 'Domestic',
  }
  const gradeShort = GRADE_SHORT[bag.grade] ?? bag.grade

  const dateFormatted = new Date(bag.created_at).toLocaleDateString('en-ZA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  const barcodeSvg = encodeCode128(bag.serial_number, { height: 18, moduleWidth: 1.8 })

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
    padding: 4mm 5mm;
    display: flex; flex-direction: column;
    background: #fff; color: #000;
  }
  .top-row {
    display: flex; align-items: flex-start; justify-content: space-between;
    margin-bottom: 2.5mm; gap: 3mm;
  }
  .product-name { font-size: 12pt; font-weight: 800; line-height: 1.1; }
  .section-name { font-size: 7pt; color: #555; font-weight: 400; margin-top: 1mm; }
  .badge {
    background: #000; color: #fff;
    font-size: 7pt; font-weight: 700;
    padding: 1.5mm 3mm; border-radius: 2mm;
    letter-spacing: 0.04em; white-space: nowrap;
    text-align: center; line-height: 1.5; flex-shrink: 0;
  }
  .barcode-area {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    border-top: 0.3mm solid #e0e0e0; border-bottom: 0.3mm solid #e0e0e0;
    padding: 2mm 0; margin: 1mm 0;
  }
  .barcode-area svg {
    display: block; max-width: 100%;
  }
  .serial {
    font-family: 'Courier New', monospace;
    font-size: 9pt; font-weight: 700;
    letter-spacing: 0.12em; margin-top: 1.5mm;
  }
  .footer-row {
    display: grid; grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 2mm; border-top: 0.3mm solid #eee; padding-top: 2mm;
    margin-top: 1mm;
  }
  .footer-cell { display: flex; flex-direction: column; }
  .footer-label { font-size: 5.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #999; margin-bottom: 0.8mm; }
  .footer-value { font-size: 8pt; font-weight: 700; word-break: break-all; }
  .footer-brand {
    text-align: center; font-size: 5.5pt; color: #bbb;
    margin-top: 1.5mm; letter-spacing: 0.1em;
  }
  .print-btn {
    position: fixed; bottom: 12px; right: 12px;
    background: #1A3A0E; color: #fff; border: none; border-radius: 10px;
    padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer; z-index: 99;
  }
</style>
</head>
<body>
  <div class="top-row">
    <div>
      <div class="product-name">${bag.product_type}</div>
      <div class="section-name">${bag.section_name}</div>
    </div>
    <div class="badge">${bag.variant}<br><span style="font-weight:400;letter-spacing:0;font-size:6pt">${gradeShort}</span></div>
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
    <div class="footer-cell">
      <div class="footer-label">QC Status</div>
      <div class="footer-value">QC: Pending</div>
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
