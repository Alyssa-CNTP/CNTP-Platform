import { describe, it, expect } from 'vitest'
import {
  recordSequence, sectionRecords, shiftRecordCards, sectionStatus,
  type ShiftSessionRecord, type ShiftAssignmentRef,
} from './shift-records'

const sess = (over: Partial<ShiftSessionRecord> = {}): ShiftSessionRecord => ({
  id: 'a', sectionId: 'sieving', status: 'draft',
  recordNo: 'ST-040826-01', variant: 'Conventional', lotNumber: null,
  productionOrders: ['S10LGBL-C'], createdAt: '2026-08-04T08:28:00Z',
  ...over,
})

const roster: ShiftAssignmentRef = {
  sectionId: 'sieving', variant: 'Conventional', lotNumber: 'LOT-1',
  productionOrders: ['S10LGBL-C'],
}

describe('recordSequence', () => {
  it('reads the trailing number of a real record number', () => {
    expect(recordSequence('ST-040826-02')).toBe(2)
    expect(recordSequence('BL-230726-01')).toBe(1)
    expect(recordSequence('R1-060726-04')).toBe(4)
  })

  it('anchors at the END, so a hyphenated middle does not mislead it', () => {
    // A Granule-style lot carries its own hyphens; split('-') would take the wrong part.
    expect(recordSequence('GL-RSGG-05626-03')).toBe(3)
  })

  it('is null when there is nothing to read, so the caller falls back to the clock', () => {
    expect(recordSequence(null)).toBeNull()
    expect(recordSequence('')).toBeNull()
    expect(recordSequence('ST-040826-')).toBeNull()
  })
})

describe('sectionRecords', () => {
  it('drops soft-deleted records — a deleted record is not a record', () => {
    const rows = sectionRecords([
      sess({ id: 'a' }),
      sess({ id: 'b', recordNo: 'ST-040826-02', deletedAt: '2026-08-04T10:00:00Z' }),
    ], 'sieving')
    expect(rows.map(r => r.id)).toEqual(['a'])
  })

  it('keeps only the section asked for — lines are independent', () => {
    const rows = sectionRecords([
      sess({ id: 'a' }),
      sess({ id: 'b', sectionId: 'blender' }),
    ], 'sieving')
    expect(rows.map(r => r.id)).toEqual(['a'])
  })

  it('orders by record number, not by the clock, when both have one', () => {
    // -02 was created FIRST here (a backdated correction). The printed number wins.
    const rows = sectionRecords([
      sess({ id: 'b', recordNo: 'ST-040826-02', createdAt: '2026-08-04T07:00:00Z' }),
      sess({ id: 'a', recordNo: 'ST-040826-01', createdAt: '2026-08-04T09:00:00Z' }),
    ], 'sieving')
    expect(rows.map(r => r.recordNo)).toEqual(['ST-040826-01', 'ST-040826-02'])
  })

  it('falls back to created_at when a record has no number', () => {
    const rows = sectionRecords([
      sess({ id: 'b', recordNo: null, createdAt: '2026-08-04T09:00:00Z' }),
      sess({ id: 'a', recordNo: null, createdAt: '2026-08-04T08:00:00Z' }),
    ], 'sieving')
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
  })

  it('sorts an unparseable timestamp LAST, never ahead of a real one', () => {
    const rows = sectionRecords([
      sess({ id: 'bad', recordNo: null, createdAt: 'not a date' }),
      sess({ id: 'good', recordNo: null, createdAt: '2026-08-04T08:00:00Z' }),
    ], 'sieving')
    expect(rows.map(r => r.id)).toEqual(['good', 'bad'])
  })

  it('breaks ties on id, so two tablets cannot disagree about the order', () => {
    const a = sectionRecords([
      sess({ id: 'z', recordNo: null, createdAt: '2026-08-04T08:00:00Z' }),
      sess({ id: 'y', recordNo: null, createdAt: '2026-08-04T08:00:00Z' }),
    ], 'sieving')
    const b = sectionRecords([
      sess({ id: 'y', recordNo: null, createdAt: '2026-08-04T08:00:00Z' }),
      sess({ id: 'z', recordNo: null, createdAt: '2026-08-04T08:00:00Z' }),
    ], 'sieving')
    expect(a.map(r => r.id)).toEqual(b.map(r => r.id))
  })
})

