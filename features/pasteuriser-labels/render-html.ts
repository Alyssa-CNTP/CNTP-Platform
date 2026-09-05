/**
 * ResolvedLabel → HTML.
 *
 * ONE builder, three uses: the editor's live preview (embedded in an iframe),
 * the PDF proof that goes to Control Union and the customer, and the browser
 * print window that is the fallback when the Argox is unreachable. They must
 * not drift — a proof that does not look like what prints is a proof of
 * nothing, and that is the whole risk this workflow is meant to remove.
 *
 * The three differ only in `mode`, and only in chrome (watermark, print
 * button, proof footer) — never in the label body itself.
 *
 * Core does the resolving (lib/core/labels). This file is presentation only:
 * it never decides what a value is, only how it sits on the page.
 */

import type { ResolvedLabel, ResolvedLine, LabelCertification } from '@/lib/core/labels'
import { MARK_ART } from './marks'

export type RenderMode =
  /** Inside the editor, in an iframe. No chrome at all. */
  | 'preview'
  /** The approval pack: placeholders visible, watermarked, footer with version. */
  | 'proof'
  /** The real thing, on stock, via the browser print dialog. */
  | 'print'

export interface RenderOptions {
  mode: RenderMode
  /** Shown in the proof footer. Ignored in other modes. */
  issuedTo?: string
  issuedAt?: string
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** One certification mark plus the numbers printed under it. */
function markBlock(cert: LabelCertification): string {
  const art = MARK_ART[cert.mark]
  if (!art) return ''
  const caption = art.caption?.({
    registrationNo: cert.registrationNo,
    operatorNo: cert.operatorNo,
    floId: cert.floId,
  }) ?? []
  return `
    <div class="mark">
      <div class="mark-art">${art.svg}</div>
      ${caption.length ? `<div class="mark-caption">${caption.map(esc).join('<br>')}</div>` : ''}
    </div>`
}

function lineHtml(line: ResolvedLine): string {
  switch (line.kind) {
    case 'spacer':
      return '<div class="ln-spacer"></div>'
    case 'fixed':
      return `<div class="ln${line.indent ? ' ln-indent' : ''}${line.emphasis ? ' ln-em' : ''}">${esc(line.text)}</div>`
    case 'field': {
      // An unresolved placeholder is shown as a rule, not as an empty gap —
      // on a proof the reader has to be able to see that a value goes there.
      const unresolved = line.value === '—'
      return `<div class="ln${line.indent ? ' ln-indent' : ''}${line.emphasis ? ' ln-em' : ''}">` +
        `<span class="cap">${esc(line.caption)}:</span> ` +
        `<span class="val${unresolved ? ' val-empty' : ''}">${unresolved ? '' : esc(line.value)}</span>` +
        `</div>`
    }
    default: {
      // Exhaustiveness is guaranteed in core by assertNever on LabelLine;
      // ResolvedLine mirrors it, so this is unreachable. Return nothing rather
      // than throwing — a renderer must never be the thing that breaks a print.
      return ''
    }
  }
}

/**
 * The label body — identical in all three modes. Everything mode-specific is
 * wrapped around this, never inside it.
 */
export function buildLabelBody(resolved: ResolvedLabel): string {
  const marks = resolved.certifications.map(markBlock).join('')
  const lines = resolved.lines.map(lineHtml).join('')
  return `
    <div class="label label--marks-${resolved.markPosition}">
      ${resolved.markPosition === 'header' && marks ? `<div class="marks marks-header">${marks}</div>` : ''}
      <div class="body">
        <div class="lines">${lines}</div>
        ${resolved.markPosition === 'right' && marks ? `<div class="marks marks-right">${marks}</div>` : ''}
      </div>
      ${resolved.markPosition === 'bottom' && marks ? `<div class="marks marks-bottom">${marks}</div>` : ''}
    </div>`
}

const PT_PER_MM = 72 / 25.4
/** Arial's average advance width as a fraction of the em, measured over the
 *  label set's actual wording. Conservative — it errs towards a smaller font. */
const AVG_CHAR_EM = 0.55
const PAD_X_MM = 4
const PAD_Y_MM = 3
const MARK_GAP_MM = 2
/** Hanging indent for continuation lines (the manufacturer's address). */
const INDENT_MM = 13

/**
 * Type scale — fitted to BOTH dimensions, not just height.
 *
 * The same template model serves a 100×50 die and a 100×100 one, with line
 * counts from 8 to 17, so a fixed size either overflows the short die or floats
 * in the middle of the tall one.
 *
 * Fitting on height alone was not enough and produced a real defect: on a label
 * with marks down the right-hand side, the text column is ~17mm narrower, and
 * the manufacturer's address came out ellipsised — "Cape Natural Tea Pr…" on a
 * printed export label. Nobody would have caught that from the data, only by
 * looking at a bag. So the width the marks actually leave is part of the
 * calculation.
 *
 * Clamped at both ends. Below ~5.5pt a thermal head fills the letter counters
 * in and the text greys out; the floor cannot read it and neither can a
 * scanner.
 */
function typeScale(resolved: ResolvedLabel): { fontPt: number; leading: number; markMm: number } {
  const leading = 1.32
  const markMm = resolved.certifications.length === 0 ? 0
    : resolved.markPosition === 'right' ? 15 : 13

  // ── Height ──
  const printable = resolved.lines.filter(l => l.kind !== 'spacer').length
  const spacers = resolved.lines.length - printable
  const rows = printable + spacers * 0.5
  // Marks above or below the text take height from it; marks to the side do not.
  const markHeightMm = resolved.markPosition === 'right' ? 0 : markMm + MARK_GAP_MM
  const usableHeightMm = resolved.size.heightMm - PAD_Y_MM * 2 - markHeightMm
  const byHeight = rows > 0 ? (usableHeightMm / rows) / leading * PT_PER_MM : 13

  // ── Width ──
  // Solved per line and minimised, rather than from one "longest" line: an
  // indented address line has 13mm less room than a flush one, so the longest
  // string is not necessarily the tightest fit.
  const markWidthMm = resolved.markPosition === 'right' ? markMm + MARK_GAP_MM : 0
  const columnMm = resolved.size.widthMm - PAD_X_MM * 2 - markWidthMm
  let byWidth = 13
  for (const line of resolved.lines) {
    if (line.kind === 'spacer') continue
    const text = line.kind === 'fixed' ? line.text : `${line.caption}: ${line.value}`
    if (!text.length) continue
    const availableMm = columnMm - (line.indent ? INDENT_MM : 0)
    const fits = (availableMm * PT_PER_MM) / (AVG_CHAR_EM * text.length)
    byWidth = Math.min(byWidth, line.emphasis ? fits / 1.06 : fits)  // bold sets wider
  }

  const fontPt = Math.max(5.5, Math.min(13, Math.min(byHeight, byWidth)))
  return { fontPt, leading, markMm }
}

function css(resolved: ResolvedLabel, mode: RenderMode): string {
  const { widthMm, heightMm } = resolved.size
  const { fontPt, leading, markMm: markSize } = typeScale(resolved)

  return `
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  @media print { .no-print { display: none !important; } html, body { margin: 0; padding: 0; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: ${mode === 'preview' ? 'transparent' : '#fff'}; }
  body {
    font-family: Arial, Helvetica, -apple-system, sans-serif;
    color: #000;
    display: flex; align-items: center; justify-content: center;
  }
  .label {
    position: relative;
    width: ${widthMm}mm; height: ${heightMm}mm;
    background: #fff; color: #000;
    padding: ${PAD_Y_MM}mm ${PAD_X_MM}mm;
    display: flex; flex-direction: column; gap: 1mm;
    overflow: hidden;
    ${mode === 'print' ? '' : 'border: 0.5px solid #c9c9c9; border-radius: 3mm;'}
  }
  .body { flex: 1; display: flex; align-items: flex-start; gap: ${MARK_GAP_MM}mm; min-height: 0; }
  .lines { flex: 1; min-width: 0; }
  /* nowrap because an approved line must not silently reflow into two, which
     would change the layout the certifier signed. The type scale above is what
     guarantees it fits; the ellipsis is a last-resort tell, not the plan. */
  .ln {
    font-size: ${fontPt}pt; line-height: ${leading};
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ln-indent { padding-left: ${INDENT_MM}mm; }
  .ln-em { font-weight: 700; }
  .ln-spacer { height: ${(fontPt * leading) / 2}pt; }
  .cap { }
  .val { }
  /* An unfilled placeholder reads as a rule, so a proof shows WHERE the value
     goes. An empty gap would read as a label with nothing on that line. */
  .val-empty { display: inline-block; min-width: 24mm; border-bottom: 0.4pt solid #999; }

  .marks { display: flex; gap: ${MARK_GAP_MM}mm; align-items: center; }
  .marks-right { flex-direction: column; justify-content: flex-start; flex-shrink: 0; padding-top: 1mm; }
  .marks-bottom { justify-content: flex-end; }
  .marks-header { justify-content: flex-start; }
  .mark { text-align: center; flex-shrink: 0; }
  .mark-art { width: ${markSize}mm; height: ${markSize}mm; color: #000; }
  .mark-art svg { width: 100%; height: 100%; display: block; }
  .mark-caption {
    font-size: ${Math.max(4, fontPt * 0.45)}pt; line-height: 1.15;
    font-weight: 700; margin-top: 0.4mm; letter-spacing: 0.02em;
  }

  ${mode === 'proof' ? `
  .watermark {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: ${Math.max(20, heightMm * 0.30)}pt; font-weight: 800; letter-spacing: 0.12em;
    color: rgba(0,0,0,0.07); transform: rotate(-24deg); pointer-events: none;
    text-transform: uppercase; white-space: nowrap;
  }` : ''}

  .print-btn {
    position: fixed; bottom: 12px; right: 12px;
    background: #1A3A0E; color: #fff; border: none; border-radius: 10px;
    padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer; z-index: 99;
  }
  .proof-meta {
    margin-top: 4mm; width: ${widthMm}mm;
    font-family: Arial, sans-serif; font-size: 8pt; color: #333; line-height: 1.5;
  }
  .proof-meta b { color: #000; }
  .proof-meta .pending { color: #7a4a00; }
  `
}

/**
 * A complete standalone HTML document for the label.
 *
 * Standalone on purpose: the print window and the PDF renderer both run
 * detached from the app, so nothing may depend on the app's stylesheet being
 * present. Everything the label needs — type scale, marks, layout — is inline.
 */
export function buildLabelDocument(resolved: ResolvedLabel, opts: RenderOptions): string {
  const { mode } = opts
  const t = resolved.template
  const title = `${t.name} — ${t.code} v${t.version}`

  const proofMeta = mode === 'proof' ? `
    <div class="proof-meta">
      <div><b>${esc(t.name)}</b> &middot; ${esc(t.code)} version ${t.version} &middot; ${esc(t.market.toUpperCase())}${t.organic ? ' &middot; ORGANIC' : ''}</div>
      <div>Label stock ${resolved.size.widthMm} &times; ${resolved.size.heightMm} mm &middot; Cape Natural Tea Products</div>
      ${opts.issuedTo ? `<div>Issued to: <b>${esc(opts.issuedTo)}</b>${opts.issuedAt ? ` on ${esc(opts.issuedAt)}` : ''}</div>` : ''}
      ${resolved.missing.length ? `<div class="pending">Ruled fields are filled at production time from the job card: <b>${resolved.missing.map(esc).join(', ')}</b>.</div>` : ''}
      ${t.proofNote ? `<div>${esc(t.proofNote)}</div>` : ''}
    </div>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${css(resolved, mode)}</style>
</head>
<body>
  <div>
    ${buildLabelBody(resolved).replace(
      '<div class="body">',
      `${mode === 'proof' ? '<div class="watermark">Proof — not for production</div>' : ''}<div class="body">`,
    )}
    ${proofMeta}
  </div>
  ${mode === 'print' ? '<button class="print-btn no-print" onclick="window.print()">Print Label</button>' : ''}
</body>
</html>`
}

/**
 * Open the label in its own window and print it.
 *
 * The browser fallback for when the networked Argox is unreachable — same
 * shape as lib/production/label-print.ts openAndPrint(), deliberately, so the
 * floor sees one behaviour across bag tags and finished-product labels.
 */
export function openAndPrintLabel(resolved: ResolvedLabel): void {
  const html = buildLabelDocument(resolved, { mode: 'print' })
  const win = window.open('', '_blank', 'width=520,height=560')
  if (!win) { alert('Allow pop-ups to print labels'); return }
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 600)
}
