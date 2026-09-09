import { describe, it, expect } from 'vitest'
import { derivePrompts, panelCards, type PromptInput, type PromptKind } from './prompts'
import type { LineJobCard } from './db'
import type { Stoppage, StoppageKind } from '@/lib/core/timesheet/stoppages'

// 2026-09-08 is a Tuesday — the deep-clean day.
const TUE = '2026-09-08'
const WED = '2026-09-09'
const iso = (hhmm: string, day = TUE) => `${day}T${hhmm}:00.000Z`

function card(over: Partial<LineJobCard> = {}): LineJobCard {
  return {
    id: 1, cardNo: 'JC-001', area: 'Sieving Tower', machine: 'Tower Motor',
    description: 'Feed belt snapped', workflow: 'breakdown', status: 'in_progress',
    raisedAt: iso('09:00'), startedAt: iso('09:05'), completedAt: null,
    raisedBy: 'Gustav', assignedTo: 'Shane',
    ...over,
  }
}

function stoppage(over: Partial<Stoppage> = {}): Stoppage {
  return {
    id: 's1', kind: 'breakdown' as StoppageKind,
    startedAt: iso('09:00'), endedAt: null, notes: 'belt',
    machine: null, area: null, jobCardId: null,
    source: 'operator', voidedAt: null,
    attestation: null, notifiedAt: null,
    ...over,
  }
}

function input(over: Partial<PromptInput> = {}): PromptInput {
  return {
    cards: [], stoppages: [], date: WED, shift: 'morning',
    dismissedCardIds: new Set<number>(),
    dismissedKinds: new Set<PromptKind>(),
    atSignOff: false,
    ...over,
  }
}

describe('derivePrompts — a live maintenance card', () => {
  it('offers to log a stoppage for an open breakdown on this line', () => {
    const p = derivePrompts(input({ cards: [card()] }))
    expect(p).toHaveLength(1)
    expect(p[0].kind).toBe('log_breakdown')
    expect(p[0].urgency).toBe('high')
    expect(p[0].title).toContain('Tower Motor')
    expect(p[0].detail).toContain('JC-001')
    expect(p[0].card?.id).toBe(1)
  })

  it('falls back to the area when the card names no machine', () => {
    const p = derivePrompts(input({ cards: [card({ machine: null })] }))
    expect(p[0].title).toContain('Sieving Tower')
  })

  it('ranks planned maintenance below a breakdown', () => {
    const p = derivePrompts(input({
      cards: [card({ id: 2, workflow: 'planned', description: 'Greasing' }), card({ id: 1 })],
    }))
    expect(p.map(x => x.card?.id)).toEqual([1, 2])
    expect(p[0].urgency).toBe('high')
    expect(p[1].urgency).toBe('normal')
  })

  it('does not offer a card that is already on the sheet', () => {
    const p = derivePrompts(input({
      cards: [card()],
      stoppages: [stoppage({ jobCardId: 1 })],
    }))
    expect(p).toEqual([])
  })

  it('offers the card again if the linked stoppage was voided', () => {
    // The operator removed it by mistake; the machine is still down.
    const p = derivePrompts(input({
      cards: [card()],
      stoppages: [stoppage({ jobCardId: 1, voidedAt: iso('09:30') })],
    }))
    expect(p.map(x => x.kind)).toEqual(['log_breakdown'])
  })

  it('does not offer a closed card', () => {
    for (const status of ['complete', 'cancelled']) {
      expect(derivePrompts(input({ cards: [card({ status })] }))).toEqual([])
    }
  })

  it('stays dismissed once the operator says it is not their line', () => {
    // An area can hold machines that were not stopping this line. Re-asking
    // every poll is how a prompt becomes something operators tap through blind.
    const p = derivePrompts(input({ cards: [card()], dismissedCardIds: new Set([1]) }))
    expect(p).toEqual([])
  })
})

