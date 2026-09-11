import { describe, it, expect } from 'vitest'
import {
  presenceWindow, presenceMinutes, awayGaps, effectiveEnd, isStale, isOnClock,
  productionDayFor, STALE_AFTER_MS, type ClockInterval,
} from './shift-clock'

describe('productionDayFor', () => {
  // SAST is UTC+2, so subtract two hours to read these as wall-clock SAST.
  const sast = (isoLocal: string) => new Date(`${isoLocal}+02:00`)

  it('puts an 07h05 login on that morning', () => {
    expect(productionDayFor(sast('2026-09-11T07:05:00'))).toEqual(
      { date: '2026-09-11', shift: 'morning' })
  })

  it('puts a 15h59 login on that morning', () => {
    expect(productionDayFor(sast('2026-09-11T15:59:00'))).toEqual(
      { date: '2026-09-11', shift: 'morning' })
  })

  it('puts a 16h00 login on that afternoon', () => {
    expect(productionDayFor(sast('2026-09-11T16:00:00'))).toEqual(
      { date: '2026-09-11', shift: 'afternoon' })
  })

  it('keeps a 00h30 login on the run that started the previous 07h00', () => {
    // The whole reason this function exists: a run is 07h00→01h00, so midnight
    // is mid-shift, not a new day.
    expect(productionDayFor(sast('2026-09-12T00:30:00'))).toEqual(
      { date: '2026-09-11', shift: 'afternoon' })
  })

  it('holds across a month boundary', () => {
    expect(productionDayFor(sast('2026-10-01T00:30:00'))).toEqual(
      { date: '2026-09-30', shift: 'afternoon' })
  })

  it('reads SAST, not the calling machine — the VPS clock is UTC', () => {
    // 05h30 UTC is 07h30 SAST: the morning shift of the 11th. A server reading
    // its own local hours would call this the tail of the 10th's night run and
    // file every early-morning login into the previous day.
    expect(productionDayFor(new Date('2026-09-11T05:30:00.000Z'))).toEqual(
      { date: '2026-09-11', shift: 'morning' })
  })

  it('falls back to now rather than throwing on a bad stamp', () => {
    const slot = productionDayFor('not-a-date')
    expect(slot.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// A fixed "now" so nothing here depends on when the suite runs.
const NOW = Date.parse('2026-09-11T13:00:00.000Z')

// An OPEN interval defaults to a fresh heartbeat, because that is what a tab
// someone is actually sitting in front of looks like. Pass `lastSeenAt`
// explicitly to model one that went quiet.
const JUST_NOW = new Date(NOW - 60_000).toISOString()

function iv(
  openedAt: string,
  closedAt: string | null = null,
  lastSeenAt = closedAt ?? JUST_NOW,
  id = openedAt,
): ClockInterval {
  return { id, openedAt, closedAt, lastSeenAt, closeReason: closedAt ? 'signed_out' : null }
}

describe('presenceWindow', () => {
  it('is empty when the operator never signed in', () => {
    expect(presenceWindow([], NOW)).toEqual({
      startIso: null, endIso: null, onClock: false, sessions: 0,
    })
  })

  it('starts at the login, not at the first thing they touched', () => {
    // The whole point: the shift begins when they signed in.
    const w = presenceWindow([iv('2026-09-11T05:00:00.000Z')], NOW)
    expect(w.startIso).toBe('2026-09-11T05:00:00.000Z')
    expect(w.onClock).toBe(true)
  })

  it('leaves the end null while they are still on the clock', () => {
    // Null must stay distinguishable from a real end — the timesheet shows a
    // running clock for one and a fixed time for the other.
    expect(presenceWindow([iv('2026-09-11T05:00:00.000Z')], NOW).endIso).toBeNull()
  })

  it('ends at the logout', () => {
    const w = presenceWindow(
      [iv('2026-09-11T05:00:00.000Z', '2026-09-11T14:00:00.000Z')],
      NOW,
    )
    expect(w.endIso).toBe('2026-09-11T14:00:00.000Z')
    expect(w.onClock).toBe(false)
  })

  it('keeps the FIRST login as the start when they sign in again', () => {
    // An inactivity sign-out mid-shift must not restart someone's day.
    const w = presenceWindow([
      iv('2026-09-11T05:00:00.000Z', '2026-09-11T09:00:00.000Z'),
      iv('2026-09-11T09:05:00.000Z'),
    ], NOW)
    expect(w.startIso).toBe('2026-09-11T05:00:00.000Z')
    expect(w.onClock).toBe(true)
    expect(w.sessions).toBe(2)
  })

  it('takes the latest end, not the last row', () => {
    // Two devices overlapping at a handover: the earlier-opened interval closes
    // later, and ordering by open time would read the wrong end.
    const w = presenceWindow([
      iv('2026-09-11T05:00:00.000Z', '2026-09-11T14:30:00.000Z', undefined, 'a'),
      iv('2026-09-11T06:00:00.000Z', '2026-09-11T12:00:00.000Z', undefined, 'b'),
    ], NOW)
    expect(w.endIso).toBe('2026-09-11T14:30:00.000Z')
  })

  it('closes an abandoned tab at its last heartbeat, not at now', () => {
    // Battery died at 09h00. Measuring to `now` would pay for four hours nobody
    // was there; measuring to zero would pay for none of the four they were.
    const dead = iv('2026-09-11T05:00:00.000Z', null, '2026-09-11T09:00:00.000Z')
    const w = presenceWindow([dead], NOW)
    expect(w.onClock).toBe(false)
    expect(w.endIso).toBe('2026-09-11T09:00:00.000Z')
  })

  it('ignores rows with an unparseable open stamp', () => {
    const w = presenceWindow([iv('not-a-date'), iv('2026-09-11T05:00:00.000Z')], NOW)
    expect(w.startIso).toBe('2026-09-11T05:00:00.000Z')
    expect(w.sessions).toBe(1)
  })
})

describe('effectiveEnd / isStale', () => {
  it('a heartbeating interval runs to now', () => {
    const live = iv('2026-09-11T05:00:00.000Z', null, '2026-09-11T12:58:00.000Z')
    expect(effectiveEnd(live, NOW)).toBe(NOW)
    expect(isStale(live, NOW)).toBe(false)
    expect(isOnClock(live)).toBe(true)
  })

  it('goes stale only after the grace window, which outlasts the idle sign-out', () => {
    const seen = NOW - STALE_AFTER_MS - 1
    const quiet = iv('2026-09-11T04:00:00.000Z', null, new Date(seen).toISOString())
    expect(isStale(quiet, NOW)).toBe(true)
    expect(effectiveEnd(quiet, NOW)).toBe(seen)
  })

  it('a closed interval is never stale', () => {
    const closed = iv('2026-09-11T05:00:00.000Z', '2026-09-11T06:00:00.000Z')
    expect(isStale(closed, NOW)).toBe(false)
  })
})

describe('presenceMinutes', () => {
  it('sums a single interval', () => {
    expect(presenceMinutes(
      [iv('2026-09-11T05:00:00.000Z', '2026-09-11T14:00:00.000Z')], NOW,
    )).toBe(540)
  })

  it('counts overlapping intervals once', () => {
    // A handover where the outgoing tablet has not signed out yet. Summing
    // would double-count the overlap.
    expect(presenceMinutes([
      iv('2026-09-11T05:00:00.000Z', '2026-09-11T09:00:00.000Z', undefined, 'a'),
      iv('2026-09-11T08:00:00.000Z', '2026-09-11T10:00:00.000Z', undefined, 'b'),
    ], NOW)).toBe(300)
  })

  it('excludes the gap between two sign-ins', () => {
    expect(presenceMinutes([
      iv('2026-09-11T05:00:00.000Z', '2026-09-11T06:00:00.000Z', undefined, 'a'),
      iv('2026-09-11T08:00:00.000Z', '2026-09-11T09:00:00.000Z', undefined, 'b'),
    ], NOW)).toBe(120)
  })
})

describe('awayGaps', () => {
  it('reports a real absence', () => {
    const gaps = awayGaps([
      iv('2026-09-11T05:00:00.000Z', '2026-09-11T06:00:00.000Z', undefined, 'a'),
      iv('2026-09-11T08:00:00.000Z', '2026-09-11T09:00:00.000Z', undefined, 'b'),
    ], 10, NOW)
    expect(gaps).toEqual([{
      fromIso: '2026-09-11T06:00:00.000Z',
      toIso:   '2026-09-11T08:00:00.000Z',
      minutes: 120,
    }])
  })

  it('ignores a reload-sized gap', () => {
    // Two minutes between an inactivity sign-out and signing straight back in
    // is not a break, and surfacing it would bury the ones that are.
    expect(awayGaps([
      iv('2026-09-11T05:00:00.000Z', '2026-09-11T09:00:00.000Z', undefined, 'a'),
      iv('2026-09-11T09:02:00.000Z', '2026-09-11T14:00:00.000Z', undefined, 'b'),
    ], 10, NOW)).toEqual([])
  })

  it('reports no gap when the intervals overlap', () => {
    expect(awayGaps([
      iv('2026-09-11T05:00:00.000Z', '2026-09-11T10:00:00.000Z', undefined, 'a'),
      iv('2026-09-11T08:00:00.000Z', '2026-09-11T09:00:00.000Z', undefined, 'b'),
    ], 10, NOW)).toEqual([])
  })
})
