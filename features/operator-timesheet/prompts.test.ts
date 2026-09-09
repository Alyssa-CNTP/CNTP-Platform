import { describe, it, expect } from 'vitest'
import { derivePrompts, type PromptInput, type PromptKind } from './prompts'
import type { Stoppage, StoppageKind } from '@/lib/core/timesheet/stoppages'

// 2026-09-08 is a Tuesday — the deep-clean day.
const TUE = '2026-09-08'
const WED = '2026-09-09'
const iso = (hhmm: string, day = TUE) => `${day}T${hhmm}:00.000Z`

function stoppage(over: Partial<Stoppage> = {}): Stoppage {
  return {
    id: 's1', kind: 'breakdown' as StoppageKind,
    startedAt: iso('09:00'), endedAt: null, notes: 'belt snapped',
    machine: null, area: 'Sieving Tower', jobCardId: null,
    source: 'operator', voidedAt: null,
    attestation: null, notifiedAt: null,
    supervisorRequestedAt: null, supervisorRequestCount: 0,
    ...over,
  }
}

const signed = {
  verdict: 'confirmed' as const, supervisorName: 'Gustav',
  employeeId: 'E-42', signedAt: iso('11:00'), note: null,
}

function input(over: Partial<PromptInput> = {}): PromptInput {
  return {
    stoppages: [], date: WED, shift: 'morning',
    dismissedKinds: new Set<PromptKind>(),
    atSignOff: false,
    ...over,
  }
}

describe('derivePrompts — the supervisor confirmation', () => {
  it('asks the operator to get a breakdown signed', () => {
    const p = derivePrompts(input({ stoppages: [stoppage()] }))
    expect(p).toHaveLength(1)
    expect(p[0].kind).toBe('confirm_with_supervisor')
    expect(p[0].urgency).toBe('high')
    expect(p[0].stoppageId).toBe('s1')
  })

  it('says maintenance has been told once the notification went out', () => {
    const unsent = derivePrompts(input({ stoppages: [stoppage()] }))
    expect(unsent[0].detail).toMatch(/being told/i)
    const sent = derivePrompts(input({ stoppages: [stoppage({ notifiedAt: iso('09:01') })] }))
    expect(sent[0].detail).toMatch(/has been told/i)
  })

  it('stops asking once a supervisor has signed either way', () => {
    for (const verdict of ['confirmed', 'disputed'] as const) {
      const p = derivePrompts(input({
        stoppages: [stoppage({ attestation: { ...signed, verdict } })],
      }))
      expect(p, verdict).toEqual([])
    }
  })

  it('is NOT dismissable — it is the state of the sheet, not a suggestion', () => {
    // There is no dismissed key for it, so passing every kind changes nothing.
    const p = derivePrompts(input({
      stoppages: [stoppage()],
      dismissedKinds: new Set<PromptKind>(['confirm_with_supervisor', 'log_deep_clean', 'still_open']),
    }))
    expect(p.map(x => x.kind)).toEqual(['confirm_with_supervisor'])
  })

  it('stops asking for a voided breakdown', () => {
    const p = derivePrompts(input({ stoppages: [stoppage({ voidedAt: iso('09:30') })] }))
    expect(p).toEqual([])
  })

  it('asks for a breakdown that is still running, not only a closed one', () => {
    // A supervisor can confirm the line is down before it comes back up.
    expect(derivePrompts(input({ stoppages: [stoppage({ endedAt: null })] }))).toHaveLength(1)
    expect(derivePrompts(input({ stoppages: [stoppage({ endedAt: iso('10:00') })] }))).toHaveLength(1)
  })

  it('asks for no other kind', () => {
    // Only breakdown is attested. Asking for a supervisor on a tea break would
    // make the signature a reflex.
    for (const kind of ['tea', 'lunch', 'deep_clean', 'maintenance', 'power',
                        'it_system', 'no_material', 'quality_hold', 'other'] as StoppageKind[]) {
      const p = derivePrompts(input({ stoppages: [stoppage({ kind })] }))
      expect(p.filter(x => x.kind === 'confirm_with_supervisor'), kind).toEqual([])
    }
  })

  it('asks once per unsigned breakdown', () => {
    const p = derivePrompts(input({
      stoppages: [stoppage({ id: 'a' }), stoppage({ id: 'b', startedAt: iso('11:00') })],
    }))
    expect(p.map(x => x.stoppageId)).toEqual(['a', 'b'])
  })
})

