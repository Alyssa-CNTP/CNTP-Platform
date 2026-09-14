import { describe, it, expect } from 'vitest'
import {
  buildPostingDocument,
  normalizeLotSerial,
  isSuspectLotSerial,
  outputSignFor,
  postingScopeKey,
  type BuildPostingArgs,
  type PostingBlockerCode,
} from './acumatica-posting'

// ---------------------------------------------------------------------------
// Fixtures
//
// The CONVENTIONAL · EXPORT BLEND order of 11 September 2026 — two records,
// ST-110926-02 (morning) and ST-110926-03 (afternoon), different runs, one
// Acumatica order under S10LGBL-C. Weights are the real ones off production;
// the `clean` variant nudges one output line so the balance sits inside
// tolerance, because the real order does not (see the last describe block).
// ---------------------------------------------------------------------------

const scope = {
  sectionId: 'sieving',
  productionDay: '2026-09-11',
  variant: 'Conventional',
  grade: 'B',
  recordNos: ['ST-110926-02', 'ST-110926-03'],
}

const inputs = [
  { lotNumber: 'GS-0331', kgNett: 3150, isSpillage: false },
  { lotNumber: 'GS-0426', kgNett: 6300, isSpillage: false },
]
const IN_KG = 9450

// Real, except 15IGIS-C nudged 718 → 722 so this fixture balances.
const outputs = [
  { acumaticaId: '10LGBLC-C',  productType: 'Coarse Leaf', kg: 2422 },
  { acumaticaId: '10LGBLF-C',  productType: 'Fine Leaf',   kg: 5205 },
  { acumaticaId: '15IGBL-C-C', productType: 'RB Blocks',   kg: 451 },
  { acumaticaId: '15IGDB-C',   productType: 'Brown Dust',  kg: 600 },
  { acumaticaId: '15IGIS-C',   productType: 'Indent Dust', kg: 722 },
]
const OUT_KG = 9400

const args = (over: Partial<BuildPostingArgs> = {}): BuildPostingArgs => ({
  scope,
  inputs,
  outputs,
  totals: { totalInputKg: IN_KG, totalOutputKg: OUT_KG, toleranceKg: IN_KG * 0.01 },
  orderItem: 'S10LGBL-C',
  operationNbr: '0050',
  ...over,
})

const codes = (d: { blockers: { code: PostingBlockerCode }[] }) => d.blockers.map(b => b.code)

// ---------------------------------------------------------------------------

describe('normalizeLotSerial', () => {
  it('undoes the whitespace the floor types around the hyphen', () => {
    // All five of these are real lot numbers on production.
    expect(normalizeLotSerial('RSGG -05826')).toBe('RSGG-05826')
    expect(normalizeLotSerial('RSGG- 05526')).toBe('RSGG-05526')
    expect(normalizeLotSerial('RSFG- 05726')).toBe('RSFG-05726')
    expect(normalizeLotSerial('RSGG - 05526')).toBe('RSGG-05526')
    expect(normalizeLotSerial('  GS-0426  ')).toBe('GS-0426')
  })

  it('leaves a clean lot exactly as it is', () => {
    expect(normalizeLotSerial('GS-0426')).toBe('GS-0426')
    expect(normalizeLotSerial('26148-CON-RES')).toBe('26148-CON-RES')
  })

  it('does not uppercase or otherwise invent a different lot', () => {
    expect(normalizeLotSerial('gs-0426')).toBe('gs-0426')
  })

  it('treats null and blank as no lot', () => {
    expect(normalizeLotSerial(null)).toBe('')
    expect(normalizeLotSerial('   ')).toBe('')
  })
})

describe('isSuspectLotSerial', () => {
  it('flags the dates operators type into the lot box', () => {
    expect(isSuspectLotSerial('04-09-26/1')).toBe(true)
    expect(isSuspectLotSerial('09-09-26/2')).toBe(true)
  })

  it('accepts a real lot', () => {
    expect(isSuspectLotSerial('GS-0426')).toBe(false)
    expect(isSuspectLotSerial('RSGG-05826')).toBe(false)
  })

  it('flags anything still carrying a space after cleaning', () => {
    expect(isSuspectLotSerial('GS 0426')).toBe(true)
    expect(isSuspectLotSerial('')).toBe(true)
  })
})

