import { describe, it, expect } from 'vitest'
import {
  recordAccess, type RecordAccessContext, type RecordSurface,
} from './record-access'

const TODAY = '2026-09-11'

/** An operator, on the capture page, on today's open record. */
const base = (over: Partial<RecordAccessContext> = {}): RecordAccessContext => ({
  surface: 'capture',
  status: 'draft',
  isCurrentRecord: true,
  recordProductionDay: TODAY,
  todayProductionDay: TODAY,
  isSupervisor: false,
  canReopenSignedOff: false,
  ...over,
})

const supervisor = (over: Partial<RecordAccessContext> = {}) =>
  base({ isSupervisor: true, ...over })
const manager = (over: Partial<RecordAccessContext> = {}) =>
  base({ isSupervisor: true, canReopenSignedOff: true, ...over })

// ── Rule 4 ───────────────────────────────────────────────────────────────────

describe('rule 4 — History is read-only, every record, every reader', () => {
  const everyone: [string, Partial<RecordAccessContext>][] = [
    ['an operator', {}],
    ['a supervisor', { isSupervisor: true }],
    ['the production manager', { isSupervisor: true, canReopenSignedOff: true }],
  ]
  const everyState = ['new', 'draft', 'submitted', 'approved']

  for (const [who, caps] of everyone) {
    for (const status of everyState) {
      it(`refuses ${who} on a ${status} record`, () => {
        const a = recordAccess(base({ surface: 'history', status, ...caps }))
        expect(a.canEdit).toBe(false)
        expect(a.readOnly).toBe('history-is-a-record')
      })
    }
  }

  it('still names who could change it, so a reader knows whose door to knock on', () => {
    // The point of a read-only record page: you spot a mistake and you are told
    // what to do about it, not just that you cannot type.
    const a = recordAccess(base({ surface: 'history', status: 'submitted' }))
    expect(a.canEdit).toBe(false)
    expect(a.askWho).toBe('supervisor')
  })

  it('asks the production manager once the record is signed', () => {
    const a = recordAccess(base({ surface: 'history', status: 'approved' }))
    expect(a.askWho).toBe('management')
  })

  it('asks nobody when the reader could simply edit it on the capture page', () => {
    // An operator looking at their own open record in History has nothing to
    // ask for — they walk back to capture and type.
    const a = recordAccess(base({ surface: 'history', status: 'draft' }))
    expect(a.canEdit).toBe(false)
    expect(a.askWho).toBeNull()
  })
})

// ── Rule 1 ───────────────────────────────────────────────────────────────────

describe('rule 1 — an operator gets earlier days read-only', () => {
  it('refuses yesterday even while it is still a draft', () => {
    const a = recordAccess(base({ recordProductionDay: '2026-09-10' }))
    expect(a.canEdit).toBe(false)
    expect(a.readOnly).toBe('earlier-day')
    expect(a.askWho).toBe('supervisor')
  })

  it('says the day before it says anything else — it explains the most', () => {
    const a = recordAccess(base({ recordProductionDay: '2026-09-10', status: 'submitted', isCurrentRecord: false }))
    expect(a.readOnly).toBe('earlier-day')
  })

  it('compares PRODUCTION days, so a 00h30 bag still belongs to its run', () => {
    // The run started 07h00 the previous calendar day and is still today's
    // production day. Nothing here reads a clock; both days are arguments.
    const a = recordAccess(base({ recordProductionDay: TODAY, todayProductionDay: TODAY }))
    expect(a.canEdit).toBe(true)
  })
})

// ── Rule 2 ───────────────────────────────────────────────────────────────────

describe('rule 2 — today, one variant and grade', () => {
  it('lets the operator edit the open record on the capture page', () => {
    const a = recordAccess(base())
    expect(a.canEdit).toBe(true)
    expect(a.readOnly).toBeNull()
    expect(a.readOnlyReason).toBeNull()
  })

  it('and shows them the same record read-only in History', () => {
    expect(recordAccess(base({ surface: 'history' })).canEdit).toBe(false)
  })

  it('a record not yet started is editable — there is nothing to protect', () => {
    expect(recordAccess(base({ status: 'new' })).canEdit).toBe(true)
  })
})

// ── Rule 3 ───────────────────────────────────────────────────────────────────

