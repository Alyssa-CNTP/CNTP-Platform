/**
 * Regression tests for label rendering.
 *
 * These exist because the first version of the type scale fitted on HEIGHT
 * only, and on any label with marks down the right-hand side the text column is
 * ~17mm narrower than the label. The result was a printed export label reading
 * "Manufacturer: Cape Natural Tea Pr…". Nothing in the data was wrong, no test
 * failed, and the only way to see it was to look at a bag.
 *
 * So the fit is asserted arithmetically here, against the real seed templates,
 * for every label in the set.
 */

import { describe, it, expect } from 'vitest'
import { resolveLabel, type LabelBinding, type LabelTemplate } from '@/lib/core/labels'
import { SEED_TEMPLATES } from './seed-templates'
import { buildLabelDocument, buildLabelBody } from './render-html'
import { buildLabelPplb, pplbFidelity, pplbTextLines } from './render-pplb'

/** A worst-case binding: the longest plausible value for every field. */
const LONG_BINDING: LabelBinding = {
  grade: 'RA Conventional Super Fine Cut - SG',
  batch_no: '26166-CON-CH', serial_no: '20-08-01',
  production_date: '20-08-2026', best_before_date: '20-08-2029',
  net_mass: '18 kg', gross_mass: '18.3 kg', po_number: 'KTR 4417',
  product: 'Organic Rooibos', item_number: '15IGST-C', lot_number: 'RSGG-05626',
  importer: 'Kunitaro Co. Ltd, Shizuoka', customer: 'Kunitaro',
  job_card_no: 'JC-2026-0044', pallet_no: '12',
}

function approved(seed: (typeof SEED_TEMPLATES)[number]): LabelTemplate {
  return { ...seed, id: seed.code, version: 1, status: 'approved' } as LabelTemplate
}

/** The font size the renderer chose, read back out of the generated CSS. */
function renderedFontPt(t: LabelTemplate, binding: LabelBinding): number {
  const html = buildLabelDocument(resolveLabel(t, binding), { mode: 'print' })
  const m = html.match(/font-size: ([\d.]+)pt; line-height/)
  expect(m, `no .ln font-size found for ${t.code}`).toBeTruthy()
  return parseFloat(m![1])
}

const PT_PER_MM = 72 / 25.4
const AVG_CHAR_EM = 0.55
const PAD_X_MM = 4
const INDENT_MM = 13
const MARK_GAP_MM = 2

describe.each(SEED_TEMPLATES.map(s => [s.code, s] as const))('%s', (code, seed) => {
  const t = approved(seed)

  it('fits every line within the width the marks leave', () => {
    const resolved = resolveLabel(t, LONG_BINDING)
    const fontPt = renderedFontPt(t, LONG_BINDING)

    const markMm = resolved.certifications.length === 0 ? 0
      : resolved.markPosition === 'right' ? 15 : 13
    const columnMm = resolved.size.widthMm - PAD_X_MM * 2
      - (resolved.markPosition === 'right' && markMm ? markMm + MARK_GAP_MM : 0)

    for (const line of resolved.lines) {
      if (line.kind === 'spacer') continue
      const text = line.kind === 'fixed' ? line.text : `${line.caption}: ${line.value}`
      if (!text.length) continue
      const widthMm = (text.length * AVG_CHAR_EM * fontPt) / PT_PER_MM
      const availableMm = columnMm - (line.indent ? INDENT_MM : 0)
      expect(widthMm, `"${text}" overflows on ${code}`).toBeLessThanOrEqual(availableMm + 0.01)
    }
  })

  it('fits every line within the label height', () => {
    const resolved = resolveLabel(t, LONG_BINDING)
    const fontPt = renderedFontPt(t, LONG_BINDING)
    const printable = resolved.lines.filter(l => l.kind !== 'spacer').length
    const spacers = resolved.lines.length - printable
    const rows = printable + spacers * 0.5
    const markMm = resolved.certifications.length === 0 ? 0
      : resolved.markPosition === 'right' ? 0 : 13 + MARK_GAP_MM
    const usedMm = (rows * fontPt * 1.32) / PT_PER_MM
    expect(usedMm, `${code} overflows its stock`).toBeLessThanOrEqual(resolved.size.heightMm - 6 - markMm + 0.01)
  })

  // Below roughly 5.5pt a thermal head fills the letter counters in and the
  // text greys out. A label the floor cannot read is not a working label.
  it('never sets type smaller than the printer can resolve', () => {
    expect(renderedFontPt(t, LONG_BINDING)).toBeGreaterThanOrEqual(5.5)
  })

  it('renders the same body in all three modes', () => {
    const resolved = resolveLabel(t, LONG_BINDING)
    const body = buildLabelBody(resolved)
    for (const mode of ['preview', 'proof', 'print'] as const) {
      const doc = buildLabelDocument(resolved, { mode })
      // The body appears verbatim; only the chrome around it differs. In proof
      // mode the watermark is spliced in immediately before `.body`, so compare
      // with that removed.
      expect(doc.replace(/<div class="watermark">[^<]*<\/div>/, '')).toContain(body)
    }
  })
})

