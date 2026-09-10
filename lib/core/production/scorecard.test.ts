import { describe, it, expect } from 'vitest'
import { summariseScorecard, type ScorecardRow } from './scorecard'

const row = (
  performance: number | null,
  accuracy: number | null,
  systemAccuracyPct: number | null = null,
): ScorecardRow => ({ performance, accuracy, systemAccuracyPct })

describe('summariseScorecard', () => {
  it('averages the scores a supervisor actually gave', () => {
    const s = summariseScorecard([row(4, 5), row(5, 4), row(3, 3)])
    expect(s.avgPerformance).toBe(4)
    expect(s.avgAccuracy).toBe(4)
    expect(s.ratedShifts).toBe(3)
  })

  it('does not treat an unrated shift as a zero', () => {
    // The whole point. A supervisor who did not get round to rating Tuesday
    // has not said the operator was bad on Tuesday.
    const s = summariseScorecard([row(5, 5), row(null, null)])
    expect(s.avgPerformance).toBe(5)
    expect(s.ratedShifts).toBe(1)
    expect(s.unratedShifts).toBe(1)
  })

  it('averages each score over the shifts that carry it', () => {
    // Performance filled in, accuracy left blank: neither average borrows
    // from the other's denominator.
    const s = summariseScorecard([row(4, null), row(2, 3)])
    expect(s.avgPerformance).toBe(3)
    expect(s.avgAccuracy).toBe(3)
  })

  it('counts a half-filled rating as rated', () => {
    expect(summariseScorecard([row(4, null)]).ratedShifts).toBe(1)
    expect(summariseScorecard([row(null, 4)]).ratedShifts).toBe(1)
  })

  it('does not count a system-only row as rated by a human', () => {
    // Otherwise the card overstates how much of their record anyone has
    // actually looked at.
    const s = summariseScorecard([row(null, null, 82)])
    expect(s.ratedShifts).toBe(0)
    expect(s.unratedShifts).toBe(1)
    expect(s.avgSystemAccuracyPct).toBe(82)
  })

  it('returns nulls rather than NaN or zero when there is nothing yet', () => {
    const s = summariseScorecard([])
    expect(s.avgPerformance).toBeNull()
    expect(s.avgAccuracy).toBeNull()
    expect(s.avgSystemAccuracyPct).toBeNull()
    expect(s.ratedShifts).toBe(0)
    expect(s.unratedShifts).toBe(0)
  })

  it('rounds a score to one decimal and a percentage to a whole number', () => {
    expect(summariseScorecard([row(4, 4), row(5, 5), row(5, 5)]).avgPerformance).toBe(4.7)
    expect(summariseScorecard([row(4, 4, 80), row(4, 4, 85)]).avgSystemAccuracyPct).toBe(83)
  })

  it('ignores a non-finite score instead of poisoning the average', () => {
    const s = summariseScorecard([row(4, 4), row(NaN, Infinity)])
    expect(s.avgPerformance).toBe(4)
    expect(s.avgAccuracy).toBe(4)
  })
})