describe('outputSignFor', () => {
  it('is negative on every line that consumes to produce', () => {
    for (const s of ['sieving', 'refining1', 'refining2', 'granule', 'pasteuriser']) {
      expect(outputSignFor(s)).toBe(-1)
    }
  })

  it('is positive on the blender, and on the small blender with it', () => {
    expect(outputSignFor('blender')).toBe(1)
    expect(outputSignFor('smallblender')).toBe(1)
  })

  it('returns null for a section it has no rule for, rather than assuming one', () => {
    expect(outputSignFor('packing')).toBeNull()
  })
})

describe('postingScopeKey', () => {
  const base = { sectionId: 'sieving', productionDay: '2026-09-11', variant: 'Conventional', grade: 'B' }

  it('folds two runs with the same variant and grade into one order', () => {
    // ST-110926-02 (morning, run 49e99fcb) and ST-110926-03 (afternoon, run
    // b4c8566a) — different runs, one order. Keying on run_id raises two.
    expect(postingScopeKey(base)).toBe(postingScopeKey({ ...base }))
  })

  it('separates the organic morning from the conventional one', () => {
    expect(postingScopeKey({ ...base, variant: 'Organic', grade: 'A' })).not.toBe(postingScopeKey(base))
  })

  it('separates two grades of the same variant', () => {
    expect(postingScopeKey({ ...base, grade: 'A' })).not.toBe(postingScopeKey(base))
  })

  it('separates the same variant and grade on different days', () => {
    expect(postingScopeKey({ ...base, productionDay: '2026-09-12' })).not.toBe(postingScopeKey(base))
  })

  it('is insensitive to case and stray whitespace', () => {
    expect(postingScopeKey({ ...base, variant: ' conventional ' })).toBe(postingScopeKey(base))
  })
})

describe('buildPostingDocument — a balanced sieving order', () => {
  it('posts clean, with nothing to fix', () => {
    const d = buildPostingDocument(args())
    expect(d.blockers).toEqual([])
    expect(d.postable).toBe(true)
  })

  it('raises the order against the resolved phantom', () => {
    expect(buildPostingDocument(args()).orderItem).toBe('S10LGBL-C')
  })

  it('consolidates the bags to one line per Acumatica item', () => {
    const d = buildPostingDocument(args())
    expect(d.byproductLines).toHaveLength(5)
    expect(d.byproductLines.map(l => l.inventoryId)).toEqual([
      '10LGBLC-C', '10LGBLF-C', '15IGBL-C-C', '15IGDB-C', '15IGIS-C',
    ])
  })

  it('signs sieving output negative', () => {
    const d = buildPostingDocument(args())
    expect(d.byproductLines.find(l => l.inventoryId === '10LGBLF-C')?.quantity).toBe(-5205)
    expect(d.byproductLines.every(l => l.quantity < 0)).toBe(true)
  })

  it('signs blender output positive instead', () => {
    const d = buildPostingDocument(args({ scope: { ...scope, sectionId: 'blender' } }))
    expect(d.byproductLines.every(l => l.quantity > 0)).toBe(true)
  })

  it('issues one line per lot, positive, with the lot attached', () => {
    const d = buildPostingDocument(args())
    expect(d.issueLines).toHaveLength(2)
    expect(d.issueLines.map(l => l.lotSerialNbr)).toEqual(['GS-0331', 'GS-0426'])
    expect(d.issueLines.every(l => l.quantity > 0)).toBe(true)
  })

  it('adds two debags of the same lot into one line', () => {
    const d = buildPostingDocument(args({
      inputs: [
        { lotNumber: 'GS-0426', kgNett: 6300, isSpillage: false },
        { lotNumber: 'GS-0426', kgNett: 3150, isSpillage: false },
      ],
    }))
    expect(d.issueLines).toHaveLength(1)
    expect(d.issueLines[0].quantity).toBe(9450)
  })

  it('folds a whitespace-damaged lot into the clean one rather than splitting it', () => {
    const d = buildPostingDocument(args({
      inputs: [
        { lotNumber: 'RSGG-05826', kgNett: 6300, isSpillage: false },
        { lotNumber: 'RSGG -05826', kgNett: 3150, isSpillage: false },
      ],
    }))
    expect(d.issueLines).toHaveLength(1)
    expect(d.issueLines[0].lotSerialNbr).toBe('RSGG-05826')
    expect(d.issueLines[0].quantity).toBe(9450)
  })

  it('takes QtyToProduce from the debagging on sieving', () => {
    expect(buildPostingDocument(args()).qtyToProduce).toBe(IN_KG)
  })

  it('takes QtyToProduce from the output on every other line', () => {
    for (const s of ['refining1', 'refining2', 'granule', 'blender', 'pasteuriser']) {
      expect(buildPostingDocument(args({ scope: { ...scope, sectionId: s } })).qtyToProduce).toBe(OUT_KG)
    }
  })
})