describe('derivePrompts — closing a stoppage when the card is done', () => {
  const done = card({ status: 'complete', completedAt: iso('10:30') })

  it('offers to close an open stoppage at the card completion time', () => {
    const p = derivePrompts(input({
      cards: [done],
      stoppages: [stoppage({ jobCardId: 1 })],
    }))
    expect(p).toHaveLength(1)
    expect(p[0].kind).toBe('close_stoppage')
    expect(p[0].closeAt).toBe(iso('10:30'))
    expect(p[0].stoppageId).toBe('s1')
    expect(p[0].urgency).toBe('high')
  })

  it('says nothing when the stoppage is already closed', () => {
    const p = derivePrompts(input({
      cards: [done],
      stoppages: [stoppage({ jobCardId: 1, endedAt: iso('10:25') })],
    }))
    expect(p).toEqual([])
  })

  it('says nothing while the card is still open', () => {
    const p = derivePrompts(input({
      cards: [card({ status: 'in_progress' })],
      stoppages: [stoppage({ jobCardId: 1 })],
    }))
    expect(p).toEqual([])
  })

  it('does not ask the operator to guess when the card has no completion time', () => {
    // A card marked complete with no timestamp gives nothing to close at.
    const p = derivePrompts(input({
      cards: [card({ status: 'complete', completedAt: null })],
      stoppages: [stoppage({ jobCardId: 1 })],
    }))
    expect(p).toEqual([])
  })

  it('re-keys when maintenance revises the completion time', () => {
    // The key carries completedAt so a revised time reaches the operator
    // instead of being suppressed as "already seen".
    const a = derivePrompts(input({ cards: [done], stoppages: [stoppage({ jobCardId: 1 })] }))
    const b = derivePrompts(input({
      cards: [card({ status: 'complete', completedAt: iso('11:00') })],
      stoppages: [stoppage({ jobCardId: 1 })],
    }))
    expect(a[0].key).not.toBe(b[0].key)
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
    const p = derivePrompts(input({
      date: TUE, shift: 'morning',
      dismissedKinds: new Set<PromptKind>(['log_deep_clean']),
    }))
    expect(p).toEqual([])
  })
})

describe('derivePrompts — still running at sign-off', () => {
  it('is silent about an open stoppage mid-shift', () => {
    const p = derivePrompts(input({ stoppages: [stoppage()], atSignOff: false }))
    expect(p).toEqual([])
  })

  it('flags an open stoppage at sign-off', () => {
    const p = derivePrompts(input({ stoppages: [stoppage()], atSignOff: true }))
    expect(p.map(x => x.kind)).toEqual(['still_open'])
    expect(p[0].stoppageId).toBe('s1')
  })

  it('does not double up with a close_stoppage prompt for the same stoppage', () => {
    const p = derivePrompts(input({
      cards: [card({ status: 'complete', completedAt: iso('10:30') })],
      stoppages: [stoppage({ jobCardId: 1 })],
      atSignOff: true,
    }))
    expect(p.map(x => x.kind)).toEqual(['close_stoppage'])
  })

  it('ignores a voided open stoppage', () => {
    const p = derivePrompts(input({
      stoppages: [stoppage({ voidedAt: iso('10:00') })], atSignOff: true,
    }))
    expect(p).toEqual([])
  })
})

describe('derivePrompts — determinism', () => {
  it('returns identical prompts for identical input, so polling does not flicker', () => {
    const i = input({ cards: [card(), card({ id: 2, workflow: 'planned' })], date: TUE })
    expect(derivePrompts(i)).toEqual(derivePrompts(i))
  })

  it('orders by urgency then key, not by input order', () => {
    const a = derivePrompts(input({
      cards: [card({ id: 7, workflow: 'planned' }), card({ id: 3 })], date: TUE,
    }))
    expect(a[0].urgency).toBe('high')
    expect(a.map(p => p.key)).toEqual([
      'log_breakdown:3', 'log_breakdown:7', 'log_deep_clean',
    ])
  })
})

describe('panelCards', () => {
  it('puts open cards first, then newest first within each group', () => {
    const rows = [
      card({ id: 1, status: 'complete', raisedAt: iso('11:00') }),
      card({ id: 2, status: 'in_progress', raisedAt: iso('08:00') }),
      card({ id: 3, status: 'raised', raisedAt: iso('10:00') }),
      card({ id: 4, status: 'cancelled', raisedAt: iso('07:00') }),
    ]
    expect(panelCards(rows).map(c => c.id)).toEqual([3, 2, 1, 4])
  })

  it('does not mutate its input', () => {
    const rows = [card({ id: 1, status: 'complete' }), card({ id: 2 })]
    panelCards(rows)
    expect(rows.map(c => c.id)).toEqual([1, 2])
  })
})