describe('certification marks and the thermal printer', () => {
  it('refuses a PPLB stream for any label carrying marks', () => {
    for (const seed of SEED_TEMPLATES) {
      const resolved = resolveLabel(approved(seed), LONG_BINDING)
      if (resolved.certifications.length === 0) continue
      expect(pplbFidelity(resolved).ok, `${seed.code} should refuse PPLB`).toBe(false)
      expect(() => buildLabelPplb(resolved)).toThrow(/cannot draw/i)
    }
  })

  // The failure this guards: silently dropping the mark and printing anyway.
  // For Japan that is product that cannot be sold as organic.
  it('the JAS label is never printed as plain text', () => {
    const jas = SEED_TEMPLATES.find(s => s.code === 'JAS')!
    expect(() => buildLabelPplb(resolveLabel(approved(jas), LONG_BINDING))).toThrow()
  })

  it('builds a PPLB stream for a plain-text label', () => {
    const local = SEED_TEMPLATES.find(s => s.code === 'LOCAL')!
    const resolved = resolveLabel(approved(local), LONG_BINDING)
    expect(pplbFidelity(resolved).ok).toBe(true)
    const pplb = buildLabelPplb(resolved, 2)
    expect(pplb.startsWith('N\n')).toBe(true)
    expect(pplb).toContain('q800')      // 100mm at 8 dots/mm
    expect(pplb.trimEnd().endsWith('P2')).toBe(true)
    expect(pplb).toContain('Serial Number: 20-08-01')
  })

  it('strips quotes that would break an EPL2 quoted string', () => {
    const t: LabelTemplate = {
      ...approved(SEED_TEMPLATES.find(s => s.code === 'LOCAL')!),
      certifications: [],
      lines: [{ kind: 'fixed', id: 'a', text: 'He said "hello"' }],
    }
    expect(buildLabelPplb(resolveLabel(t, {}))).toContain("He said 'hello'")
  })

  it('pplbTextLines shows the operator exactly what the printer will set', () => {
    const local = SEED_TEMPLATES.find(s => s.code === 'LOCAL')!
    const lines = pplbTextLines(resolveLabel(approved(local), LONG_BINDING))
    expect(lines[0]).toBe('Product: Rooibos')
    expect(lines).toContain('Product of South Africa')
  })
})

describe('the proof', () => {
  const jas = approved(SEED_TEMPLATES.find(s => s.code === 'JAS')!)

  it('watermarks a proof and does not watermark a print', () => {
    const resolved = resolveLabel(jas, {})
    expect(buildLabelDocument(resolved, { mode: 'proof' })).toContain('Proof — not for production')
    expect(buildLabelDocument(resolved, { mode: 'print' })).not.toContain('watermark')
  })

  it('names the fields still to be filled, so the certifier knows they are placeholders', () => {
    const html = buildLabelDocument(resolveLabel(jas, {}), { mode: 'proof' })
    expect(html).toContain('filled at production time')
    expect(html).toContain('batch_no')
  })

  it('carries the version, so an approval is traceable to one row', () => {
    const html = buildLabelDocument(resolveLabel(jas, {}), { mode: 'proof', issuedTo: 'Control Union' })
    expect(html).toContain('version 1')
    expect(html).toContain('Control Union')
  })

  it('escapes markup in authored wording rather than emitting it', () => {
    const t: LabelTemplate = {
      ...jas,
      lines: [{ kind: 'fixed', id: 'a', text: '<script>alert(1)</script>' }],
    }
    const html = buildLabelDocument(resolveLabel(t, {}), { mode: 'print' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
