// THERMAL PRINTER UPGRADE PATH
// When a Zebra/Brother/Dymo thermal printer is connected:
// 1. Replace window.open/print with ZPL commands sent to http://localhost:9100 (Zebra)
// 2. ZPL template stored in lib/production/label-zpl.ts
// 3. Module width changes: moduleWidth: 0.3 (Zebra 203dpi) or 0.5 (300dpi)
// Current: browser print to regular printer (100mm × 75mm page size)

import type { OutputBag } from './live-types'
import { GRADE_LABELS } from './live-types'
import { encodeCode128, getCode128Width } from '@/lib/production/code128'

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
  const gradeShort = GRADE_FULL[bag.grade] ?? GRADE_LABELS[bag.grade] ?? bag.grade

  const dateFormatted = new Date(bag.created_at).toLocaleDateString('en-ZA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  const mw       = 2.0
  const barWidth = getCode128Width(bag.serial_number, mw)
  const barcodeSvg = encodeCode128(bag.serial_number, { height: Math.round(barWidth * 0.24), moduleWidth: mw })

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Bag Label — ${bag.serial_number}</title>
<style>
  @page { size: 100mm 50mm; margin: 0; }
  @media print {
    html, body { margin: 0; padding: 0; width: 100mm; height: 50mm; }
    .no-print { display: none !important; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Arial Narrow', Arial, Helvetica, sans-serif;
    width: 100mm; height: 50mm;
    padding: 1.5mm 2.5mm;
    display: flex; flex-direction: column;
    background: #fff; color: #000;
  }
  .header {
    display: flex; align-items: flex-start; justify-content: space-between;
    margin-bottom: 1mm;
  }
  .header-left { display: flex; flex-direction: column; }
  .product-name { font-size: 11pt; font-weight: 800; line-height: 1.1; }
  .section-name { font-size: 7pt; color: #444; margin-top: 0.5mm; }
  .type-grade-box {
    border: 1.5px solid #000; padding: 1mm 2.5mm; text-align: left;
    min-width: 22mm; flex-shrink: 0;
  }
  .type-grade-box .tg-label { font-size: 5.5pt; font-weight: 700; letter-spacing: 0.08em; }
  .type-grade-box .tg-value { font-size: 8pt; font-weight: 800; line-height: 1.15; margin-bottom: 0.8mm; }
  .type-grade-box .tg-value:last-child { margin-bottom: 0; }
  .barcode-area {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 1mm 16mm;
  }
  .barcode-area svg { display: block; width: 100%; height: auto; }
  .serial {
    font-family: 'Courier New', monospace;
    font-size: 10pt; font-weight: 700;
    letter-spacing: 0.15em; margin-top: 1mm; text-align: center;
  }
  .rule { border: none; border-top: 0.5mm solid #000; margin: 0.5mm 2.5mm; }
  .footer-row {
    display: grid; grid-template-columns: 1fr 1fr 1fr;
    padding: 0 2.5mm;
  }
  .footer-cell {}
  .footer-label { font-size: 5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #666; font-weight: 700; }
  .footer-value { font-size: 8pt; font-weight: 800; line-height: 1.2; }
  .print-btn {
    position: fixed; bottom: 12px; right: 12px;
    background: #1A3A0E; color: #fff; border: none; border-radius: 10px;
    padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer; z-index: 99;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <div class="product-name">${bag.product_type}</div>
      <div class="section-name">${bag.section_name}</div>
    </div>
    <div class="type-grade-box">
      <div class="tg-label">TYPE</div>
      <div class="tg-value">${bag.variant}</div>
      <div class="tg-label">GRADE</div>
      <div class="tg-value">${bag.grade} ${gradeShort}</div>
    </div>
  </div>

  <div class="barcode-area">
    ${barcodeSvg}
    <div class="serial">${bag.serial_number}</div>
  </div>

  <hr class="rule">

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

async function printLabelDirect(bag: OutputBag): Promise<void> {
  // The server resolves the printer from the bag's section (SECTION_PRINTER),
  // so the client never picks a printer — the section→printer binding is enforced.
  const res = await fetch('/api/print/label', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bag }),
  })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error)
  }
}

/**
 * Print to the networked label printer assigned to this bag's section (Zebra/ZPL
 * or Argox/PPLB, over TCP 9100). Falls back to the browser print window if the
 * printer is unreachable or no printer is assigned to the section.
 */
export async function printLabelAuto(bag: OutputBag): Promise<void> {
  try {
    await printLabelDirect(bag)
    return
  } catch (err) {
    console.warn('[printLabelAuto] Direct print failed, falling back to browser:', err)
  }
  openAndPrint(buildLabelHtml(bag))
}
