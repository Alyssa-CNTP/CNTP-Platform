import { describe, it, expect } from 'vitest'
import {
  coaGaps, canGenerateCoa, coaHeaderFieldLocked, coaContentLocked,
  canDeleteGeneratedCoa, canWithdrawCoaSignoff, COA_SECTION_ORDER, COA_POST_SIGNOFF_EDITABLE,
  wantsGlyphosateSection, glyphosateAdvisory,
} from './coa-gating'

const ALL_FOUND = {
  pasteuriser: true, micro: true, sieving: true, residue: true, pa: true,
  heavyMetals: true, moshMoah: true, chloratePerchlorate: true, glyphosate: true,
}
const ALL_ON = Object.fromEntries(COA_SECTION_ORDER.map(k => [k, true]))

describe('coaGaps', () => {
  it('is empty when every included analysis has a result', () => {
    expect(coaGaps(ALL_ON, ALL_FOUND)).toEqual([])
    expect(canGenerateCoa(ALL_ON, ALL_FOUND)).toBe(true)
  })

  it('reports an included analysis with no result', () => {
    const gaps = coaGaps({ micro: true }, { ...ALL_FOUND, micro: false })
    expect(gaps).toHaveLength(1)
    expect(gaps[0].label).toBe('Microbiology results')
    expect(gaps[0].section).toBe('micro')
    expect(gaps[0].href).toBe('/quality/lab-results')
  })

  it('does NOT report an analysis that is switched off — dropping it is the other way out', () => {
    expect(coaGaps({ micro: false }, { ...ALL_FOUND, micro: false })).toEqual([])
    expect(canGenerateCoa({ micro: false }, { ...ALL_FOUND, micro: false })).toBe(true)
  })

  it('blocks on a missing pasteuriser batch even with every section off', () => {
    const gaps = coaGaps({}, { pasteuriser: false })
    expect(gaps).toHaveLength(1)
    expect(gaps[0].section).toBeNull()          // cannot be dropped
    expect(gaps[0].where).toBe('Pasteuriser')
    expect(canGenerateCoa({}, { pasteuriser: false })).toBe(false)
  })

  it('puts the batch gap first, then the rest in COA order', () => {
    const gaps = coaGaps({ glyphosate: true, micro: true, residue: true }, {})
    expect(gaps.map(g => g.section)).toEqual([null, 'micro', 'residue', 'glyphosate'])
  })

  it('satisfies cutLength from found.sieving, not found.cutLength', () => {
    // The section prints "Cut Length" but the data lives under sieving. A
    // hand-written chain got this pairing wrong easily; the table cannot.
    expect(coaGaps({ cutLength: true }, { pasteuriser: true, sieving: true })).toEqual([])
    const gaps = coaGaps({ cutLength: true }, { pasteuriser: true, sieving: false })
    expect(gaps.map(g => g.section)).toEqual(['cutLength'])
    expect(gaps[0].href).toBe('/quality/pasteuriser')
  })

  it('every section declares where its result is captured', () => {
    // Guards against adding a section to the COA without a capture route: the
    // blocking message would otherwise send the QC nowhere.
    const gaps = coaGaps(ALL_ON, { pasteuriser: true })
    expect(gaps).toHaveLength(COA_SECTION_ORDER.length)
    gaps.forEach(g => {
      expect(g.href).toMatch(/^\/quality\//)
      expect(g.where.length).toBeGreaterThan(0)
      expect(g.label.length).toBeGreaterThan(0)
    })
  })

  it('reports several gaps at once', () => {
    const gaps = coaGaps(ALL_ON, { ...ALL_FOUND, micro: false, pa: false, glyphosate: false })
    expect(gaps.map(g => g.section)).toEqual(['micro', 'pa', 'glyphosate'])
  })

  it('treats missing sections and missing found as all-absent, not all-present', () => {
    // A null model must not read as "nothing outstanding" and let a blank COA
    // through.
    expect(canGenerateCoa(null, null)).toBe(false)
    expect(coaGaps(undefined, undefined).map(g => g.section)).toEqual([null])
  })
})

describe('coaHeaderFieldLocked', () => {
  it('locks nothing until BOTH managers have signed', () => {
    for (const [lab, qa] of [[false, false], [true, false], [false, true]] as const) {
      expect(coaHeaderFieldLocked('grade', lab, qa)).toBe(false)
      expect(coaHeaderFieldLocked('destination', lab, qa)).toBe(false)
    }
  })

  it('keeps the commercial fields editable after both signatures', () => {
    for (const k of ['date_of_issue', 'invoice_no', 'order_number', 'quantity_kg', 'quantity_bags']) {
      expect(coaHeaderFieldLocked(k, true, true)).toBe(false)
    }
  })

  it('locks the analytical and identifying fields after both signatures', () => {
    for (const k of ['grade', 'batch_number', 'production_date', 'best_before']) {
      expect(coaHeaderFieldLocked(k, true, true)).toBe(true)
    }
  })

  it('locks destination — it selects the customer spec the results were judged against', () => {
    expect(coaHeaderFieldLocked('destination', true, true)).toBe(true)
    expect(COA_POST_SIGNOFF_EDITABLE).not.toContain('destination')
  })

  it('locks an unknown field rather than defaulting it open', () => {
    expect(coaHeaderFieldLocked('some_future_field', true, true)).toBe(true)
  })
})

describe('coaContentLocked', () => {
  it('is true only once both have signed', () => {
    expect(coaContentLocked(false, false)).toBe(false)
    expect(coaContentLocked(true, false)).toBe(false)
    expect(coaContentLocked(false, true)).toBe(false)
    expect(coaContentLocked(true, true)).toBe(true)
  })
})

describe('canDeleteGeneratedCoa', () => {
  it('allows the lab manager and the quality manager', () => {
    expect(canDeleteGeneratedCoa({ isLab: true })).toBe(true)
    expect(canDeleteGeneratedCoa({ isQa: true })).toBe(true)
    expect(canDeleteGeneratedCoa({ isLab: true, isQa: true })).toBe(true)
  })
  it('allows nobody else — a QC cannot delete a generated COA', () => {
    expect(canDeleteGeneratedCoa({ isLab: false, isQa: false })).toBe(false)
    expect(canDeleteGeneratedCoa({})).toBe(false)
    expect(canDeleteGeneratedCoa(null)).toBe(false)
    expect(canDeleteGeneratedCoa(undefined)).toBe(false)
  })
})


describe('canWithdrawCoaSignoff', () => {
  it('allows the two managers whose signatures are on the document', () => {
    expect(canWithdrawCoaSignoff({ isLab: true })).toBe(true)
    expect(canWithdrawCoaSignoff({ isQa: true })).toBe(true)
  })
  it('allows nobody else — a QC cannot unpick a manager signature', () => {
    expect(canWithdrawCoaSignoff({ isLab: false, isQa: false })).toBe(false)
    expect(canWithdrawCoaSignoff(null)).toBe(false)
    expect(canWithdrawCoaSignoff(undefined)).toBe(false)
  })
})

describe('wantsGlyphosateSection', () => {
  // The production defect: Kunitaro IPS-KUN-006 is RA-Organic and asks for no
  // glyphosate. The old rule force-ticked it on every organic batch, no result
  // existed to satisfy it, and the signed COA could not be printed or unticked.
  it('does NOT tick glyphosate on an organic batch whose matched spec is silent', () => {
    expect(wantsGlyphosateSection({ specMatched: true, specValue: null, isOrganic: true })).toBe(false)
    expect(wantsGlyphosateSection({ specMatched: true, specValue: '', isOrganic: true })).toBe(false)
    expect(wantsGlyphosateSection({ specMatched: true, specValue: '   ', isOrganic: true })).toBe(false)
  })
  it("treats an explicit 'NOT REQUIRED' as the buyer declining it, organic or not", () => {
    expect(wantsGlyphosateSection({ specMatched: true, specValue: 'NOT REQUIRED', isOrganic: true })).toBe(false)
    expect(wantsGlyphosateSection({ specMatched: true, specValue: 'not required', isOrganic: false })).toBe(false)
  })
  it('ticks it when the matched spec asks for it', () => {
    expect(wantsGlyphosateSection({ specMatched: true, specValue: 'None Detected', isOrganic: false })).toBe(true)
    expect(wantsGlyphosateSection({ specMatched: true, specValue: '<0,01 mg/kg', isOrganic: true })).toBe(true)
  })
  it('keeps the organic default only where there is no spec to consult', () => {
    expect(wantsGlyphosateSection({ specMatched: false, isOrganic: true })).toBe(true)
    expect(wantsGlyphosateSection({ specMatched: false, isOrganic: false, foundResult: true })).toBe(true)
    expect(wantsGlyphosateSection({ specMatched: false, isOrganic: false, foundResult: false })).toBe(false)
  })
  it('does not let a stray lab result add a row the buyer never asked for', () => {
    // An analysis the lab happened to run does not belong on the buyer's
    // certificate. It can still be ticked by hand.
    expect(wantsGlyphosateSection({ specMatched: true, specValue: null, foundResult: true })).toBe(false)
  })
  it('never blocks: a spec that asks for it plus a result is generatable', () => {
    const on = wantsGlyphosateSection({ specMatched: true, specValue: 'None Detected' })
    expect(canGenerateCoa({ ...ALL_ON, glyphosate: on } as never, ALL_FOUND)).toBe(true)
  })
})

describe('glyphosateAdvisory', () => {
  it('flags an organic batch whose spec is silent, so the omission is visible', () => {
    expect(glyphosateAdvisory({ specMatched: true, specValue: null, isOrganic: true, sectionOn: false })).toBe(true)
  })
  it('stays quiet once the section is ticked by hand', () => {
    expect(glyphosateAdvisory({ specMatched: true, specValue: null, isOrganic: true, sectionOn: true })).toBe(false)
  })
  it('stays quiet on conventional batches and where the spec does ask for it', () => {
    expect(glyphosateAdvisory({ specMatched: true, specValue: null, isOrganic: false })).toBe(false)
    expect(glyphosateAdvisory({ specMatched: true, specValue: 'None Detected', isOrganic: true })).toBe(false)
  })
  it('stays quiet when no spec matched — the organic default already ticks it', () => {
    expect(glyphosateAdvisory({ specMatched: false, isOrganic: true })).toBe(false)
  })
})