describe('rule 3 — today, after a changeover', () => {
  it('the operator captures the record they changed over TO', () => {
    expect(recordAccess(base({ isCurrentRecord: true })).canEdit).toBe(true)
  })

  it('the earlier record is read-only to them, and names the supervisor', () => {
    const a = recordAccess(base({ isCurrentRecord: false }))
    expect(a.canEdit).toBe(false)
    expect(a.readOnly).toBe('not-the-open-record')
    expect(a.askWho).toBe('supervisor')
    expect(a.readOnlyReason).toMatch(/changeover/i)
  })

  it('status alone cannot tell the two apart — both are drafts', () => {
    // Which is exactly why isCurrentRecord exists as its own input.
    const open = recordAccess(base({ status: 'draft', isCurrentRecord: true }))
    const closed = recordAccess(base({ status: 'draft', isCurrentRecord: false }))
    expect(open.canEdit).toBe(true)
    expect(closed.canEdit).toBe(false)
  })

  it('the supervisor may change it — until they sign it off', () => {
    expect(recordAccess(supervisor({ isCurrentRecord: false })).canEdit).toBe(true)
    expect(recordAccess(supervisor({ status: 'submitted' })).canEdit).toBe(true)
    expect(recordAccess(supervisor({ status: 'approved' })).canEdit).toBe(false)
  })

  it('once signed, only the relevant higher-ups', () => {
    const sup = recordAccess(supervisor({ status: 'approved' }))
    expect(sup.canEdit).toBe(false)
    expect(sup.readOnly).toBe('signed-off')
    expect(sup.askWho).toBe('management')

    expect(recordAccess(manager({ status: 'approved' })).canEdit).toBe(true)
  })
})

// ── The rule that protects the signature ─────────────────────────────────────

describe('a signature is not editable underneath', () => {
  it('shuts the door on the supervisor who signed it, not just on the operator', () => {
    // Their signature is against this content. Editing beneath it would leave
    // the record saying they approved something they never saw.
    const a = recordAccess(supervisor({ status: 'approved' }))
    expect(a.canEdit).toBe(false)
  })

  it('is checked before the supervisor bypass, whatever else is true', () => {
    for (const isCurrentRecord of [true, false]) {
      for (const day of [TODAY, '2026-01-01']) {
        const a = recordAccess(supervisor({ status: 'approved', isCurrentRecord, recordProductionDay: day }))
        expect(a.readOnly).toBe('signed-off')
      }
    }
  })
})

// ── Consistency ──────────────────────────────────────────────────────────────

describe('the answer is internally consistent, whatever you ask it', () => {
  it('holds across every combination', () => {
    const surfaces: RecordSurface[] = ['history', 'capture']
    for (const surface of surfaces) {
      for (const status of ['new', 'draft', 'submitted', 'approved', '', null]) {
        for (const isCurrentRecord of [true, false]) {
          for (const day of [TODAY, '2026-09-10']) {
            for (const isSupervisor of [true, false]) {
              for (const canReopenSignedOff of [true, false]) {
                const a = recordAccess({
                  surface, status, isCurrentRecord,
                  recordProductionDay: day, todayProductionDay: TODAY,
                  isSupervisor, canReopenSignedOff,
                })

                // A reason is present exactly when the door is shut.
                expect(a.readOnly === null).toBe(a.canEdit)
                expect(a.readOnlyReason === null).toBe(a.canEdit)

                // Nobody is ever told to go and ask about a record they can
                // already change themselves.
                if (a.canEdit) expect(a.askWho).toBeNull()

                // History never lets anyone edit. Rule 4, with no exception.
                if (surface === 'history') expect(a.canEdit).toBe(false)

                // A signed record is only ever opened by the higher-ups.
                if (status === 'approved' && a.canEdit) {
                  expect(canReopenSignedOff).toBe(true)
                  expect(surface).toBe('capture')
                }

                // An operator never edits anything but today's open record.
                if (a.canEdit && !isSupervisor && !canReopenSignedOff) {
                  expect(day).toBe(TODAY)
                  expect(isCurrentRecord).toBe(true)
                  expect(['new', 'draft', '', null]).toContain(status)
                }
              }
            }
          }
        }
      }
    }
  })

  it('treats an unknown status as not-yet-handed-over rather than crashing', () => {
    // A status nobody planned for must not silently unlock a signed record,
    // and must not lock an operator out of a record they are capturing.
    expect(recordAccess(base({ status: 'weird' })).canEdit).toBe(true)
    expect(recordAccess(base({ status: undefined })).canEdit).toBe(true)
  })
})
