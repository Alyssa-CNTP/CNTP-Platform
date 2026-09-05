/**
 * Characterisation tests for the label core.
 *
 * These pin the rules that are expensive to get wrong and invisible when they
 * are: a proof going to Control Union without a CU number, a Japan label
 * without the JAS mark, a placeholder reaching a printer unresolved. A failure
 * here means the behaviour changed, not that the test needs relaxing
 * (ARCHITECTURE.md §8).
 */

import { describe, it, expect } from 'vitest'
import {
  checkCompliance,
  canRequestApproval,
  requiredMarks,
  resolveLabel,
  printBlockers,
  assertPrintable,
  boundFields,
  pendingFields,
  type LabelTemplate,
} from './index'
import {
  pasteuriserLabelSerial,
  pasteuriserLabelStem,
  parsePasteuriserLabelSerial,
  ddmm,
} from '../serials'

// A minimal compliant organic EU template, modelled on the real
// "9. EU Organic Rooibos Label Template".
function euOrganic(over: Partial<LabelTemplate> = {}): LabelTemplate {
  return {
    id: 't1',
    code: 'EU-ORG',
    name: 'EU Organic Rooibos',
    version: 1,
    status: 'draft',
    market: 'eu',
    organic: true,
    size: '100x100',
    markPosition: 'right',
    certifications: [
      { mark: 'control_union', registrationNo: 'ZA-BIO-149', operatorNo: '892408' },
    ],
    lines: [
      { kind: 'fixed', id: 'l1', text: 'Description: Organic Rooibos' },
      { kind: 'field', id: 'l2', caption: 'Grade', field: 'grade' },
      { kind: 'field', id: 'l3', caption: 'Batch Number', field: 'batch_no' },
      { kind: 'field', id: 'l4', caption: 'Serial Number', field: 'serial_no' },
      { kind: 'field', id: 'l5', caption: 'Production Date', field: 'production_date' },
      { kind: 'fixed', id: 'l6', text: 'Net Mass: 18 kg' },
      { kind: 'fixed', id: 'l7', text: 'Certified Organic by Control Union ZA-BIO-149 (CU 892408)' },
      { kind: 'fixed', id: 'l8', text: 'Manufacturer: Cape Natural Tea Products' },
      { kind: 'fixed', id: 'l9', text: '27 Range Road, Blackheath, 7580', indent: true },
      { kind: 'fixed', id: 'l10', text: 'Product of South Africa' },
    ],
    ...over,
  }
}

const FULL_BINDING = {
  grade: 'Choice Grade',
  batch_no: '26166-CON-CH',
  serial_no: '20-08-01',
  production_date: '20-08-2026',
}

describe('compliance — required marks per market', () => {
  it('Japan organic requires BOTH Control Union and the JAS mark', () => {
    expect(requiredMarks('japan', true).sort()).toEqual(['control_union', 'jas'])
  })

  it('Japan non-organic requires no scheme mark — JAS is an organic mark', () => {
    expect(requiredMarks('japan', false)).toEqual([])
  })

  it('local requires nothing, organic or not', () => {
    expect(requiredMarks('local', true)).toEqual([])
    expect(requiredMarks('local', false)).toEqual([])
  })

  it('EU/USA/UK/export organic all require the certifier mark', () => {
    for (const m of ['eu', 'usa', 'uk', 'export'] as const) {
      expect(requiredMarks(m, true)).toEqual(['control_union'])
      expect(requiredMarks(m, false)).toEqual([])
    }
  })
})

describe('compliance — the CU number is data, not prose', () => {
  it('accepts a template carrying both the registration and the operator number', () => {
    expect(canRequestApproval(euOrganic())).toBe(true)
  })

  it('rejects an organic template whose Control Union cert has no operator number', () => {
    const t = euOrganic({ certifications: [{ mark: 'control_union', registrationNo: 'ZA-BIO-149' }] })
    const codes = checkCompliance(t).map(i => i.code)
    expect(codes).toContain('control_union.operator_no')
    expect(canRequestApproval(t)).toBe(false)
  })

  it('rejects an organic template with no registration number', () => {
    const t = euOrganic({ certifications: [{ mark: 'control_union', operatorNo: '892408' }] })
    expect(checkCompliance(t).map(i => i.code)).toContain('control_union.registration_no')
  })

  // The failure this whole check exists for: the words are on the label, so it
  // reads as certified, and there is no number anywhere in the data.
  it('prose alone does not satisfy the organic requirement', () => {
    const t = euOrganic({ certifications: [] })
    expect(checkCompliance(t).map(i => i.code)).toContain('missing_mark.control_union')
    expect(canRequestApproval(t)).toBe(false)
  })
})

describe('compliance — Japan', () => {
  it('blocks a Japan organic template that is missing the JAS mark', () => {
    const t = euOrganic({ code: 'JAS', market: 'japan' })
    expect(checkCompliance(t).map(i => i.code)).toContain('missing_mark.jas')
    expect(canRequestApproval(t)).toBe(false)
  })

  it('passes once the JAS mark is added', () => {
    const t = euOrganic({
      code: 'JAS',
      market: 'japan',
      certifications: [
        { mark: 'control_union', registrationNo: 'ZA-BIO-149', operatorNo: '892408' },
        { mark: 'jas' },
      ],
    })
    expect(canRequestApproval(t)).toBe(true)
  })

  it('refuses the JAS mark on conventional product', () => {
    const t = euOrganic({
      market: 'japan',
      organic: false,
      certifications: [{ mark: 'jas' }],
    })
    expect(checkCompliance(t).map(i => i.code)).toContain('jas.not_organic')
  })
})

