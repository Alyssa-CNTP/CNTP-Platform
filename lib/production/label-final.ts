/**
 * lib/production/label-final.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * FINAL-PRODUCT tags for the Pasteuriser: one per box / paper bag, plus one per
 * pallet.
 *
 * WHY A SEPARATE FILE FROM label-print.ts
 * The in-process bag tag in label-print.ts is a signed-off design and must not
 * change (it is the tag every upstream section prints and every downstream
 * section scans). Final product is a genuinely different label:
 *
 *   - it carries the company LOGO, because this is the tag that leaves the
 *     factory and sits next to the customer's own label,
 *   - it carries NO GRADE. Grade (A Export / B Export Blend / C Domestic) is a
 *     raw-material property that stops at the blender — a finished blend mixes
 *     grades by design (the Kunitaro SFC card is 50% A + 45% B + 5% granules),
 *     so any single letter would be a lie. Confirmed with the floor 2026-08-21.
 *     The badge shows the VARIANT only.
 *   - a box tag says which box of the batch it is ("BAG 281 OF 315"), and a
 *     pallet tag says what is on the pallet (box count + bag range + total kg).
 *
 * SCOPE NOTE: this is the CNTP internal traceability tag. It does not attempt
 * to satisfy destination-country retail labelling rules (net-weight
 * declarations, origin marks, best-before formats) — those live on the
 * customer's own label, specified per job card by its "Bag markings" field
 * (e.g. "Standard Kunitaro Label"). The two tags coexist on the box.
 *
 * The barcode encodes the SERIAL ONLY, matching every other tag on this floor:
 * scanning resolves to the database record rather than trying to pack data into
 * the symbol, so a code stays valid when anything about the bag changes.
 *
 * STRUCTURE: one kind-agnostic stylesheet (LABEL_CSS) driven by a `.box` /
 * `.pallet` class on the label element, plus one inner-HTML builder. Both the
 * single-tag window and the multi-tag print sheet compose those same two
 * pieces, so a tweak to either can never apply to one path and not the other.
 */

import { encodeCode128, getCode128Width } from '@/lib/production/code128'

// Full Acumatica variant word → the short code shown in the badge. Must stay in
// step with capture-config.ts VARIANT_OPTIONS (same map as label-print.ts /
// label-pplb.ts — duplicated rather than shared because those two are frozen
// designs and importing across them invites an "improvement" to one leaking
// into the other).
const VARIANT_SHORT: Record<string, string> = {
  'Conventional':    'CON',
  'Organic':         'ORG',
  'RA-Conventional': 'RA CON',
  'RA-Organic':      'RA ORG',
  'FT-ORG':          'FT ORG',
  'FT-CON':          'FT CON',
}

export interface FinalProductLabel {
  kind:         'box' | 'pallet'
  serial:       string
  item:         string       // product name, e.g. "Rooibos Super Fine Cut"
  variant:      string       // full word or short code — both render correctly
  lot:          string       // final-product batch, e.g. 26249-CON-SFC
  weightKg:     number       // net kg on THIS unit (one box, or the whole pallet)
  date:         string       // ISO instant
  itemCode?:    string | null
  packaging?:   string | null
  markings?:    string | null   // job card "Bag markings"
  customerPo?:  string | null
  // Box tags
  bagNo?:       number | null
  bagTotal?:    number | null
  // Pallet tags
  boxCount?:    number | null
  startBagNo?:  number | null
  endBagNo?:    number | null
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// SAST explicitly, not the device's locale default: a tablet whose timezone has
// drifted (or a label reprinted from a laptop abroad) must still print the
// South African production date. See the SAST display rule for the whole app.
function sastDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  // Parts, not a locale string: 'en-ZA' resolves to YYYY/MM/DD in Chromium,
  // which reads as ambiguous beside the paperwork's DD-MM-YYYY. The floor reads
  // these two side by side, so the tag matches the form.
  const p = new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'Africa/Johannesburg',
  }).formatToParts(d)
  const get = (t: string) => p.find(x => x.type === t)?.value ?? ''
  return `${get('day')}/${get('month')}/${get('year')}`
}

/** Logo as an absolute URL — the label renders in a popup whose base URL is
 *  about:blank in some browsers, where a bare "/logo.png" would not resolve. */
