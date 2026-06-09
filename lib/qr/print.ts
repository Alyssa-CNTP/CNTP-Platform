'use client'

/**
 * print.ts — CNTP bag label printing
 *
 * Generates a print-ready A4 sheet with up to 6 labels per page.
 * Uses Code 128 barcodes via JsBarcode (loaded from cdnjs).
 *
 * Designed to match the physical handwritten tags currently in use:
 *   - Fine Leaf / Coarse Leaf: blue header (Sieving Tower tags)
 *   - Blended Material: white header (Blender tags)
 *   - Dust / Sticks: yellow header (Refining / Granule tags)
 *
 * Usage:
 *   printBagLabel(data)              — single label, opens print dialog
 *   printBagLabels(dataArray)        — multiple labels on one A4 sheet
 *   printSessionLabels(session)      — all tracked bags from a session
 */

export interface BagLabelData {
  serial:       string    // e.g. "21-05-01" or "08-04-26/1-02"
  productType:  string    // e.g. "Fine Leaf", "Blended Material"
  sectionName:  string    // e.g. "Sieving Tower"
  lotNumber:    string    // e.g. "GS-TEST" or "NOT TRACKED"
  weightKg:     string    // e.g. "300"
  variant:      string    // e.g. "CON", "ORG", "RA-CON", "RA-ORG"
  localExport:  string    // e.g. "Export"
  date:         string    // ISO string — displayed as DD-MM-YY
  operator?:    string
  acumaticaId?: string
  qcInitials?:  string  // QC person initials — printed on label
}

// Header colour per section/product type
function headerColour(productType: string, sectionName: string): string {
  const pt = productType.toLowerCase()
  const sn = sectionName.toLowerCase()
  if (pt.includes('fine leaf') || pt.includes('coarse leaf'))   return '#dbeafe' // blue-100
  if (pt.includes('blend') || sn.includes('blender'))           return '#f5f5f0' // off-white
  if (pt.includes('dust'))                                       return '#fef9c3' // yellow-100
  if (pt.includes('stick') || pt.includes('block'))             return '#fce7f3' // pink-100
  if (pt.includes('granule'))                                    return '#dcfce7' // green-100
  return '#f3f4f6'                                                                // grey
}