describe('buildPostingDocument — what stops a post', () => {
  it('refuses when the order item could not be resolved', () => {
    const d = buildPostingDocument(args({ orderItem: null }))
    expect(codes(d)).toContain('no-order-item')
    expect(d.postable).toBe(false)
  })

  it('refuses when no operation number is configured, rather than inventing one', () => {
    expect(codes(buildPostingDocument(args({ operationNbr: null })))).toContain('no-operation-number')
  })

  it('refuses a section it has no sign rule for', () => {
    const d = buildPostingDocument(args({ scope: { ...scope, sectionId: 'packing' } }))
    expect(codes(d)).toContain('unknown-section')
  })

  it('names the bags that carry no Acumatica code', () => {
    const d = buildPostingDocument(args({
      outputs: [...outputs, { acumaticaId: null, productType: 'Fine Leaf', kg: 100 }],
      totals: { totalInputKg: IN_KG, totalOutputKg: OUT_KG + 100, toleranceKg: IN_KG * 0.01 },
    }))
    expect(codes(d)).toContain('missing-item-code')
    expect(d.blockers.find(b => b.code === 'missing-item-code')?.message).toContain('1 bag')
  })

  it('never silently drops a coded bag because an uncoded one was present', () => {
    const d = buildPostingDocument(args({
      outputs: [...outputs, { acumaticaId: null, productType: 'Fine Leaf', kg: 100 }],
      totals: { totalInputKg: IN_KG, totalOutputKg: OUT_KG + 100, toleranceKg: IN_KG * 0.01 },
    }))
    expect(d.byproductLines).toHaveLength(5)
  })

  it('flags a debag row with no lot', () => {
    const d = buildPostingDocument(args({
      inputs: [{ lotNumber: null, kgNett: IN_KG, isSpillage: false }],
    }))
    expect(codes(d)).toContain('lot-missing')
  })

  it('flags a lot that is really a date', () => {
    const d = buildPostingDocument(args({
      inputs: [{ lotNumber: '04-09-26/1', kgNett: IN_KG, isSpillage: false }],
    }))
    expect(codes(d)).toContain('lot-suspect')
  })

  it('catches lines that disagree with the record above them', () => {
    const d = buildPostingDocument(args({
      totals: { totalInputKg: 12950, totalOutputKg: OUT_KG, toleranceKg: 129.5 },
    }))
    expect(codes(d)).toContain('line-total-mismatch')
  })

  it('refuses an order with no output at all', () => {
    const d = buildPostingDocument(args({
      outputs: [],
      totals: { totalInputKg: IN_KG, totalOutputKg: 0, toleranceKg: IN_KG * 0.01 },
    }))
    expect(codes(d)).toContain('no-outputs')
  })

  it('refuses an order with nothing debagged', () => {
    const d = buildPostingDocument(args({
      inputs: [],
      totals: { totalInputKg: 0, totalOutputKg: OUT_KG, toleranceKg: 0 },
    }))
    expect(codes(d)).toContain('no-inputs')
  })
})

