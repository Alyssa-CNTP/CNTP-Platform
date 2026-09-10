import { n } from '@/lib/core/num'

/**
 * Pasteuriser mass balance (PR-FM-005). Moved verbatim from
 * PasteuriserCapture.tsx.
 *
 * Raw used = D (main stream) + E (post-sieve). Produced = A (bagged output) +
 * B (by-products) + C (floor waste). Output is captured as bag RANGES, so A is
 * count x per-bag weight rather than a sum of individual bag rows.
 */

export interface PasteuriserBalanceData {
  weightPerBag?: string
  floorWaste?: string
  debag?: readonly { stream: string; weight: string }[]
  outputs?: readonly { bagCount: string; bagWeight: string }[]
  byProducts?: readonly { weight: string }[]
}

export function pasteuriserTotals(d: PasteuriserBalanceData) {
  const perBag = n(d.weightPerBag) || 0
  const D = (d.debag ?? []).filter(r => r.stream === 'main').reduce((s, r) => s + n(r.weight), 0)
  const E = (d.debag ?? []).filter(r => r.stream === 'postsieve').reduce((s, r) => s + n(r.weight), 0)
  const A = (d.outputs ?? []).reduce((s, r) => s + n(r.bagCount) * (n(r.bagWeight) || perBag), 0)
  const B = (d.byProducts ?? []).reduce((s, r) => s + n(r.weight), 0)
  const C = n(d.floorWaste)
  const rawUsed = D + E
  const produced = A + B + C
  return { D, E, A, B, C, rawUsed, produced, balance: produced - rawUsed }
}
