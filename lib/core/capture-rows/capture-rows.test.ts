import { describe, it, expect } from 'vitest'
import { buildDebagRows, buildBagRows, type CaptureProduction, type RowBuildContext } from './index'

/**
 * CHARACTERISATION tests for the row builders (ARCHITECTURE.md §8).
 *
 * These pin what the code does TODAY, right or wrong. They are not a
 * specification and they are not aspirational — they are the rollback detector
 * for the extraction that just happened and for the Phase 7 rewrite of the save
 * path that comes later.
 *
 * If one of these fails, the change under review altered what a capture screen
 * writes to prod_debagging / prod_bagging. That is the signal. Do not relax the
 * test to make it pass; work out what moved.
 *
 * Where the current behaviour looks wrong, it is pinned anyway and the oddity is
 * called out in a comment, so nobody "fixes" it here by accident.
 */

const ctx = (kind: RowBuildContext['kind'], workCentre = 'Sieving Tower'): RowBuildContext => ({
  kind,
  workCentre,
  dustProductType: (key: string) => ({ sgd: 'SG Dust', sfd: 'SF Dust' }[key] ?? key),
})

const prod = (data: unknown, over: Partial<CaptureProduction> = {}): CaptureProduction => ({
  id: 'p1', variant: 'Organic', grade: 'A', lot: 'GS-0299', data: data as never, ...over,
})

// ── Sieving ──────────────────────────────────────────────────────────────────

describe('sieving debagging', () => {
  const data = {
    spillage: [{ id: 's0', kg: '120' }, { id: 's1', kg: '8.5' }],
    debag: [{
      id: 'd1', bag_no: '17', lot: 'GS-0299', gross: '505', nett: '500',
      delivery_date: '2026-09-01', grade: 'Export', logged_at: '2026-09-01T09:30:00Z',
    }],
    outputs: [],
  }

  it('names spillage[0] Bucket Elevator and the rest Machine Spillage', () => {
    // The two are different inputs and must not both read as "Bucket Elevator"
    // on the production order.
    const rows = buildDebagRows([prod(data)], 'sess-1', ctx('sieving'))
    expect(rows.map(r => r.product_type)).toEqual(['Bucket Elevator', 'Machine Spillage', 'Farm Bag'])
    expect(rows.filter(r => r.is_spillage)).toHaveLength(2)
  })

  it('nulls bag_serial_no for farm bags and keeps the physical number in notes', () => {
    // Farm bags are not in bag_tags, and bag_serial_no is a FK to it.
    const farm = buildDebagRows([prod(data)], 'sess-1', ctx('sieving'))[2]
    expect(farm.bag_serial_no).toBeNull()
    expect(farm.notes).toBe('17')
    expect(farm.kg_gross).toBe(505)
    expect(farm.kg_nett).toBe(500)
    expect(farm.bagging_time).toBe('2026-09-01T09:30:00Z')
  })

  it('numbers bags sequentially across spillage and debag together', () => {
    expect(buildDebagRows([prod(data)], 'sess-1', ctx('sieving')).map(r => r.bag_no)).toEqual([1, 2, 3])
  })

  it('drops zero-weight rows entirely', () => {
    const empty = { ...data, spillage: [{ id: 's0', kg: '0' }, { id: 's1', kg: '' }], debag: [] }
    expect(buildDebagRows([prod(empty)], 'sess-1', ctx('sieving'))).toEqual([])
  })

  it('canonicalises the variant on every row', () => {
    const rows = buildDebagRows([prod(data, { variant: 'ORG' })], 'sess-1', ctx('sieving'))
    expect(new Set(rows.map(r => r.variant))).toEqual(new Set(['Organic']))
  })
})

describe('sieving bagging', () => {
  const data = {
    spillage: [], debag: [],
    outputs: [{
      id: 'o1', serial: 'STFL-01092026-001', productType: 'Fine Leaf', code: '10LGEF-O',
      weight: '25', batch: 'GS-0299', destination: 'A', printed: true,
      logged_at: '2026-09-01T10:00:00Z',
    }],
  }

  it('stamps output_group B and the work centre on every output row', () => {
    const [row] = buildBagRows([prod(data)], 'sess-1', ctx('sieving', 'Sieving Tower'))
    expect(row.output_group).toBe('B')
    expect(row.work_centre).toBe('Sieving Tower')
    expect(row.bag_serial_no).toBe('STFL-01092026-001')
    expect(row.kg).toBe(25)
    expect(row.bagging_time).toBe('2026-09-01T10:00:00Z')
  })

  it('prefers the bag batch over the production lot', () => {
    const [row] = buildBagRows([prod(data, { lot: 'OTHER-LOT' })], 'sess-1', ctx('sieving'))
    expect(row.lot_number).toBe('GS-0299')
  })
})

// ── Refining ─────────────────────────────────────────────────────────────────

