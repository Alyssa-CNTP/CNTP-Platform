import { n } from '@/lib/core/num'

/**
 * Blender mass balance. Moved verbatim from BlenderCapture.tsx.
 * Sign convention: the paper form's J = G (bagged out) − I (mixed in), i.e.
 * out − in — the OPPOSITE of Refining and Sieving. Deliberate; see
 * ARCHITECTURE.md §4.
 */

export interface BlenderBalanceData {
  inputs?: readonly { weight: string; itemKey: string }[]
  outputs?: readonly { weight: string }[]
}

export function blenderTotals(d: BlenderBalanceData) {
  const totalIn  = (d.inputs ?? []).reduce((s, r) => s + n(r.weight), 0)
  const totalOut = (d.outputs ?? []).reduce((s, r) => s + n(r.weight), 0)
  const balance = totalOut - totalIn
  const byItem: Record<string, number> = {}
  for (const r of d.inputs ?? []) byItem[r.itemKey] = (byItem[r.itemKey] ?? 0) + n(r.weight)
  return { totalIn, totalOut, balance, byItem }
}
