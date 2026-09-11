import { describe, it, expect } from 'vitest'
import {
  sessionsInSameOrder, orderScopeKey, countOrders,
  type OrderScopeSession,
} from './order-scope'

const s = (over: Partial<OrderScopeSession> & { id: string }): OrderScopeSession => ({
  runId: null, sectionId: 'sieving', date: '2026-09-11', variant: 'Conventional', ...over,
})

/**
 * The real 11 September 2026 Sieving day, from production. Three records,
 * three runs — the day whose document merged into one.
 */
const SEPT_11: OrderScopeSession[] = [
  s({ id: 'ST-01', runId: '601c65e2', variant: 'Organic' }),
  s({ id: 'ST-02', runId: '49e99fcb', variant: 'Conventional' }),
  s({ id: 'ST-03', runId: 'b4c8566a', variant: 'Conventional' }),
]

describe('the 11 September day that started this', () => {
  it('gives each record its own order instead of one merged document', () => {
    for (const id of ['ST-01', 'ST-02', 'ST-03']) {
      expect(sessionsInSameOrder(SEPT_11, id).map(x => x.id)).toEqual([id])
    }
  })

  it('counts three orders, not one day', () => {
    expect(countOrders(SEPT_11)).toBe(3)
  })

  it('never shows the Organic run under a Conventional order again', () => {
    const organic = sessionsInSameOrder(SEPT_11, 'ST-01')
    expect(organic).toHaveLength(1)
    expect(organic[0].variant).toBe('Organic')
  })
})

describe('a run that spans shifts stays ONE order', () => {
  // The whole point of production_runs: PO + variant + grade continuing across
  // the 16h00 hand-over.
  const spanning = [
    s({ id: 'am', runId: 'run-A' }),
    s({ id: 'pm', runId: 'run-A' }),
    s({ id: 'other', runId: 'run-B' }),
  ]

  it('keeps the morning and the afternoon together', () => {
    expect(sessionsInSameOrder(spanning, 'am').map(x => x.id).sort()).toEqual(['am', 'pm'])
    expect(sessionsInSameOrder(spanning, 'pm').map(x => x.id).sort()).toEqual(['am', 'pm'])
  })

  it('and leaves the other run out of it', () => {
    expect(sessionsInSameOrder(spanning, 'other').map(x => x.id)).toEqual(['other'])
  })
})

describe('records written before runs existed', () => {
  it('group with other run-less records of the same line, day and variant', () => {
    const legacy = [
      s({ id: 'a' }),
      s({ id: 'b' }),
      s({ id: 'c', variant: 'Organic' }),
    ]
    expect(sessionsInSameOrder(legacy, 'a').map(x => x.id).sort()).toEqual(['a', 'b'])
  })

  it('are NEVER swept into a real run, even on a matching variant', () => {
    // The dangerous case. A coincidental variant match would produce a document
    // claiming a record belongs to an order nothing ever filed it under.
    const mixed = [
      s({ id: 'legacy' }),
      s({ id: 'real', runId: 'run-A' }),
    ]
    expect(sessionsInSameOrder(mixed, 'legacy').map(x => x.id)).toEqual(['legacy'])
    expect(sessionsInSameOrder(mixed, 'real').map(x => x.id)).toEqual(['real'])
  })

  it('do not merge across a changeover either', () => {
    const changeover = [
      s({ id: 'org', variant: 'Organic' }),
      s({ id: 'con', variant: 'Conventional' }),
    ]
    expect(sessionsInSameOrder(changeover, 'org').map(x => x.id)).toEqual(['org'])
  })

  it('do not merge across days or lines', () => {
    const spread = [
      s({ id: 'here' }),
      s({ id: 'tomorrow', date: '2026-09-12' }),
      s({ id: 'blender', sectionId: 'blender' }),
    ]
    expect(sessionsInSameOrder(spread, 'here').map(x => x.id)).toEqual(['here'])
  })

  it('treats a blank variant and a whitespace variant as the same', () => {
    const blanks = [s({ id: 'a', variant: '' }), s({ id: 'b', variant: '   ' })]
    expect(sessionsInSameOrder(blanks, 'a').map(x => x.id).sort()).toEqual(['a', 'b'])
  })

  it('is case-insensitive about the variant, since it is a display string', () => {
    const cased = [s({ id: 'a', variant: 'Organic' }), s({ id: 'b', variant: 'organic' })]
    expect(sessionsInSameOrder(cased, 'a').map(x => x.id).sort()).toEqual(['a', 'b'])
  })
})

describe('deleted records are not records', () => {
  it('drops them from the order', () => {
    const withDeleted = [
      s({ id: 'a', runId: 'run-A' }),
      s({ id: 'gone', runId: 'run-A', deletedAt: '2026-09-11T10:00:00Z' }),
    ]
    expect(sessionsInSameOrder(withDeleted, 'a').map(x => x.id)).toEqual(['a'])
  })

  it('and refuses to open a document for one', () => {
    const withDeleted = [s({ id: 'gone', runId: 'run-A', deletedAt: '2026-09-11T10:00:00Z' })]
    expect(sessionsInSameOrder(withDeleted, 'gone')).toEqual([])
  })

  it('does not count them as an order', () => {
    expect(countOrders([
      s({ id: 'a', runId: 'run-A' }),
      s({ id: 'gone', runId: 'run-B', deletedAt: '2026-09-11T10:00:00Z' }),
    ])).toBe(1)
  })
})

describe('an id that is not in the list', () => {
  it('returns nothing, rather than a document with everything in it', () => {
    // The failure that matters: a caller must not be able to mistake
    // "not found" for "the whole day".
    expect(sessionsInSameOrder(SEPT_11, 'nope')).toEqual([])
  })

  it('is empty-safe', () => {
    expect(sessionsInSameOrder([], 'anything')).toEqual([])
    expect(countOrders([])).toBe(0)
  })
})

describe('orderScopeKey', () => {
  it('is the run where there is one', () => {
    expect(orderScopeKey(s({ id: 'a', runId: 'run-A' }))).toBe('run:run-A')
  })

  it('cannot collide with a run id when there is not', () => {
    const key = orderScopeKey(s({ id: 'a' }))
    expect(key.startsWith('legacy:')).toBe(true)
    expect(key).not.toContain('run:')
  })

  it('agrees with sessionsInSameOrder about what is one order', () => {
    // The two must not drift: grouping a list by key has to produce the same
    // sets as asking record by record.
    const all = [...SEPT_11, s({ id: 'legacy-a' }), s({ id: 'legacy-b' })]
    for (const one of all) {
      const byWalk = new Set(sessionsInSameOrder(all, one.id).map(x => x.id))
      const byKey = new Set(all.filter(x => orderScopeKey(x) === orderScopeKey(one)).map(x => x.id))
      expect(byKey).toEqual(byWalk)
    }
  })
})