describe('compliance — Fairtrade', () => {
  it('requires the FLO ID beside the mark', () => {
    const t = euOrganic({
      certifications: [
        { mark: 'control_union', registrationNo: 'ZA-BIO-149', operatorNo: '892408' },
        { mark: 'fairtrade' },
      ],
    })
    expect(checkCompliance(t).map(i => i.code)).toContain('fairtrade.flo_id')
  })
})

describe('compliance — traceability fields', () => {
  it('every label must bind batch, serial and production date', () => {
    const t = euOrganic({ lines: [{ kind: 'fixed', id: 'x', text: 'Product of South Africa' }] })
    const codes = checkCompliance(t).map(i => i.code)
    expect(codes).toContain('missing_field.batch_no')
    expect(codes).toContain('missing_field.serial_no')
    expect(codes).toContain('missing_field.production_date')
  })
})

describe('resolve', () => {
  it('lists bound fields in first-appearance order, without duplicates', () => {
    expect(boundFields(euOrganic())).toEqual(['grade', 'batch_no', 'serial_no', 'production_date'])
  })

  it('fills placeholders and reports nothing missing when fully bound', () => {
    const r = resolveLabel(euOrganic({ status: 'approved' }), FULL_BINDING)
    expect(r.missing).toEqual([])
    const serialLine = r.lines.find(l => l.kind === 'field' && l.field === 'serial_no')
    expect(serialLine).toMatchObject({ kind: 'field', caption: 'Serial Number', value: '20-08-01' })
  })

  it('reports every unbound field rather than throwing — a draft proof is legitimate', () => {
    const r = resolveLabel(euOrganic())
    expect(r.missing).toEqual(['grade', 'batch_no', 'serial_no', 'production_date'])
  })

  it('treats blank and whitespace-only values as missing, not as filled', () => {
    const r = resolveLabel(euOrganic(), { ...FULL_BINDING, batch_no: '   ' })
    expect(r.missing).toEqual(['batch_no'])
  })

  it('trims bound values', () => {
    const r = resolveLabel(euOrganic(), { ...FULL_BINDING, grade: '  Choice Grade  ' })
    const line = r.lines.find(l => l.kind === 'field' && l.field === 'grade')
    expect(line).toMatchObject({ value: 'Choice Grade' })
  })

  it('carries the physical size through from the template', () => {
    expect(resolveLabel(euOrganic()).size).toEqual({ widthMm: 100, heightMm: 100 })
  })

  it('pendingFields narrows as the binding fills in', () => {
    const t = euOrganic()
    expect(pendingFields(t, { grade: 'A' })).toEqual(['batch_no', 'serial_no', 'production_date'])
    expect(pendingFields(t, FULL_BINDING)).toEqual([])
  })
})

describe('the print boundary', () => {
  it('refuses a label with an unresolved placeholder', () => {
    const r = resolveLabel(euOrganic({ status: 'approved' }), { grade: 'A' })
    expect(printBlockers(r).length).toBeGreaterThan(0)
    expect(() => assertPrintable(r)).toThrow(/not printable/i)
  })

  // The commercial rule: approval is of the TEMPLATE, so an unapproved one
  // cannot reach a bag no matter how complete its data is.
  it('refuses a fully-bound label whose template is not approved', () => {
    const r = resolveLabel(euOrganic({ status: 'draft' }), FULL_BINDING)
    expect(() => assertPrintable(r)).toThrow(/not approved/i)
  })

  it('refuses a superseded template even though it was once approved', () => {
    const r = resolveLabel(euOrganic({ status: 'superseded' }), FULL_BINDING)
    expect(() => assertPrintable(r)).toThrow(/superseded/)
  })

  it('allows an approved, fully-bound label', () => {
    const r = resolveLabel(euOrganic({ status: 'approved' }), FULL_BINDING)
    expect(printBlockers(r)).toEqual([])
    expect(() => assertPrintable(r)).not.toThrow()
  })
})

describe('pasteuriser finished-product serial', () => {
  it('reads as the approved labels print it', () => {
    expect(pasteuriserLabelSerial('2026-08-20', 1)).toBe('20-08-01')
    expect(pasteuriserLabelSerial('2026-08-20', 12)).toBe('20-08-12')
  })

  it('scopes to the job card: the stem is the day, the sequence restarts per card', () => {
    expect(pasteuriserLabelStem('2026-08-20')).toBe('20-08-')
    expect(pasteuriserLabelStem('2026-08-21')).toBe('21-08-')
  })

  it('does not fold a malformed date into a plausible-looking serial', () => {
    expect(ddmm('not a date')).toBe('00-00')
    expect(pasteuriserLabelSerial('', 1)).toBe('00-00-01')
  })

  it('round-trips through the parser', () => {
    expect(parsePasteuriserLabelSerial('20-08-01')).toEqual({ day: '20', month: '08', seq: 1 })
  })

  it('rejects impossible dates rather than half-parsing them', () => {
    expect(parsePasteuriserLabelSerial('32-08-01')).toBeNull()
    expect(parsePasteuriserLabelSerial('20-13-01')).toBeNull()
    expect(parsePasteuriserLabelSerial('nonsense')).toBeNull()
  })

  // ARCHITECTURE.md §5: a serial is used as a URL path segment, so a slash in
  // one splits the route param.
  it('never emits a slash', () => {
    expect(pasteuriserLabelSerial('2026-08-20', 7)).not.toContain('/')
  })
})
