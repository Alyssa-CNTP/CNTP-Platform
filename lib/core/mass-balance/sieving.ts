import { n } from '@/lib/core/num'
import type { BalanceContext, Shift } from './types'

/**
 * Sieving Tower mass balance.
 *
 * Moved from SievingCapture.tsx. The arithmetic of `balance` is unchanged; what
 * changed is that material left in the bucket elevator is now reported as
 * carry-over rather than being folded into Total Output.
 *
 * The bucket elevator (spillage[0]) means OPPOSITE things on the two shifts:
 * the morning shift CONSUMES what last night's afternoon shift left behind (an
 * input), and the afternoon shift LEAVES a new figure for tomorrow (work in
 * progress, not product). Two different physical quantities a day apart — never
 * one number to sum.
 */

/** Only the fields the balance needs. SievingData satisfies this structurally. */
export interface SievingBalanceData {
  spillage?: readonly { kg: string }[]
  debag?: readonly { nett: string }[]
  outputs?: readonly { weight: string }[]
}

export interface SievingTotals {
  totalIn: number
  totalOut: number
  carryOverIn: number
  carryOverOut: number
  balance: number
  /** Combined bucket + machine spillage, as the capture screen displays it. */
  spillage: number
  bucketKg: number
  machineKg: number
  /** True on the afternoon shift, which leaves a carry-over rather than using one. */
  bucketIsOutput: boolean
}

export function sievingTotals(
  d: SievingBalanceData,
  ctx: BalanceContext | Shift = {},
): SievingTotals {
  // Historically this took (d, shift, topUpKg). Accept a bare shift so existing
  // callers keep working while they are migrated.
  const { shift, topUpKg = 0, carryOverInKg }: BalanceContext =
    typeof ctx === 'string' ? { shift: ctx } : ctx

  const debagIn   = (d.debag ?? []).reduce((s, r) => s + n(r.nett), 0)
  const bucketKg  = n(d.spillage?.[0]?.kg)
  const machineKg = (d.spillage ?? []).slice(1).reduce((s, r) => s + n(r.kg), 0)

  // Finished product: bagged output plus anything topped up into an existing
  // bag from this shift's own loose production.
  const totalOut = (d.outputs ?? []).reduce((s, b) => s + n(b.weight), 0) + topUpKg

  const bucketIsOutput = shift === 'afternoon'

  // Afternoon leaves a carry-over; morning consumes one.
  const carryOverOut = bucketIsOutput ? bucketKg : 0
  // Prefer the ledger figure (variant-family matched) when the caller has it;
  // otherwise fall back to what the operator typed on the screen.
  const carryOverIn = bucketIsOutput ? 0 : (carryOverInKg ?? bucketKg)

  const totalIn = debagIn + machineKg + carryOverIn

  // Identical arithmetic to the previous `totalIn − (product + leftover)`.
  const balance = totalIn - totalOut - carryOverOut

  return {
    totalIn, totalOut, carryOverIn, carryOverOut, balance,
    spillage: bucketKg + machineKg, bucketKg, machineKg, bucketIsOutput,
  }
}