describe('derivePrompts — the Tuesday deep clean', () => {
  it('prompts on a Tuesday morning', () => {
    const p = derivePrompts(input({ date: TUE, shift: 'morning' }))
    expect(p.map(x => x.kind)).toEqual(['log_deep_clean'])
  })

  it('does not prompt on a Tuesday afternoon or another morning', () => {
    expect(derivePrompts(input({ date: TUE, shift: 'afternoon' }))).toEqual([])
    expect(derivePrompts(input({ date: WED, shift: 'morning' }))).toEqual([])
  })

  it('stops prompting once a deep clean is on the sheet', () => {
    const p = derivePrompts(input({
      date: TUE, shift: 'morning',
      stoppages: [stoppage({ kind: 'deep_clean', notes: null })],
    }))
    expect(p).toEqual([])
  })

  it('prompts again if the deep clean was voided', () => {
    const p = derivePrompts(input({
      date: TUE, shift: 'morning',
      stoppages: [stoppage({ kind: 'deep_clean', voidedAt: iso('08:00') })],
    }))
    expect(p.map(x => x.kind)).toEqual(['log_deep_clean'])
  })

  it('stays dismissed when the operator says there was no deep clean', () => {
    // A week where the clean happened on Wednesday must not nag all shift, and
    // must never block the submission.
    const p = derivePrompts(input({
      date: TUE, shift: 'morning',
      dismissedKinds: new Set<PromptKind>(['log_deep_clean']),
    }))
    expect(p).toEqual([])
  })
})

describe('derivePrompts — still running at sign-off', () => {
  it('is silent about an open stoppage mid-shift', () => {
    const p = derivePrompts(input({ stoppages: [stoppage({ kind: 'lunch' })], atSignOff: false }))
    expect(p).toEqual([])
  })

  it('flags an open stoppage at sign-off, naming the kind', () => {
    const p = derivePrompts(input({ stoppages: [stoppage({ kind: 'it_system' })], atSignOff: true }))
    expect(p.map(x => x.kind)).toEqual(['still_open'])
    expect(p[0].title).toContain('System / IT down')
    expect(p[0].stoppageId).toBe('s1')
  })

  it('says nothing about a closed stoppage', () => {
    const p = derivePrompts(input({
      stoppages: [stoppage({ kind: 'lunch', endedAt: iso('13:30') })], atSignOff: true,
    }))
    expect(p).toEqual([])
  })

  it('ignores a voided open stoppage', () => {
    const p = derivePrompts(input({
      stoppages: [stoppage({ kind: 'lunch', voidedAt: iso('10:00') })], atSignOff: true,
    }))
    expect(p).toEqual([])
  })

  it('sits alongside the confirmation prompt for the same breakdown', () => {
    // Two different asks: sign it, and close it. Both are true.
    const p = derivePrompts(input({ stoppages: [stoppage()], atSignOff: true }))
    expect(p.map(x => x.kind)).toEqual(['confirm_with_supervisor', 'still_open'])
  })
})

describe('derivePrompts — determinism and order', () => {
  it('returns identical prompts for identical input, so nothing flickers', () => {
    const i = input({ stoppages: [stoppage()], date: TUE, atSignOff: true })
    expect(derivePrompts(i)).toEqual(derivePrompts(i))
  })

  it('puts the high-urgency ask first regardless of input order', () => {
    const p = derivePrompts(input({
      date: TUE, shift: 'morning',
      stoppages: [stoppage({ kind: 'lunch', id: 'z' }), stoppage({ id: 'a' })],
      atSignOff: true,
    }))
    expect(p[0].urgency).toBe('high')
    expect(p[0].kind).toBe('confirm_with_supervisor')
  })

  it('reads nothing from the maintenance schema', () => {
    // Guard against the polling design coming back: the input carries stoppages
    // and the date only. If a `cards` field reappears here, so has the latency
    // and the backwards direction it brought with it.
    const keys = Object.keys(input()).sort()
    expect(keys).toEqual(['atSignOff', 'date', 'dismissedKinds', 'shift', 'stoppages'])
  })
})