describe('refining', () => {
  const data = {
    inputs: [
      { id: 'i1', serial: 'STFL-01092026-001', productType: 'Fine Leaf', variant: 'Organic',
        lot: 'GS-0299', weight: '25', inputMode: 'scan', deliveryDate: '2026-09-01' },
      { id: 'i2', serial: 'HANDWRITTEN-9', productType: 'Heavy Sticks', variant: 'Organic',
        lot: '', weight: '10', inputMode: 'manual', deliveryDate: '' },
    ],
    outputA: { bags: [{ id: 'b1', serial: 'R1WD-01092026-001', productType: 'White Dust',
                        code: '15IGDW-O', weight: '12', logged_at: '2026-09-01T11:00:00Z' }] },
    outputB: { bags: [] }, outputC: { bags: [] }, outputD: { bags: [] },
  }

  it('routes a scanned serial to bag_serial_no and a manual one to notes', () => {
    // bag_serial_no is a FK to bag_tags; a manual serial may not exist there, so
    // writing it would fail the whole insert.
    const [scanned, manual] = buildDebagRows([prod(data)], 'sess-1', ctx('refining'))
    expect(scanned.bag_serial_no).toBe('STFL-01092026-001')
    expect(scanned.notes).toBeNull()
    expect(manual.bag_serial_no).toBeNull()
    expect(manual.notes).toBe('HANDWRITTEN-9')
  })

  it('falls back to the production lot when the row has none', () => {
    const [, manual] = buildDebagRows([prod(data)], 'sess-1', ctx('refining'))
    expect(manual.lot_number).toBe('GS-0299')
  })

  it('labels output bags with their group letter', () => {
    const [row] = buildBagRows([prod(data)], 'sess-1', ctx('refining', 'Refining 1'))
    expect(row.output_group).toBe('A')
    expect(row.work_centre).toBe('Refining 1')
    expect(row.acumatica_id).toBe('15IGDW-O')
  })
})

// ── Granule ──────────────────────────────────────────────────────────────────

describe('granule', () => {
  const data = {
    blends: [{ id: 'bl1', blendNo: 2, rows: [
      { id: 'r1', dustKey: 'sgd', serial: 'GLSG-RSGG-05626-01092026-001', variant: 'Organic',
        lot: '', weight: '40', inputMode: 'scan' },
      { id: 'r2', dustKey: 'sfd', serial: 'TYPED-1', variant: 'Organic',
        lot: '', weight: '15', inputMode: 'manual' },
    ] }],
    outputs: [{ id: 'o1', serial: 'GLSG-RSGG-05626-01092026-001', item: 'SG Granules',
                code: '20BGGSG-001-O', weight: '500', lot: 'RSGG-05626',
                logged_at: '2026-09-01T12:00:00Z' }],
    dustOutputs: [{ id: 'd1', serial: 'GLSGD-01092026-001', dustType: 'SG Dust',
                    code: '15IGDSG-O', weight: '30' }],
  }

  it('resolves the dust product type through the injected lookup', () => {
    const rows = buildDebagRows([prod(data)], 'sess-1', ctx('granule'))
    expect(rows.map(r => r.product_type)).toEqual(['SG Dust', 'SF Dust'])
  })

  it('records the blend number in notes, joined with a manual serial', () => {
    const [scanned, manual] = buildDebagRows([prod(data)], 'sess-1', ctx('granule'))
    expect(scanned.notes).toBe('blend 2')
    expect(manual.notes).toBe('blend 2 · TYPED-1')
  })

  it('emits granules and dust as separate output rows, renumbered together', () => {
    const rows = buildBagRows([prod(data)], 'sess-1', ctx('granule', 'Granule Line'))
    expect(rows.map(r => r.product_type)).toEqual(['SG Granules', 'SG Dust'])
    expect(rows.map(r => r.bag_no)).toEqual([1, 2])
    // Pinned oddity: the granule output carries bagging_time, the dust output
    // does not. That asymmetry is in the current code; it is recorded here so a
    // future change to it is deliberate rather than accidental.
    expect(rows[0].bagging_time).toBe('2026-09-01T12:00:00Z')
    expect(rows[1].bagging_time).toBeUndefined()
  })
})

// ── Blender ──────────────────────────────────────────────────────────────────

describe('blender', () => {
  const data = {
    bomId: 'SFCKUN25',
    inputs: [{ id: 'i1', serial: 'STFL-01092026-002', productType: 'Fine Leaf', variant: 'Organic',
               lot: 'GS-0299', weight: '30', inputMode: 'scan', destination: 'A' }],
    outputs: [{ id: 'o1', serial: 'BL-SFCKUN25-01092026-1-001', weight: '200',
                logged_at: '2026-09-01T13:00:00Z' }],
  }

  it('carries the destination into the grade column on inputs', () => {
    const [row] = buildDebagRows([prod(data)], 'sess-1', ctx('blender'))
    expect(row.grade).toBe('A')
  })

  it('names every output after the BOM, not the bag', () => {
    // Blender output has no product-type code of its own — it is identified by
    // blend, which is what the Pasteuriser consumes. See ARCHITECTURE.md §5.
    const [row] = buildBagRows([prod(data)], 'sess-1', ctx('blender', 'Diamond Blender'))
    expect(row.product_type).toBe('Blend SFCKUN25')
    expect(row.acumatica_id).toBe('SFCKUN25')
  })

  it('writes a null product_type when no BOM is chosen', () => {
    const noBom = { ...data, bomId: '' }
    const [row] = buildBagRows([prod(noBom)], 'sess-1', ctx('blender'))
    expect(row.product_type).toBeNull()
    expect(row.acumatica_id).toBeNull()
  })
})