function formatDate(iso: string): string {
  try {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[3]}-${m[2]}-${m[1].slice(2)}`
    return iso.slice(0, 10)
  } catch {
    return iso.slice(0, 10)
  }
}

function safeId(serial: string): string {
  return 'bc_' + serial.replace(/[^a-zA-Z0-9]/g, '_')
}

function singleLabelHtml(label: BagLabelData): string {
  const bg   = headerColour(label.productType, label.sectionName)
  const id   = safeId(label.serial)
  const date = formatDate(label.date)
  const badge = label.localExport
    ? `${label.variant} · ${label.localExport}`
    : label.variant

  return `
  <div class="label" id="label-${id}">
    <div class="label-header" style="background:${bg}">
      <span class="label-title"><strong>${label.productType}</strong> ${label.sectionName}</span>
      <span class="variant-badge">${badge}</span>
    </div>

    <svg id="${id}" class="barcode"></svg>

    <div class="serial-line">${label.serial}</div>

    <div class="detail-grid">
      <div class="detail-cell">
        <div class="detail-label">Lot / Batch</div>
        <div class="detail-value">${label.lotNumber}</div>
      </div>
      <div class="detail-cell">
        <div class="detail-label">Weight</div>
        <div class="detail-value">${label.weightKg} kg</div>
      </div>
      <div class="detail-cell">
        <div class="detail-label">Date</div>
        <div class="detail-value">${date}</div>
      </div>
    </div>

    <div class="footer-row">
      ${label.qcInitials
        ? `<span class="qc-badge">QC <strong>${label.qcInitials}</strong></span>`
        : '<span class="qc-badge qc-empty">QC ___</span>'}
      ${label.acumaticaId ? `<span class="acu-id">${label.acumaticaId}</span>` : ''}
      ${label.operator ? `<span class="operator">${label.operator}</span>` : ''}
    </div>
  </div>`
}

function buildPrintHtml(labels: BagLabelData[]): string {
  const labelHtmls = labels.map(singleLabelHtml).join('\n')

  const barcodeScripts = labels.map(l => {
    const id = safeId(l.serial)
    return `
      try {
        JsBarcode('#${id}', '${l.serial}', {
          format: 'CODE128',
          width: 1.8,
          height: 55,
          displayValue: false,
          margin: 2,
          lineColor: '#111827',
          background: 'transparent'
        });
      } catch(e) { console.warn('Barcode error ${l.serial}:', e); }`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CNTP Bag Labels</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></script>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 8mm 8mm 8mm;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      background: white;
      font-size: 10px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      grid-template-rows: repeat(3, auto);
      gap: 5mm;
      width: 100%;
    }

    .label {
      border: 1.5px solid #374151;
      border-radius: 5px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 88mm;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .label-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 8px;
      border-bottom: 1px solid #9ca3af;
    }

    .label-title {
      font-weight: 700;
      font-size: 11px;
      color: #111827;
      letter-spacing: -0.01em;
    }

    .variant-badge {
      font-size: 9px;
      font-weight: 700;
      border: 1.5px solid #374151;
      padding: 2px 6px;
      border-radius: 3px;
      background: white;
      letter-spacing: 0.05em;
    }

    .barcode {
      width: 100%;
      height: 55px;
      display: block;
      padding: 3px 8px 0;
    }

    .serial-line {
      font-family: 'Courier New', Courier, monospace;
      font-size: 15px;
      font-weight: 700;
      text-align: center;
      letter-spacing: 0.12em;
      padding: 2px 0 5px;
      color: #111827;
      border-bottom: 0.5px solid #e5e7eb;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0;
      border-bottom: 0.5px solid #e5e7eb;
    }

    .detail-cell {
      padding: 4px 8px;
      border-right: 0.5px solid #e5e7eb;
    }
    .detail-cell:last-child { border-right: none; }

    .detail-label {
      font-size: 7.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #6b7280;
      margin-bottom: 2px;
    }

    .detail-value {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      font-weight: 700;
      color: #111827;
    }

    .footer-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 8px;
      border-bottom: 0.5px solid #e5e7eb;
      flex-wrap: wrap;
      gap: 3px;
    }

    .section-name {
      font-size: 8px;
      color: #6b7280;
      font-style: italic;
    }

    .acu-id {
      font-family: 'Courier New', Courier, monospace;
      font-size: 8px;
      color: #374151;
      font-weight: 600;
    }

    .operator {
      font-size: 8px;
      color: #6b7280;
    }

    .qc-badge {
      font-size: 9px;
      color: #374151;
      border: 1px solid #d1d5db;
      border-radius: 3px;
      padding: 1px 5px;
      background: #f9fafb;
    }
    .qc-badge strong { color: #059669; font-size: 10px; margin-left: 2px; }
    .qc-empty { color: #9ca3af; border-style: dashed; }

    @media print {
      body { margin: 0; }
      .page { gap: 4mm; }
    }
  </style>
</head>
<body>
  <div class="page">
    ${labelHtmls}
  </div>

  <script>
    document.addEventListener('DOMContentLoaded', function() {
      ${barcodeScripts}
      // Print after barcodes render — give JsBarcode 400ms
      setTimeout(function() { window.print(); }, 400);
    });
  </script>
</body>
</html>`
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Print a single label. Opens a new window and triggers print dialog.
 */
export function printBagLabel(params: {
  serial: string
  productType: string
  sectionName: string
  lotNumber: string
  weightKg: string
  variant: string
  localExport: string
  date: string
  qcInitials?: string
}) {
  const {
    serial, productType, sectionName, lotNumber,
    weightKg, variant, localExport, date, qcInitials,
  } = params

  const displayDate = (() => {
    try { return new Date(date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) }
    catch { return date }
  })()

  const variantLabel = (() => {
    const map: Record<string, string> = {
      'Conventional': 'CON', 'Organic': 'ORG',
      'RA-Conventional': 'RA-CON', 'RA-Organic': 'RA-ORG', 'FT-ORG': 'FT-ORG',
      'CON': 'CON', 'ORG': 'ORG', 'RA-CON': 'RA-CON', 'RA-ORG': 'RA-ORG',
    }
    return map[variant] ?? variant
  })()

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Bag Label — ${serial}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.5/JsBarcode.all.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; background: white; }
  .page {
    width: 148mm;
    padding: 8mm 8mm 6mm 8mm;
    background: white;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 6mm;
  }
  .product-type {
    font-size: 15pt;
    font-weight: 900;
    color: #000;
    line-height: 1.1;
  }
  .section-name {
    font-size: 11pt;
    font-weight: 400;
    color: #333;
    margin-top: 1mm;
  }
  .variant-pill {
    background: #000;
    color: #fff;
    font-size: 9pt;
    font-weight: 700;
    padding: 2mm 4mm;
    border-radius: 3mm;
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: 4mm;
    margin-top: 1mm;
  }
  .barcode-area {
    text-align: center;
    margin-bottom: 2mm;
  }
  .barcode-area svg {
    max-width: 100%;
    height: 22mm;
  }
  .serial {
    text-align: center;
    font-size: 13pt;
    font-weight: 700;
    font-family: 'Courier New', monospace;
    letter-spacing: 0.15em;
    margin-bottom: 5mm;
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0 4mm;
    border-top: 0.5mm solid #000;
    padding-top: 3mm;
    margin-bottom: 3mm;
  }
  .field-label {
    font-size: 7pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
    margin-bottom: 1mm;
  }
  .field-value {
    font-size: 10pt;
    font-weight: 700;
    color: #000;
    word-break: break-all;
  }
  .qc-row {
    border-top: 0.3mm solid #ccc;
    padding-top: 2.5mm;
    display: flex;
    align-items: center;
    gap: 3mm;
    font-size: 9pt;
  }
  .qc-label {
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
    white-space: nowrap;
  }
  .qc-value {
    font-weight: 700;
    color: #000;
    flex: 1;
    border-bottom: ${qcInitials ? 'none' : '0.3mm solid #000'};
    min-width: 30mm;
    padding-bottom: 1mm;
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="product-type">${productType}</div>
      <div class="section-name">${sectionName}</div>
    </div>
    <div class="variant-pill">${variantLabel}${localExport ? ' · ' + localExport : ''}</div>
  </div>

  <div class="barcode-area">
    <svg id="bc"></svg>
  </div>

  <div class="serial">${serial}</div>

  <div class="fields">
    <div>
      <div class="field-label">Lot / Batch</div>
      <div class="field-value">${lotNumber || '—'}</div>
    </div>
    <div>
      <div class="field-label">Weight</div>
      <div class="field-value">${weightKg ? weightKg + ' kg' : '—'}</div>
    </div>
    <div>
      <div class="field-label">Date</div>
      <div class="field-value">${displayDate}</div>
    </div>
  </div>

  <div class="qc-row">
    <span class="qc-label">QC:</span>
    <span class="qc-value">${qcInitials ?? ''}</span>
  </div>
</div>

<script>
  JsBarcode('#bc', '${serial}', {
    format: 'CODE128',
    lineColor: '#000',
    width: 2.2,
    height: 60,
    displayValue: false,
    margin: 0,
  })
  window.onload = function() { window.print(); window.close(); }
</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=600,height=400')
  if (!win) return
  win.document.write(html)
  win.document.close()
}

/**
 * Print multiple labels on one A4 sheet (6 per page, 2 columns × 3 rows).
 * Pass any number — the browser will paginate automatically for > 6.
 */
export function printBagLabels(labels: BagLabelData[]): void {
  if (labels.length === 0) return
  const html = buildPrintHtml(labels)
  const win  = window.open('', '_blank')
  if (!win) {
    alert('Pop-ups are blocked. Allow pop-ups for this site to print labels.')
    return
  }
  win.document.write(html)
  win.document.close()
}

/**
 * Print all tracked output bags from a session at once.
 * Skips bags with no serial or weight. Useful at end-of-shift.
 */
export function printSessionLabels(bags: BagLabelData[]): void {
  const tracked = bags.filter(b =>
    b.serial &&
    b.serial !== 'NOT TRACKED' &&
    parseFloat(b.weightKg) > 0
  )
  if (tracked.length === 0) {
    alert('No tracked bags to print. Make sure each bag has a serial and weight entered.')
    return
  }
  printBagLabels(tracked)
}