describe('buildPostingDocument — spillage', () => {
  it('counts spillage weight as input but issues no lot line for it', () => {
    const d = buildPostingDocument(args({
      inputs: [...inputs, { lotNumber: null, kgNett: 69, isSpillage: true }],
      totals: { totalInputKg: IN_KG + 69, totalOutputKg: OUT_KG, toleranceKg: (IN_KG + 69) * 0.01 },
    }))
    expect(d.issueLines).toHaveLength(2)
    // Its weight still reached the total, so no mismatch is reported.
    expect(codes(d)).not.toContain('line-total-mismatch')
    // And it is not mistaken for a row that forgot its lot.
    expect(codes(d)).not.toContain('lot-missing')
  })
})

// ---------------------------------------------------------------------------
// The real 11 September order, unretouched.
//
// This is the day the scoping rule was written for, so it is worth pinning
// exactly what it does — including the fact that it does NOT post.
// ---------------------------------------------------------------------------

describe('buildPostingDocument — 11 September 2026, as it actually stands', () => {
  const realInputs = [
    { lotNumber: 'GS-0331', kgNett: 3150, isSpillage: false },   // ST-110926-02
    { lotNumber: 'GS-0426', kgNett: 6300, isSpillage: false },   // ST-110926-03
    { lotNumber: null,      kgNett: 37,   isSpillage: true },
    { lotNumber: null,      kgNett: 32,   isSpillage: true },
  ]
  const realOutputs = [
    { acumaticaId: '10LGBLC-C',  productType: 'Coarse Leaf', kg: 2422 },
    { acumaticaId: '10LGBLF-C',  productType: 'Fine Leaf',   kg: 5205 },
    { acumaticaId: '15IGBL-C-C', productType: 'RB Blocks',   kg: 451 },
    { acumaticaId: '15IGDB-C',   productType: 'Brown Dust',  kg: 600 },
    { acumaticaId: '15IGIS-C',   productType: 'Indent Dust', kg: 718 },
  ]
  const realIn = 9519   // 3150 + 6300 + 37 + 32
  const realOut = 9396

  const real = buildPostingDocument({
    scope,
    inputs: realInputs,
    outputs: realOutputs,
    // ±1% of input, computed — NOT production_runs.tolerance_kg, which still
    // carries the retired flat 15 on every row.
    totals: { totalInputKg: realIn, totalOutputKg: realOut, toleranceKg: realIn * 0.01 },
    orderItem: 'S10LGBL-C',
    operationNbr: '0050',
  })

  it('merges the morning and the afternoon into two issue lines and five byproducts', () => {
    expect(real.issueLines.map(l => l.lotSerialNbr)).toEqual(['GS-0331', 'GS-0426'])
    expect(real.byproductLines).toHaveLength(5)
  })

  it('raises 9 450 kg of lots against 9 396 kg of product', () => {
    expect(real.issueLines.reduce((s, l) => s + l.quantity, 0)).toBe(9450)
    expect(real.byproductLines.reduce((s, l) => s + l.quantity, 0)).toBe(-9396)
  })

  it('does NOT post: +123 kg against a ±95.2 kg tolerance', () => {
    expect(codes(real)).toContain('balance-out-of-tolerance')
    expect(real.postable).toBe(false)
  })

  it('is nonetheless far better than either run alone', () => {
    // Split by run, the morning reads +835 kg on 3 187 (26%) and the afternoon
    // −712 kg on 6 332 (−11%) — the bucket elevator carrying between shifts.
    // Folded into one order they very nearly cancel. The posting scope is the
    // only one at which this record's mass balance means anything.
    const morning = buildPostingDocument({
      scope, orderItem: 'S10LGBL-C', operationNbr: '0050',
      inputs: [realInputs[0], realInputs[2]],
      outputs: [
        { acumaticaId: '10LGBLC-C', productType: 'Coarse Leaf', kg: 600 },
        { acumaticaId: '10LGBLF-C', productType: 'Fine Leaf',   kg: 1500 },
        { acumaticaId: '15IGIS-C',  productType: 'Indent Dust', kg: 252 },
      ],
      totals: { totalInputKg: 3187, totalOutputKg: 2352, toleranceKg: 31.87 },
    })
    expect(codes(morning)).toContain('balance-out-of-tolerance')
    expect(Math.abs(3187 - 2352) / 3187).toBeGreaterThan(0.2)   // 26%
    expect(Math.abs(realIn - realOut) / realIn).toBeLessThan(0.02)   // 1.3%
  })
})