// ── Pasteuriser ──────────────────────────────────────────────────────────────

describe('pasteuriser', () => {
  const data = {
    batchNo: 'PB-0912',
    weightPerBag: '10',
    debag: [
      { id: 'i1', serial: 'BL-SFCKUN25-01092026-1-001', productType: 'Blend SFCKUN25',
        variant: 'Organic', lot: '', weight: '200', inputMode: 'scan', stream: 'main' },
      { id: 'i2', serial: 'GLSG-01092026-001', productType: 'SG Granules', variant: 'Organic',
        lot: '', weight: '50', inputMode: 'scan', stream: 'postsieve' },
    ],
    outputs: [
      { id: 'o1', kind: 'Final Product', item: 'Rooibos Final Product', itemCode: '30FGRB-O',
        bagCount: '12', bagWeight: '', serial: 'PAL-1', lot: '', logged_at: '2026-09-01T14:00:00Z' },
      { id: 'o2', kind: 'High Moisture', item: '', itemCode: null,
        bagCount: '2', bagWeight: '15', serial: 'PAL-2', lot: '', logged_at: null },
    ],
    byProducts: [{ id: 'b1', type: 'Dust Extraction', serial: '', weight: '4' }],
  }

  it('marks the post-sieve stream in notes', () => {
    const rows = buildDebagRows([prod(data)], 'sess-1', ctx('pasteuriser'))
    expect(rows[0].notes).toBeNull()
    expect(rows[1].notes).toBe('post-sieve')
  })

  it('falls back to the batch number for the lot', () => {
    const [row] = buildDebagRows([prod(data)], 'sess-1', ctx('pasteuriser'))
    expect(row.lot_number).toBe('PB-0912')
  })

  it('computes pallet-line kg as bags × per-bag weight, line weight winning', () => {
    const rows = buildBagRows([prod(data)], 'sess-1', ctx('pasteuriser', 'Pasteurizer'))
    expect(rows[0].kg).toBe(120)   // 12 × 10 (falls back to weightPerBag)
    expect(rows[1].kg).toBe(30)    // 2 × 15 (the line's own bagWeight wins)
  })

  it('counts by-products as output rows', () => {
    // pasteuriserTotals sums lines without filtering on kind — dropping these
    // would silently lose rework and refills from the output total (§5).
    const rows = buildBagRows([prod(data)], 'sess-1', ctx('pasteuriser'))
    expect(rows.map(r => r.product_type)).toEqual(['Rooibos Final Product', 'High Moisture', 'Dust Extraction'])
  })

  it('names a line by its item, falling back to its kind', () => {
    const rows = buildBagRows([prod(data)], 'sess-1', ctx('pasteuriser'))
    expect(rows[1].product_type).toBe('High Moisture')
  })
})

// ── Cross-section invariants ─────────────────────────────────────────────────

const ALL: Array<[RowBuildContext['kind'], unknown]> = [
  ['sieving',     { spillage: [], debag: [], outputs: [] }],
  ['refining',    { inputs: [], outputA: { bags: [] }, outputB: { bags: [] }, outputC: { bags: [] }, outputD: { bags: [] } }],
  ['granule',     { blends: [], outputs: [], dustOutputs: [] }],
  ['blender',     { bomId: '', inputs: [], outputs: [] }],
  ['pasteuriser', { batchNo: '', weightPerBag: '', debag: [], outputs: [], byProducts: [] }],
]

describe('every section, same guarantees', () => {
  it.each(ALL)('%s: an empty capture writes no rows at all', (kind, data) => {
    expect(buildDebagRows([prod(data)], 's', ctx(kind))).toEqual([])
    expect(buildBagRows([prod(data)], 's', ctx(kind))).toEqual([])
  })

  it.each(ALL)('%s: no productions at all is not an error', (kind) => {
    expect(buildDebagRows([], 's', ctx(kind))).toEqual([])
    expect(buildBagRows([], 's', ctx(kind))).toEqual([])
  })

  it('throws on an unhandled section kind rather than writing nothing', () => {
    // assertNever. A sixth section that reaches here without a branch must be
    // loud — silently writing zero rows is how a shift's capture disappears.
    expect(() => buildDebagRows([prod({})], 's', ctx('smallblender' as never)))
      .toThrow(/section kind/i)
  })

  it('numbers bags from 1 per call, continuing across productions', () => {
    // bag_no is per-session, not per-production: two batch records in one
    // session must not both start at 1 and collide on
    // prod_debagging_session_bag_uidx (session_id, bag_no).
    const one = { spillage: [{ id: 'a', kg: '10' }], debag: [], outputs: [] }
    const rows = buildDebagRows([prod(one), prod(one, { id: 'p2' })], 's', ctx('sieving'))
    expect(rows.map(r => r.bag_no)).toEqual([1, 2])
  })
})