function logoUrl(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/logo.png`
}

// ── Stylesheet ───────────────────────────────────────────────────────────────
// Sized for the 100mm × 49.2mm stock already in the label printers. Box/pallet
// differences are class-driven, never baked in per render, so a sheet mixing
// both kinds lays each one out correctly.
const LABEL_CSS = `
  @page { size: 100mm 49.2mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; }
  .label {
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    width: 100mm; height: 49.2mm; padding: 1.5mm 2.5mm;
    display: flex; flex-direction: column;
    background: #fff; color: #000;
  }
  /* A pallet tag is the one an operator must never mistake for a box tag — the
     heavy double border is the at-a-glance difference, readable even when the
     label is half-covered on a stretch-wrapped pallet. */
  .label.pallet { border: 2px solid #000; outline: 1px solid #000; outline-offset: -3.5px; }

  .header { display: flex; align-items: center; gap: 2mm; margin-bottom: 0.8mm; }
  .logo { height: 9mm; width: auto; flex-shrink: 0; }
  .header-text { flex: 1; min-width: 0; }
  .product-name {
    font-weight: 900; line-height: 1.02; text-transform: uppercase;
    /* Long product names must shrink the line, never push the badge off the
       label — two lines max, then clip. */
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .box .product-name    { font-size: 17pt; }
  .pallet .product-name { font-size: 15pt; }
  .sub { font-size: 7pt; font-weight: 600; color: #333; text-transform: uppercase; letter-spacing: 0.04em;
         overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .badge-col { display: flex; flex-direction: column; gap: 0.8mm; align-items: stretch; flex-shrink: 0; }
  .variant-badge {
    background: #000; color: #fff; padding: 1.2mm 2.6mm; text-align: center; min-width: 18mm;
    font-size: 8pt; font-weight: 800; white-space: nowrap; text-transform: uppercase;
  }
  .kind-badge {
    border: 1px solid #000; padding: 0.6mm 2.6mm; text-align: center;
    font-size: 6pt; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
  }

  .barcode-area {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 0.5mm 0; min-height: 0;
  }
  .box .barcode-area    { padding-left: 14mm; padding-right: 14mm; }
  .pallet .barcode-area { padding-left: 10mm; padding-right: 10mm; }
  .barcode-area svg { display: block; width: 100%; height: auto; }
  .serial {
    font-family: 'Courier New', monospace; font-weight: 700;
    letter-spacing: 0.14em; margin-top: 0.7mm; text-align: center;
  }
  .box .serial    { font-size: 10pt; }
  .pallet .serial { font-size: 11pt; }

  /* NOT an even 4-way split: the batch/lot is the field every downstream
     lookup keys on, and a real one ("26249-CON-SFC") ellipsised to
     "26249-CON-..." at 1fr — which is worse than useless on a traceability
     tag. It gets the widest column; the date, whose width is fixed and known,
     gets the narrowest. */
  .footer-row { display: grid; grid-template-columns: 1.35fr 0.95fr 0.9fr 0.8fr; gap: 1mm; padding: 0 1mm; }
  .footer-cell { text-align: center; min-width: 0; }
  .footer-cell:first-child { text-align: left; }
  .footer-cell:last-child { text-align: right; }
  .footer-label { font-size: 5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #666; font-weight: 700; }
  .footer-value {
    font-size: 8pt; font-weight: 800; line-height: 1.15; text-transform: uppercase;
    letter-spacing: -0.01em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .markings {
    font-size: 5.5pt; color: #444; text-transform: uppercase; letter-spacing: 0.05em;
    text-align: center; margin-top: 0.4mm;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .print-btn {
    position: fixed; bottom: 12px; right: 12px;
    background: #1A3A0E; color: #fff; border: none; border-radius: 10px;
    padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer; z-index: 99;
  }
  @media print { .no-print { display: none !important; } }
`

// ── One label's markup ───────────────────────────────────────────────────────
function labelHtml(l: FinalProductLabel): string {
  const isPallet = l.kind === 'pallet'
  const variant  = VARIANT_SHORT[l.variant] ?? l.variant ?? ''

  // Pallet barcodes get a wider module: a pallet tag is read across a warehouse
  // aisle by a handheld, often at an angle, where a box tag is scanned in the
  // hand at ~15cm. Wider bars are materially more forgiving at distance.
  const mw = isPallet ? 2.4 : 2.0
  const barWidth   = getCode128Width(l.serial, mw)
  const barcodeSvg = encodeCode128(l.serial, { height: Math.round(barWidth * (isPallet ? 0.26 : 0.22)), moduleWidth: mw })

  // Footer differs by tag kind — a box counts itself within the batch, a pallet
  // reports its contents.
  const footer: [string, string][] = isPallet
    ? [
        ['Batch / Lot', l.lot || '—'],
        ['Boxes', l.boxCount != null
          ? `${l.boxCount}${l.startBagNo != null && l.endBagNo != null ? ` · ${l.startBagNo}-${l.endBagNo}` : ''}`
          : '—'],
        ['Net total', `${l.weightKg.toFixed(1)} kg`],
        ['Date', sastDate(l.date)],
      ]
    : [
        ['Batch / Lot', l.lot || '—'],
        ['Bag', l.bagNo != null ? `${l.bagNo}${l.bagTotal ? ` of ${l.bagTotal}` : ''}` : '—'],
        ['Net weight', `${l.weightKg.toFixed(1)} kg`],
        ['Date', sastDate(l.date)],
      ]

  const extra = [l.customerPo ? `PO ${l.customerPo}` : null, l.markings].filter(Boolean).join(' · ')

  return `<div class="label ${isPallet ? 'pallet' : 'box'}">
  <div class="header">
    <img class="logo" src="${logoUrl()}" alt="" />
    <div class="header-text">
      <div class="product-name">${esc(l.item || 'Rooibos Final Product')}</div>
      <div class="sub">${esc([l.itemCode, l.packaging].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="badge-col">
      ${variant ? `<div class="variant-badge">${esc(variant)}</div>` : ''}
      <div class="kind-badge">${isPallet ? 'Pallet' : 'Box'}</div>
    </div>
  </div>

  <div class="barcode-area">
    ${barcodeSvg}
    <div class="serial">${esc(l.serial)}</div>
  </div>

  <div class="footer-row">
    ${footer.map(([label, value]) => `
    <div class="footer-cell">
      <div class="footer-label">${esc(label)}</div>
      <div class="footer-value">${esc(value)}</div>
    </div>`).join('')}
  </div>
  ${extra ? `<div class="markings">${esc(extra)}</div>` : ''}
</div>`
}

function page(title: string, bodyHtml: string, buttonLabel: string, sheet: boolean): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>${LABEL_CSS}${sheet ? `
  /* Sheet mode: one label per printed page. */
  .label { page-break-after: always; break-after: page; }
  .label:last-of-type { page-break-after: auto; break-after: auto; }
  @media screen {
    body { background: #e7e5e4; padding: 12px; }
    .label { margin: 0 auto 10px; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
  }` : ''}</style>
</head>
<body>
${bodyHtml}
<button class="print-btn no-print" onclick="window.print()">${esc(buttonLabel)}</button>
</body>
</html>`
}

/** One final-product tag — a single box/bag, or a single pallet. */
export function buildFinalLabelHtml(l: FinalProductLabel): string {
  return page(
    `${l.kind === 'pallet' ? 'Pallet' : 'Final Product'} Tag — ${l.serial}`,
    labelHtml(l),
    'Print Tag',
    false,
  )
}

/**
 * Print sheet for a whole run of tags — one label per printed page.
 *
 * A 315-box batch cannot be 315 separate popup windows: browsers block them
 * after the first few, and an operator cannot babysit 315 print dialogues. One
 * document with a hard page break per label sends the entire range to the
 * printer as a single job, which is also how the thermal printer path behaves.
 * Box and pallet tags may be mixed freely — layout is class-driven.
 */
export function buildFinalLabelSheetHtml(labels: FinalProductLabel[]): string {
  if (labels.length === 0) {
    return page('No tags', '<div class="label box"><div class="header"><div class="header-text">'
      + '<div class="product-name">No tags to print</div></div></div></div>', 'Close', false)
  }
  return page(
    `Final Product Tags — ${labels.length}`,
    labels.map(labelHtml).join('\n'),
    `Print ${labels.length} tag${labels.length === 1 ? '' : 's'}`,
    true,
  )
}

// ── Printing ─────────────────────────────────────────────────────────────────

function openAndPrint(html: string): void {
  const win = window.open('', '_blank', 'width=460,height=520')
  if (!win) { alert('Allow pop-ups to print tags'); return }
  win.document.write(html)
  win.document.close()
  win.focus()
  // Short delay lets the page (and the logo image) render before the print
  // dialog opens — without it the logo prints blank on a cold cache.
  setTimeout(() => win.print(), 900)
}

/** Browser print — one tag, or a sheet of them. Always available; also the
 *  fallback when the thermal printer is unreachable. */
export function printFinalLabelsBrowser(labels: FinalProductLabel[]): void {
  if (labels.length === 0) return
  openAndPrint(labels.length === 1
    ? buildFinalLabelHtml(labels[0])
    : buildFinalLabelSheetHtml(labels))
}

export interface FinalPrintResult {
  ok: boolean
  /** 'thermal' when the Argox took the job, 'browser' when we fell back. */
  via: 'thermal' | 'browser'
  count: number
  error?: string
}

/**
 * Print final-product tags to the pasteuriser's Argox, falling back to the
 * browser window if it's unreachable or rejects the job.
 *
 * Mirrors printLabelAuto's contract for the in-process bag tag, with one
 * addition: it REPORTS which path was used. A silent fallback is dangerous
 * here — an operator who thinks 40 box tags went to the label printer will walk
 * to the printer, find nothing, and have no idea a browser dialog is waiting on
 * the handheld. The caller surfaces `via` on screen.
 */
export async function printFinalLabelsAuto(
  labels: FinalProductLabel[],
  sectionId = 'pasteuriser',
): Promise<FinalPrintResult> {
  if (labels.length === 0) return { ok: true, via: 'thermal', count: 0 }
  try {
    const res = await fetch('/api/print/final-label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels, section: sectionId }),
    })
    if (res.ok) return { ok: true, via: 'thermal', count: labels.length }
    const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    console.warn('[printFinalLabelsAuto] thermal print failed, falling back to browser:', error)
    printFinalLabelsBrowser(labels)
    return { ok: true, via: 'browser', count: labels.length, error }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[printFinalLabelsAuto] thermal print unreachable, falling back to browser:', message)
    printFinalLabelsBrowser(labels)
    return { ok: true, via: 'browser', count: labels.length, error: message }
  }
}
