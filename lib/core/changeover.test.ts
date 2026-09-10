import { describe, it, expect } from 'vitest'
import {
  planChangeover,
  changeoverLeftoverKg,
  isPastShiftChangeover,
  isEarlyChangeoverLikely,
  type ChangeoverContext,
} from './changeover'

const sup = (over: Partial<ChangeoverContext> = {}): ChangeoverContext => ({
  variant: 'Conventional', totalIn: 500, totalOut: 460, isSupervisor: true, ...over,
})

describe('who may start a changeover', () => {
  it('a supervisor may', () => {
    const p = planChangeover(sup())
    expect(p.allowed).toBe(true)
    expect(p.blockedReason).toBeNull()
  })

  it('an operator may not, and is told to fetch someone rather than left guessing', () => {
    // A control that silently does nothing sends the operator looking for a
    // supervisor anyway — so the reason is returned, not a disabled button.
    const p = planChangeover(sup({ isSupervisor: false }))
    expect(p.allowed).toBe(false)
    expect(p.blockedReason).toMatch(/ask a supervisor/i)
  })

  it('still reports the leftover to an operator who cannot act on it', () => {
    // They can see what is outstanding and tell the supervisor.
    expect(planChangeover(sup({ isSupervisor: false })).leftoverKg).toBe(40)
  })

  it('never offers the carry option to someone who cannot start a changeover', () => {
    const p = planChangeover(sup({ isSupervisor: false }))
    expect(p.mayCarry).toBe(false)
    expect(p.carryFamily).toBeNull()
  })
})

describe('the organic rule', () => {
  it.each(['Organic', 'RA-Organic', 'FT-ORG', 'ORG', 'RA-ORG', 'O', 'RO', 'FO'])(
    'refuses to carry %s', v => {
      const p = planChangeover(sup({ variant: v }))
      expect(p.allowed).toBe(true)          // the changeover itself is fine
      expect(p.mayCarry).toBe(false)        // carrying the material is not
      expect(p.carryRefusal).toBe('organic')
      expect(p.carryFamily).toBeNull()
      expect(p.carryRefusalReason).toMatch(/segregated/i)
    })

  it.each(['Conventional', 'RA-Conventional', 'FT-CON', 'CON', 'C', 'RC', 'FC'])(
    'allows %s', v => {
      const p = planChangeover(sup({ variant: v }))
      expect(p.mayCarry).toBe(true)
      expect(p.carryFamily).toBe('conventional')
      expect(p.carryRefusal).toBeNull()
    })
})

describe('an unknown variant fails closed', () => {
  /**
   * The dangerous case. `!isOrganicVariant(x)` would PERMIT the carry for a
   * variant nobody recognises, which is the one case that most deserves a stop.
   */
  it.each(['Rooibos', 'typo', '', null, undefined])('refuses %s', v => {
    const p = planChangeover(sup({ variant: v as string }))
    expect(p.mayCarry).toBe(false)
    expect(p.carryRefusal).toBe('unknown-variant')
    expect(p.carryFamily).toBeNull()
    expect(p.carryRefusalReason).toMatch(/not recognised/i)
  })

  it('an unknown variant does not block the changeover itself', () => {
    // Switching away from an unrecognised variant is exactly what the operator
    // should be able to do. Only carrying the material is refused.
    expect(planChangeover(sup({ variant: 'Rooibos' })).allowed).toBe(true)
  })
})

describe('the plan is internally consistent, whatever you ask it', () => {
  it('holds across every combination', () => {
    for (const variant of ['Conventional', 'Organic', 'Rooibos', '', 'FT-CON']) {
      for (const isSupervisor of [true, false]) {
        for (const [totalIn, totalOut] of [[500, 460], [500, 500], [100, 400]]) {
          const p = planChangeover({ variant, totalIn, totalOut, isSupervisor })

          // A family is present exactly when the material may move.
          expect(p.carryFamily === null).toBe(!p.mayCarry)

          // Carrying is never offered on a changeover that cannot happen.
          if (!p.allowed) expect(p.mayCarry).toBe(false)

          // Permission and the material are separate axes: carryRefusal
          // explains the MATERIAL, blockedReason explains the ACTOR. Exactly
          // one of them speaks at a time.
          if (p.allowed) {
            expect(p.blockedReason).toBeNull()
            expect(p.carryRefusal === null).toBe(p.mayCarry)
          } else {
            expect(p.blockedReason).not.toBeNull()
            expect(p.carryRefusal).toBeNull()
          }

          // Every refusal that is set can be shown to someone.
          expect(p.carryRefusalReason === null).toBe(p.carryRefusal === null)
        }
      }
    }
  })
})