describe('shiftRecordCards', () => {
  it('gives a rostered section one card even with nothing open, so there is something to tap', () => {
    const cards = shiftRecordCards([], roster)
    expect(cards).toHaveLength(1)
    expect(cards[0].sessionId).toBeNull()
    expect(cards[0].status).toBe('none')
    expect(cards[0].variant).toBe('Conventional')
    expect(cards[0].lotNumber).toBe('LOT-1')
  })

  it('gives a changeover TWO cards, each with its own identity', () => {
    // The real blender shift of 2026-07-23: -01 Conventional, -02 Organic.
    const cards = shiftRecordCards([
      sess({ id: 'a', sectionId: 'blender', recordNo: 'BL-230726-01', variant: 'Conventional', status: 'approved' }),
      sess({ id: 'b', sectionId: 'blender', recordNo: 'BL-230726-02', variant: 'Organic', status: 'approved' }),
    ], { ...roster, sectionId: 'blender', variant: 'Conventional' })
    expect(cards).toHaveLength(2)
    expect(cards.map(c => c.variant)).toEqual(['Conventional', 'Organic'])
    expect(cards.map(c => c.ordinal)).toEqual([1, 2])
    expect(cards.every(c => c.total === 2)).toBe(true)
  })

  it("never lets the roster's variant overwrite a record that has its own", () => {
    // This is the defect: the roster said Conventional, the second blend was
    // Organic, and the card showed Conventional.
    const cards = shiftRecordCards(
      [sess({ id: 'b', variant: 'Organic' })],
      { ...roster, variant: 'Conventional' },
    )
    expect(cards[0].variant).toBe('Organic')
  })

  it("falls back to the roster only where the record's own field is blank", () => {
    const cards = shiftRecordCards(
      [sess({ id: 'b', variant: '   ', lotNumber: null, productionOrders: [] })],
      roster,
    )
    expect(cards[0].variant).toBe('Conventional')
    expect(cards[0].lotNumber).toBe('LOT-1')
    expect(cards[0].productionOrders).toEqual(['S10LGBL-C'])
  })

  it('handles the four-record day without complaint', () => {
    const cards = shiftRecordCards(
      [1, 2, 3, 4].map(n => sess({
        id: `r${n}`, sectionId: 'refining1', recordNo: `R1-060726-0${n}`,
      })),
      { ...roster, sectionId: 'refining1' },
    )
    expect(cards.map(c => c.ordinal)).toEqual([1, 2, 3, 4])
    expect(cards.map(c => c.recordNo)).toEqual(
      ['R1-060726-01', 'R1-060726-02', 'R1-060726-03', 'R1-060726-04'])
  })

  it('keys on the session id so React does not reuse a card across records', () => {
    const cards = shiftRecordCards(
      [sess({ id: 'a' }), sess({ id: 'b', recordNo: 'ST-040826-02' })],
      roster,
    )
    expect(new Set(cards.map(c => c.key)).size).toBe(2)
  })
})

describe('sectionStatus', () => {
  it('is finished only when EVERY record is', () => {
    // The old statusMap took whichever row came back last and called it the
    // section's state — this shift was showing "Signed off" half the time.
    const rows = [
      sess({ id: 'a', status: 'approved' }),
      sess({ id: 'b', status: 'draft', recordNo: 'ST-040826-02' }),
    ]
    expect(sectionStatus(rows, 'sieving')).not.toBe('approved')
    expect(sectionStatus([sess({ id: 'a', status: 'approved' })], 'sieving')).toBe('approved')
  })

  it('reports the order-independent answer whichever way the rows arrive', () => {
    const a = sess({ id: 'a', status: 'approved' })
    const b = sess({ id: 'b', status: 'draft', recordNo: 'ST-040826-02' })
    expect(sectionStatus([a, b], 'sieving')).toBe(sectionStatus([b, a], 'sieving'))
  })

  it('surfaces the thing waiting on a PERSON ahead of the thing waiting on the line', () => {
    const rows = [
      sess({ id: 'a', status: 'draft' }),
      sess({ id: 'b', status: 'submitted', recordNo: 'ST-040826-02' }),
    ]
    expect(sectionStatus(rows, 'sieving')).toBe('submitted')
  })

  it('is "none" for a rostered section with nothing open', () => {
    expect(sectionStatus([], 'sieving')).toBe('none')
  })

  it('ignores deleted records when deciding the section is finished', () => {
    const rows = [
      sess({ id: 'a', status: 'approved' }),
      sess({ id: 'b', status: 'draft', deletedAt: '2026-08-04T10:00:00Z' }),
    ]
    expect(sectionStatus(rows, 'sieving')).toBe('approved')
  })
})
