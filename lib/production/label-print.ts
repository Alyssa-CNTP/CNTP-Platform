// THERMAL PRINTER UPGRADE PATH
// When a Zebra/Brother/Dymo thermal printer is connected:
// 1. Replace window.open/print with ZPL commands sent to http://localhost:9100 (Zebra)
// 2. ZPL template stored in lib/production/label-zpl.ts
// 3. Module width changes: moduleWidth: 0.3 (Zebra 203dpi) or 0.5 (300dpi)
// Current: browser print to regular printer (100mm × 75mm page size)

import type { OutputBag } from './live-types'
import { VARIANT_LABELS, GRADE_LABELS } from './live-types'
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
  const typeLabel  = VARIANT_LABELS[bag.variant] ?? bag.variant
  const gradeName  = GRADE_FULL[bag.grade] ?? GRADE_LABELS[bag.grade] ?? bag.grade

  const dateFormatted = new Date(bag.created_at).toLocaleDateString('en-ZA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  // The barcode encodes ONLY the serial — every other field lives in
  // production.bag_tags keyed by that serial, so a data change never invalidates
  // a printed label. It's the focal point of the label, so it's generated tall
  // (~24% of its width) and printed to fill the full label width — a large, high
  // quiet-zone symbol that a phone/scanner camera locks onto from across a bay.
  const mw       = 2.0
  const barWidth = getCode128Width(bag.serial_number, mw)
  const barcodeSvg = encodeCode128(bag.serial_number, { height: Math.round(barWidth * 0.24), moduleWidth: mw })

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
    padding: 3.5mm 4mm 3mm;
    display: flex; flex-direction: column;
    background: #fff; color: #000;
  }
  /* Header — product name owns the top line; type/grade sit as one quiet strip */
  .head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 3mm;
    border-bottom: 0.5mm solid #000; padding-bottom: 1.6mm;
  }
  .product-name { font-size: 13.5pt; font-weight: 800; line-height: 1.02; letter-spacing: -0.01em; }
  .section-name { font-size: 6.5pt; color: #555; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; white-space: nowrap; }
  .class-strip { display: flex; gap: 5mm; padding: 1.6mm 0 0; }
  .class-cell { display: flex; align-items: baseline; gap: 1.4mm; }
  .class-label { font-size: 5.5pt; text-transform: uppercase; letter-spacing: 0.12em; color: #888; font-weight: 700; }
  .class-value { font-size: 8.5pt; font-weight: 800; line-height: 1; }
  .class-value small { font-size: 6pt; font-weight: 700; color: #555; }
  /* Barcode — the focal point: centred, fills the width, generous whitespace */
  .barcode-area {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 2.5mm 0 1.5mm;
  }
  .barcode-area svg { display: block; width: 100%; height: auto; }
  .serial {
    font-family: 'Courier New', monospace;
    font-size: 12pt; font-weight: 700;
    letter-spacing: 0.18em; margin-top: 1.6mm; text-align: center;
  }
  /* Footer facts — one aligned row, hairline separators between the three cells */
  .footer-row {
    display: grid; grid-template-columns: 1.4fr 1fr 1.1fr;
    border-top: 0.5mm solid #000; padding-top: 1.6mm;
  }
  .footer-cell { padding: 0 2.5mm; }
  .footer-cell + .footer-cell { border-left: 0.2mm solid #ccc; }
  .footer-cell:first-child { padding-left: 0; }
  .footer-label { font-size: 5.5pt; text-transform: uppercase; letter-spacing: 0.1em; color: #999; margin-bottom: 0.6mm; font-weight: 700; }
  .footer-value { font-size: 9pt; font-weight: 800; line-height: 1.05; word-break: break-word; }
  .footer-brand { text-align: center; font-size: 5.5pt; color: #aaa; margin-top: 1.6mm; letter-spacing: 0.14em; text-transform: uppercase; }
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

  <div class="class-strip">
    <div class="class-cell">
      <span class="class-label">Type</span>
      <span class="class-value">${typeLabel} <small>${bag.variant}</small></span>
    </div>
    <div class="class-cell">
      <span class="class-label">Grade</span>
      <span class="class-value">${gradeName} <small>${bag.grade}</small></span>
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