describe('the leftover figure', () => {
  it('is input minus output, to 0.1 kg', () => {
    expect(changeoverLeftoverKg(500, 460)).toBe(40)
    expect(changeoverLeftoverKg(500.06, 460)).toBe(40.1)
  })

  it('is never negative — an over-producing record has nothing to carry', () => {
    expect(changeoverLeftoverKg(400, 500)).toBe(0)
    expect(planChangeover(sup({ totalIn: 400, totalOut: 500 })).mayCarry).toBe(false)
  })

  it('refuses the carry when the record balances', () => {
    const p = planChangeover(sup({ totalIn: 500, totalOut: 500 }))
    expect(p.leftoverKg).toBe(0)
    expect(p.carryRefusal).toBe('nothing-left')
    expect(p.carryRefusalReason).toMatch(/nothing left/i)
  })

  it('survives rubbish input rather than producing NaN', () => {
    expect(changeoverLeftoverKg(NaN, 0)).toBe(0)
    expect(changeoverLeftoverKg(Infinity, 0)).toBe(0)
    expect(changeoverLeftoverKg(undefined as never, undefined as never)).toBe(0)
  })
})

describe('isPastShiftChangeover — the 16h00 hand-over', () => {
  const D = '2026-09-04'
  const at = (h: number, m = 0) => new Date(2026, 8, 4, h, m)

  it('fires from 16h00 on a morning session, on its own date', () => {
    expect(isPastShiftChangeover('morning', D, at(16))).toBe(true)
    expect(isPastShiftChangeover('morning', D, at(18, 30))).toBe(true)
  })

  it('does not fire before 16h00', () => {
    expect(isPastShiftChangeover('morning', D, at(15, 59))).toBe(false)
  })

  it('never fires on the afternoon shift — it IS the afternoon shift', () => {
    expect(isPastShiftChangeover('afternoon', D, at(18))).toBe(false)
    expect(isPastShiftChangeover('night', D, at(18))).toBe(false)
  })

  it('never fires on a session from another day', () => {
    // Opening yesterday's record at 17h00 must not demand a hand-over.
    expect(isPastShiftChangeover('morning', '2026-09-03', at(17))).toBe(false)
  })
})

describe('isEarlyChangeoverLikely — the submit prompt', () => {
  const D = '2026-09-04'
  const at = (h: number, m = 0) => new Date(2026, 8, 4, h, m)

  it('asks on an early morning submit with two or more production orders', () => {
    expect(isEarlyChangeoverLikely('morning', D, 2, at(11))).toBe(true)
  })

  it('does not nag on a normal end-of-morning submit', () => {
    // 15h30 is the cutoff — submitting near 16h00 is just the shift ending.
    expect(isEarlyChangeoverLikely('morning', D, 3, at(15, 30))).toBe(false)
    expect(isEarlyChangeoverLikely('morning', D, 3, at(15, 45))).toBe(false)
    expect(isEarlyChangeoverLikely('morning', D, 3, at(15, 29))).toBe(true)
  })

  it('does not ask on a single production order', () => {
    expect(isEarlyChangeoverLikely('morning', D, 1, at(11))).toBe(false)
    expect(isEarlyChangeoverLikely('morning', D, 0, at(11))).toBe(false)
  })

  it('does not ask on the afternoon shift or another day', () => {
    expect(isEarlyChangeoverLikely('afternoon', D, 3, at(11))).toBe(false)
    expect(isEarlyChangeoverLikely('morning', '2026-09-03', 3, at(11))).toBe(false)
  })
})
