import { n } from '@/lib/core/num'

/**
 * Refining mass balance. Moved verbatim from RefiningCapture.tsx.
 * Sign convention: in − out (opposite to Blender). Do not "harmonise" these.
 */

export interface RefiningBalanceData {
  inputs?: readonly { weight: string }[]
  outputA?: { bags?: readonly { weight: string }[] } | null
  outputB?: { bags?: readonly { weight: string }[] } | null
  outputC?: { bags?: readonly { weight: string }[] } | null
  outputD?: { bags?: readonly { weight: string }[] } | null
}

export function refiningTotals(d: RefiningBalanceData) {
  const totalIn = (d.inputs ?? []).reduce((s, r) => s + n(r.weight), 0)
  const groupKg = (g: { bags?: readonly { weight: string }[] } | null | undefined) =>
    (g?.bags ?? []).reduce((s, b) => s + n(b.weight), 0)
  const totalA = groupKg(d.outputA)
  const totalB = groupKg(d.outputB)
  const totalC = groupKg(d.outputC)
  const totalD = groupKg(d.outputD)
  const balance = totalIn - totalA - totalB - totalC - totalD
  return { totalIn, totalA, totalB, totalC, totalD, balance }
}
