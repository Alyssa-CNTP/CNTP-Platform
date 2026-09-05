/**
 * ResolvedLabel → PPLB (EPL2-compatible), for the Argox CP-2140EX.
 *
 * Same printer and command set as lib/production/label-pplb.ts, which prints
 * the bag tags. Kept separate rather than generalised: a bag tag is a barcode
 * hero with a fixed three-cell footer, a finished-product label is a variable
 * line list with certification marks. Merging them would be the same false
 * economy as unifying the five mass-balance formulas (ARCHITECTURE.md §4) —
 * they look similar and answer to different masters.
 *
 * ── THE IMPORTANT LIMITATION ────────────────────────────────────────────────
 *
 * PPLB draws text and barcodes. It cannot draw an arbitrary SVG. A certification
 * mark can only reach the printer as a bitmap stored on the printer itself.
 *
 * That matters far more than it sounds. A label whose JAS mark silently did not
 * print is not a cosmetic defect — it is product that cannot legally be sold as
 * organic in Japan, on a bag nobody will look at twice because everything else
 * on it is correct. So `pplbFidelity()` REFUSES rather than degrades: a template
 * carrying marks is printed through the browser path, which renders the artwork
 * properly, and direct PPLB is used only for labels that are pure text.
 *
 * Do not "improve" this by dropping the marks and printing anyway.
 */

import type { ResolvedLabel } from '@/lib/core/labels'

// Argox CP-2140EX, 203 dpi = 8 dots/mm.
const DOTS_PER_MM = 8

/** Escape characters that would break an EPL2 quoted string. */
function clean(s: string): string {
  return String(s ?? '').replace(/"/g, "'").replace(/[\r\n]/g, ' ')
}

export type PplbFidelity =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Whether this label can be printed faithfully over PPLB.
 *
 * The one blocker is certification artwork. Everything else on a CNTP
 * finished-product label is text.
 */
export function pplbFidelity(resolved: ResolvedLabel): PplbFidelity {
  if (resolved.certifications.length > 0) {
    const names = resolved.certifications.map(c => c.mark).join(', ')
    return {
      ok: false,
      reason:
        `This label carries certification artwork (${names}), which a PPLB thermal ` +
        `stream cannot draw. Printing it directly would produce a label missing its ` +
        `mark — for organic and JAS product that is a compliance failure, not a ` +
        `cosmetic one. Use the browser print path, which renders the marks.`,
    }
  }
  return { ok: true }
}

/**
 * Bitmap font cell widths in dots at multiplier 1. Same table as the bag-tag
 * builder — these are the printer's built-in fonts, which are the ones
 * confirmed to actually print (a downloaded Arial was silently dropped).
 */
const FONT_W: Record<number, number> = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 32 }
const FONT_H: Record<number, number> = { 1: 12, 2: 16, 3: 20, 4: 24, 5: 48 }

/**
 * Pick the largest built-in font whose lines all fit the label's width and
 * whose stacked height fits its depth.
 *
 * Chosen rather than fixed because line counts vary from 8 to 16 across the
 * template set, and a font that fits the Kunitaro label overflows the EU
 * organic one.
 */
function pickFont(lines: string[], widthDots: number, heightDots: number): number {
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0)
  for (const font of [4, 3, 2, 1]) {
    const fitsWidth = longest * FONT_W[font] <= widthDots
    const fitsHeight = lines.length * (FONT_H[font] + 4) <= heightDots
    if (fitsWidth && fitsHeight) return font
  }
  return 1
}

/**
 * Flatten a resolved label to the plain text lines the printer will set.
 *
 * Exported because the preview needs to show exactly this — what the thermal
 * printer will actually put on the bag, not what the browser would.
 */
export function pplbTextLines(resolved: ResolvedLabel): string[] {
  const out: string[] = []
  for (const line of resolved.lines) {
    if (line.kind === 'spacer') { out.push(''); continue }
    if (line.kind === 'fixed') { out.push(line.indent ? `      ${line.text}` : line.text); continue }
    out.push(`${line.caption}: ${line.value}`)
  }
  return out
}

/**
 * Build the PPLB command stream.
 *
 * Throws if the label cannot be printed faithfully. Callers check
 * `pplbFidelity()` first and route to the browser path; the throw is the
 * backstop so a new caller cannot skip the check by accident.
 *
 * PPLB command reference (as in lib/production/label-pplb.ts):
 *   N                                 clear image buffer
 *   q<dots> / Q<dots>,<gap>           label width / length,gap
 *   D<0-15> / S<speed>                darkness / print speed
 *   A x,y,rot,font,hm,vm,rev,"data"   text
 *   P<copies>                         print
 */
export function buildLabelPplb(resolved: ResolvedLabel, copies = 1): string {
  const fidelity = pplbFidelity(resolved)
  if (!fidelity.ok) throw new Error(fidelity.reason)

  const W = Math.round(resolved.size.widthMm * DOTS_PER_MM)
  const H = Math.round(resolved.size.heightMm * DOTS_PER_MM)
  const padX = Math.round(3 * DOTS_PER_MM)
  const padY = Math.round(2.5 * DOTS_PER_MM)

  const text = pplbTextLines(resolved)
  const font = pickFont(text, W - padX * 2, H - padY * 2)
  const step = FONT_H[font] + 4

  const cmds: string[] = ['N', `q${W}`, `Q${H},24`, 'D10', 'S2']

  let y = padY
  for (const line of text) {
    if (line !== '') cmds.push(`A${padX},${y},0,${font},1,1,N,"${clean(line)}"`)
    y += step
  }

  cmds.push(`P${Math.max(1, Math.round(copies))}`)
  return cmds.join('\n') + '\n'
}
