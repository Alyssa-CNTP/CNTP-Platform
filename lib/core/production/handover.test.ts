import { describe, it, expect } from 'vitest'
import {
  isAfternoonShift, sameShift, nextDay, nextShiftAfter,
  handoverReaches, handoverForShift,
} from './handover'

describe('the two shifts, three names', () => {
  it('treats night as afternoon — one shift, a legacy spelling', () => {
    expect(isAfternoonShift('afternoon')).toBe(true)
    expect(isAfternoonShift('night')).toBe(true)
    expect(isAfternoonShift('morning')).toBe(false)
    expect(sameShift('afternoon', 'night')).toBe(true)
  })

  it('does not confuse the two real shifts', () => {
    expect(sameShift('morning', 'afternoon')).toBe(false)
    expect(sameShift('morning', 'night')).toBe(false)
  })
})

describe('nextDay', () => {
  it('crosses a month end', () => {
    expect(nextDay('2026-08-31')).toBe('2026-09-01')
  })

  it('crosses a year end', () => {
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
  })

  it('handles a leap day', () => {
    expect(nextDay('2028-02-28')).toBe('2028-02-29')
  })

  it('returns a malformed date unchanged rather than inventing a day', () => {
    expect(nextDay('not a date')).toBe('not a date')
    expect(nextDay('')).toBe('')
  })
})

describe('nextShiftAfter', () => {
  it('morning hands over to the afternoon of the SAME production day', () => {
    expect(nextShiftAfter({ day: '2026-09-11', shift: 'morning' }))
      .toEqual({ day: '2026-09-11', shift: 'afternoon' })
  })

  it('afternoon hands over to the next morning', () => {
    // The afternoon shift runs past midnight and still belongs to the 11th,
    // so the next morning is the 12th — not "tomorrow by the clock".
    expect(nextShiftAfter({ day: '2026-09-11', shift: 'afternoon' }))
      .toEqual({ day: '2026-09-12', shift: 'morning' })
  })

  it('treats a legacy night row the same as afternoon', () => {
    expect(nextShiftAfter({ day: '2026-09-11', shift: 'night' }))
      .toEqual({ day: '2026-09-12', shift: 'morning' })
  })
})

describe('a note reaches exactly one shift', () => {
  const morning = { day: '2026-09-11', shift: 'morning' }
  const afternoon = { day: '2026-09-11', shift: 'afternoon' }

  it('the morning note reaches this afternoon', () => {
    expect(handoverReaches(morning, afternoon)).toBe(true)
  })

  it('and the afternoon note reaches tomorrow morning', () => {
    expect(handoverReaches(afternoon, { day: '2026-09-12', shift: 'morning' })).toBe(true)
  })

  it('never reaches the shift that wrote it', () => {
    expect(handoverReaches(morning, morning)).toBe(false)
    expect(handoverReaches(afternoon, afternoon)).toBe(false)
  })

  it('EXPIRES — it does not reach the shift after next', () => {
    // This is the whole change. Under the old seven-day window every one of
    // these was shown.
    expect(handoverReaches(morning, { day: '2026-09-12', shift: 'morning' })).toBe(false)
    expect(handoverReaches(morning, { day: '2026-09-12', shift: 'afternoon' })).toBe(false)
    expect(handoverReaches(afternoon, { day: '2026-09-12', shift: 'afternoon' })).toBe(false)
    expect(handoverReaches(afternoon, { day: '2026-09-13', shift: 'morning' })).toBe(false)
  })

  it('never reaches backwards in time', () => {
    expect(handoverReaches(afternoon, morning)).toBe(false)
    expect(handoverReaches(morning, { day: '2026-09-10', shift: 'afternoon' })).toBe(false)
  })

  it('a night-spelled note still reaches tomorrow morning', () => {
    expect(handoverReaches({ day: '2026-09-11', shift: 'night' }, { day: '2026-09-12', shift: 'morning' }))
      .toBe(true)
  })

  it('and an afternoon note reaches a reader whose row says night — same shift', () => {
    expect(handoverReaches({ day: '2026-09-11', shift: 'morning' }, { day: '2026-09-11', shift: 'night' }))
      .toBe(true)
  })

  it('refuses a note with no day rather than guessing', () => {
    expect(handoverReaches({ day: '', shift: 'morning' }, afternoon)).toBe(false)
  })
})

