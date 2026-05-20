/**
 * CNTP Bag Label Printer
 *
 * Generates a printable label window with a Code 128 barcode.
 *
 * Technology choice: Code 128 barcode (not QR code).
 * Reason: dusty, rough environment. Code 128 vertical lines remain readable
 * even when partially obscured by dust or a smudge. QR requires the full
 * pattern intact. Every USB scanner from any manufacturer reads Code 128.
 * Path to RFID: same serial, same database — only the scanner hardware changes.
 *
 * Layouts:
 *   - printBagLabel()     → single thermal label (4"×2", 203dpi Zebra ZD421)
 *   - printA4Sheet()      → 6 labels per A4 sheet for testing without thermal printer
 *
 * Requires: npm install jsbarcode
 * CDN fallback included in the print window for browser-side rendering.
 */

export interface LabelData {
  serial:       string
  productType:  string
  lotNumber:    string
  weightKg:     string
  date:         string
  variant?:     string
  operator?:    string
  sectionName?: string
  localExport?: string
}

/** CSS shared across both label layouts */
const LABEL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'IBM Plex Sans', Arial, sans-serif; background: #fff; color: #000; }
  .label {
    width: 96mm; height: 48mm;
    border: 0.5px solid #ccc;
    padding: 3mm 4mm;
    display: flex; flex-direction: column; justify-content: space-between;
    page-break-inside: avoid;
    overflow: hidden;
  }
  .label-header {
    display: flex; justify-content: space-between; align-items: flex-start;
  }
  .product-type {
    font-size: 11pt; font-weight: 600; line-height: 1.1;
    max-width: 55mm; word-break: break-word;
  }
  .variant-badge {
    font-size: 8pt; font-weight: 600;
    background: #000; color: #fff;
    padding: 1px 5px; border-radius: 2px;
    white-space: nowrap; align-self: flex-start; margin-top: 1px;
  }
  .barcode-wrap {
    display: flex; justify-content: center; align-items: center;
    height: 14mm; overflow: hidden;
  }
  .barcode-wrap svg { height: 14mm; max-width: 88mm; }
  .serial-text {
    text-align: center;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9pt; font-weight: 700;
    letter-spacing: 0.05em;
    margin-top: 0.5mm;
  }
  .label-footer {
    display: grid; grid-template-columns: 1fr 1fr 1fr;
    gap: 2mm; font-size: 7.5pt; line-height: 1.3;
  }
  .field-label { color: #666; display: block; font-size: 6pt; text-transform: uppercase; letter-spacing: 0.05em; }
  .field-value { font-weight: 600; font-size: 8pt; }
  @media print {
    @page { margin: 0; size: 96mm 48mm; }
    body  { margin: 0; }
    .label { border: none; }
  }
`

/** A4 sheet CSS — 6 labels per sheet, 2 columns × 3 rows */
const A4_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'IBM Plex Sans', Arial, sans-serif; background: #fff; color: #000; }
  .sheet {
    width: 210mm; min-height: 297mm;
    padding: 10mm 8mm;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: repeat(3, 1fr);
    gap: 6mm;
  }
  .label {
    border: 0.5px solid #bbb;
    padding: 3mm 4mm;
    display: flex; flex-direction: column; justify-content: space-between;
    overflow: hidden;
    height: 84mm;
  }
  .label-header {
    display: flex; justify-content: space-between; align-items: flex-start;
  }
  .product-type { font-size: 11pt; font-weight: 600; line-height: 1.1; max-width: 55mm; }
  .variant-badge {
    font-size: 8pt; font-weight: 600;
    background: #000; color: #fff;
    padding: 1px 5px; border-radius: 2px;
    white-space: nowrap; align-self: flex-start; margin-top: 1px;
  }
  .barcode-wrap { display: flex; justify-content: center; align-items: center; height: 20mm; overflow: hidden; }
  .barcode-wrap svg { height: 20mm; max-width: 88mm; }
  .serial-text {
    text-align: center;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10pt; font-weight: 700;
    letter-spacing: 0.08em; margin-top: 1mm;
  }
  .label-footer {
    display: grid; grid-template-columns: 1fr 1fr 1fr;
    gap: 2mm; font-size: 7.5pt; line-height: 1.3;
  }
  .field-label { color: #666; display: block; font-size: 6pt; text-transform: uppercase; letter-spacing: 0.05em; }
  .field-value { font-weight: 600; font-size: 8pt; }
  @media print {
    @page { margin: 0; size: A4 portrait; }
    body  { margin: 0; }
    .sheet { padding: 8mm; }
  }
`

function labelHTML(data: LabelData): string {
  const { serial, productType, lotNumber, weightKg, date, variant, operator, sectionName, localExport } = data
  return `
    <div class="label">
      <div class="label-header">
        <div>
          <span class="product-type">${productType}</span>
          ${sectionName ? `<span class="section-name">${sectionName}</span>` : ''}
        </div>
        ${variant ? `<span class="variant-badge">${variant}${localExport ? ' · ' + localExport : ''}</span>` : ''}
      </div>
      <div>
        <div class="barcode-wrap">
          <svg id="bc-${serial.replace(/[^a-zA-Z0-9]/g,'-')}"></svg>
        </div>
        <div class="serial-text">${serial}</div>
      </div>
      <div class="label-footer">
        <div>
          <span class="field-label">Lot / Batch</span>
          <span class="field-value">${lotNumber}</span>
        </div>
        <div>
          <span class="field-label">Weight</span>
          <span class="field-value">${weightKg} kg</span>
        </div>
        <div>
          <span class="field-label">Date</span>
          <span class="field-value">${date}</span>
        </div>
      </div>
    </div>
  `
}

function barcodeInitScript(labels: LabelData[]): string {
  const ids = labels.map(l =>
    `'bc-${l.serial.replace(/[^a-zA-Z0-9]/g, '-')}'`
  ).join(', ')
  return `
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"><\/script>
    <script>
      window.onload = function() {
        var ids = [${ids}];
        ids.forEach(function(id) {
          var el = document.getElementById(id);
          if (!el) return;
          // Serial is the last segment of the id reversed back
          var serial = el.id.replace(/^bc-/, '').replace(/-/g, match => {
            return el.getAttribute('data-serial') ? match : match;
          });
          // Use data-serial attribute set below
          var s = el.getAttribute('data-serial');
          if (!s) return;
          try {
            JsBarcode(el, s, {
              format: 'CODE128',
              width: 1.8,
              height: 50,
              displayValue: false,
              margin: 0,
            });
          } catch(e) { console.warn('Barcode error:', e); }
        });
        setTimeout(function() { window.print(); }, 400);
      };
    <\/script>
  `
}

/** Patch serial into svg data attributes after building HTML */
function injectSerialAttrs(html: string, labels: LabelData[]): string {
  let result = html
  labels.forEach(l => {
    const id = `bc-${l.serial.replace(/[^a-zA-Z0-9]/g, '-')}`
    result = result.replace(
      `id="${id}"`,
      `id="${id}" data-serial="${l.serial}"`
    )
  })
  return result
}

/**
 * Print a single thermal label (4"×2").
 * Designed for Zebra ZD421 at 203dpi printing from browser print dialog.
 */
export function printBagLabel(data: LabelData): void {
  const w = window.open('', '_blank', 'width=380,height=220')
  if (!w) { alert('Allow popups to print labels'); return }

  let html = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <style>${LABEL_CSS}</style>
  </head><body>
    ${labelHTML(data)}
    ${barcodeInitScript([data])}
  </body></html>`

  html = injectSerialAttrs(html, [data])
  w.document.write(html)
  w.document.close()
}

/**
 * Print up to 6 labels on a single A4 sheet.
 * Use this for immediate testing without a thermal printer — any office printer works.
 * Cut the labels out and attach to bags using tape or a bag tie.
 */
export function printA4Sheet(labels: LabelData[]): void {
  if (labels.length === 0) return
  const batch = labels.slice(0, 6) // Max 6 per A4 sheet

  const w = window.open('', '_blank', 'width=794,height=1123')
  if (!w) { alert('Allow popups to print labels'); return }

  let html = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <style>${A4_CSS}</style>
  </head><body>
    <div class="sheet">
      ${batch.map(l => labelHTML(l)).join('\n')}
    </div>
    ${barcodeInitScript(batch)}
  </body></html>`

  html = injectSerialAttrs(html, batch)
  w.document.write(html)
  w.document.close()
}