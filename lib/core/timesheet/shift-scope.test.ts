import { describe, it, expect } from 'vitest'
import { anchorSessionId, shiftSessionIds, type ShiftSessionRef } from './shift-scope'

const s = (id: string, createdAt: string | null): ShiftSessionRef => ({ id, createdAt })

// A shift that ran two blends: the first record was opened at 07:02, the
// second when the operator moved onto the next blend at 11:40.
const BLEND_1 = s('aaa', '2026-09-10T05:02:00Z')
const BLEND_2 = s('bbb', '2026-09-10T09:40:00Z')

describe('anchorSessionId', () => {
  it('picks the earliest session, whichever one is open', () => {
    expect(anchorSessionId([BLEND_1, BLEND_2], 'bbb')).toBe('aaa')
    expect(anchorSessionId([BLEND_1, BLEND_2], 'aaa')).toBe('aaa')
  })

  it('does not depend on the order rows come back in', () => {
    expect(anchorSessionId([BLEND_2, BLEND_1], 'bbb')).toBe('aaa')
  })

  it('is unchanged when a third blend is added later', () => {
    const blend3 = s('ccc', '2026-09-10T15:10:00Z')
    expect(anchorSessionId([BLEND_1, BLEND_2, blend3], 'ccc')).toBe('aaa')
  })

  it('falls back to the open session when there is nothing to choose from', () => {
    // The lookup failed, or raced a session created moments ago. Degrading to
    // today's per-session behaviour beats writing against a session id that
    // does not exist -- session_id is NOT NULL with an FK.
    expect(anchorSessionId([], 'bbb')).toBe('bbb')
  })

  it('still anchors when the open session is missing from the list', () => {
    // A stale read must not start a second ledger.
    expect(anchorSessionId([BLEND_1], 'bbb')).toBe('aaa')
  })

  it('never lets an unreadable timestamp win the anchor', () => {
    // A null created_at is not evidence of being earliest. If it could
    // anchor, one bad row would move the whole shift's ledger.
    expect(anchorSessionId([s('zzz', null), BLEND_1], 'zzz')).toBe('aaa')
    expect(anchorSessionId([s('zzz', 'not a date'), BLEND_1], 'zzz')).toBe('aaa')
  })

  it('uses an unreadable timestamp only when it is all there is', () => {
    expect(anchorSessionId([s('zzz', null)], 'zzz')).toBe('zzz')
  })

  it('breaks a tie the same way every time', () => {
    // Two tablets resolving the anchor from identical data must agree, or
    // they split the ledger they were meant to share.
    const same = '2026-09-10T05:02:00Z'
    expect(anchorSessionId([s('bbb', same), s('aaa', same)], 'bbb')).toBe('aaa')
    expect(anchorSessionId([s('aaa', same), s('bbb', same)], 'aaa')).toBe('aaa')
  })

  it('ignores rows with no id rather than anchoring on one', () => {
    expect(anchorSessionId([s('', '2026-09-10T04:00:00Z'), BLEND_1], 'bbb')).toBe('aaa')
  })
})

describe('shiftSessionIds', () => {
  it('returns every session, oldest first', () => {
    expect(shiftSessionIds([BLEND_2, BLEND_1], 'bbb')).toEqual(['aaa', 'bbb'])
  })

  it('includes the open session when the list has not caught up', () => {
    expect(shiftSessionIds([BLEND_1], 'bbb')).toEqual(['aaa', 'bbb'])
  })

  it('does not repeat the open session', () => {
    expect(shiftSessionIds([BLEND_1, BLEND_2], 'bbb')).toEqual(['aaa', 'bbb'])
  })

  it('returns just the open session when the lookup came back empty', () => {
    expect(shiftSessionIds([], 'bbb')).toEqual(['bbb'])
  })

  it('agrees with anchorSessionId about which session is first', () => {
    const rows = [BLEND_2, BLEND_1, s('ccc', '2026-09-10T15:10:00Z')]
    expect(shiftSessionIds(rows, 'ccc')[0]).toBe(anchorSessionId(rows, 'ccc'))
  })
})