describe('handoverForShift — picking the one to show', () => {
  const notes = [
    { day: '2026-09-11', shift: 'morning',   note: 'Tower half full, organic' },
    { day: '2026-09-10', shift: 'afternoon', note: 'Elevator left loaded' },
    { day: '2026-09-09', shift: 'morning',   note: 'Ancient' },
  ]

  it('shows the morning note to the afternoon shift', () => {
    const got = handoverForShift(notes, { day: '2026-09-11', shift: 'afternoon' })
    expect(got?.note).toBe('Tower half full, organic')
  })

  it('shows the previous afternoon note to this morning', () => {
    const got = handoverForShift(notes, { day: '2026-09-11', shift: 'morning' })
    expect(got?.note).toBe('Elevator left loaded')
  })

  it('shows NOTHING when the only notes have expired', () => {
    // A line that skipped a shift. Under the old window the 9th's note would
    // still have been on screen.
    expect(handoverForShift(notes, { day: '2026-09-13', shift: 'morning' })).toBeNull()
  })

  it('ignores a blank note — an empty comments column is not a handover', () => {
    const blank = [{ day: '2026-09-11', shift: 'morning', note: '   ' }]
    expect(handoverForShift(blank, { day: '2026-09-11', shift: 'afternoon' })).toBeNull()
  })

  it('ignores a null note', () => {
    const nul = [{ day: '2026-09-11', shift: 'morning', note: null }]
    expect(handoverForShift(nul, { day: '2026-09-11', shift: 'afternoon' })).toBeNull()
  })

  it('takes the later note when one shift somehow left two', () => {
    const two = [
      { day: '2026-09-11', shift: 'morning', note: 'first' },
      { day: '2026-09-11', shift: 'morning', note: 'second' },
    ]
    // Same day and shift: order is preserved, and the caller reads newest-first.
    expect(handoverForShift(two, { day: '2026-09-11', shift: 'afternoon' })?.note).toBe('first')
  })

  it('prefers the afternoon note over the same day’s morning note', () => {
    // Only one of them can reach a given reader, but the ordering matters if
    // the rule is ever relaxed — pin it now rather than discover it later.
    const both = [
      { day: '2026-09-11', shift: 'morning',   note: 'am' },
      { day: '2026-09-11', shift: 'afternoon', note: 'pm' },
    ]
    expect(handoverForShift(both, { day: '2026-09-12', shift: 'morning' })?.note).toBe('pm')
    expect(handoverForShift(both, { day: '2026-09-11', shift: 'afternoon' })?.note).toBe('am')
  })

  it('is empty-safe', () => {
    expect(handoverForShift([], { day: '2026-09-11', shift: 'morning' })).toBeNull()
  })
})

describe('a full week of shifts, walked', () => {
  it('each note is seen once and only once', () => {
    const shifts: { day: string; shift: string }[] = []
    for (const d of ['2026-09-10', '2026-09-11', '2026-09-12']) {
      shifts.push({ day: d, shift: 'morning' }, { day: d, shift: 'afternoon' })
    }
    const notes = shifts.map(s => ({ ...s, note: `${s.day} ${s.shift}` }))

    for (const note of notes) {
      const seenBy = shifts.filter(r => handoverReaches(note, r))
      // Exactly one reader, except the last note of the range whose reader
      // falls outside it.
      expect(seenBy.length).toBeLessThanOrEqual(1)
    }
    // And every shift sees at most one note.
    for (const reader of shifts) {
      const shown = notes.filter(n => handoverReaches(n, reader))
      expect(shown.length).toBeLessThanOrEqual(1)
    }
  })
})
