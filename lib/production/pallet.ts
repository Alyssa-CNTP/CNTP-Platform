/**
 * lib/production/pallet.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pallet identity and box→pallet splitting for Pasteuriser final product.
 *
 * The Pasteuriser bagging report (PR-FM-005) records output as a BAG RANGE per
 * line — "40 bags, starting bag 281, ending bag 320, 18 kg each". The physical
 * unit that ships is a pallet of N boxes, so a line has to be cut into pallets
 * before anything can be tagged. That cut is pure arithmetic on the range, and
 * it lives here rather than in the capture component so that:
 *
 *   - the same split drives the on-screen proposal, the printed tags, and the
 *     rows written to production.pallets — no chance of three slightly
 *     different answers,
 *   - the last (short) pallet is handled in exactly one place. A 315-bag batch
 *     at 45/pallet is 7 pallets; a 320-bag batch is 7 full + 1 of 5. A short
 *     final pallet is normal and must never read as an error.
 *
 * Everything here is deliberately side-effect free. Persistence lives in the
 * capture screen's persist() alongside the bag_tags write it has to stay
 * consistent with.
 */

/** Boxes per pallet when the packaging spec doesn't say. 45 × 18kg boxes is
 *  the standard export box pallet on the floor. */
export const DEFAULT_BOXES_PER_PALLET = 45

/**
 * Boxes per pallet implied by a packaging description.
 *
 * Bulk bags are a 500kg unit that ships on its own — one bag IS the pallet, so
 * splitting them 45-up would invent pallets that don't physically exist.
 * Returns null when the packaging is unrecognised, so callers fall back to the
 * operator-visible default rather than silently trusting a guess.
 */
export function boxesPerPalletFor(packaging: string | null | undefined): number | null {
  const p = (packaging ?? '').toLowerCase()
  if (!p.trim()) return null
  if (p.includes('bulk')) return 1              // 500kg bulk bag — one per pallet
  if (p.includes('paper')) return 18            // 18kg paper bags, palletised
  if (p.includes('box') || p.includes('carton')) return DEFAULT_BOXES_PER_PALLET
  if (p.includes('vacuum') || p.includes('foil') || p.includes('quad')) return DEFAULT_BOXES_PER_PALLET
  return null
}

/** One proposed pallet: a contiguous run of physical bag/box numbers. */
export interface PalletSplit {
  index: number        // 1-based position within the bagging line
  startBagNo: number
  endBagNo: number
  boxCount: number
  totalKg: number
  short: boolean       // fewer boxes than a full pallet — expected on the last one
}

/**
 * Cut a bagging line's bag-number range into pallets.
 *
 * `startBagNo` is the physical "Starting bag number" off the paperwork. When it
 * isn't known yet we still split, numbering from 1, so the operator sees the
 * shape of the pallets before they've filled the range in.
 */
export function splitIntoPallets(opts: {
  boxCount: number
  startBagNo?: number | null
  boxesPerPallet?: number | null
  boxWeightKg?: number | null
}): PalletSplit[] {
  const boxes = Math.max(0, Math.floor(opts.boxCount || 0))
  if (boxes === 0) return []

  const per = Math.max(1, Math.floor(opts.boxesPerPallet || DEFAULT_BOXES_PER_PALLET))
  const start = Number.isFinite(Number(opts.startBagNo)) && Number(opts.startBagNo) > 0
    ? Math.floor(Number(opts.startBagNo))
    : 1
  const kgEach = Number(opts.boxWeightKg) || 0

  const out: PalletSplit[] = []
  for (let offset = 0, i = 1; offset < boxes; offset += per, i++) {
    const count = Math.min(per, boxes - offset)
    out.push({
      index: i,
      startBagNo: start + offset,
      endBagNo: start + offset + count - 1,
      boxCount: count,
      // Rounded to 2dp: 18.5 × 45 is exact in decimal but not in binary float,
      // and an unrounded 832.4999999999999 on a printed pallet tag is the kind
      // of thing the floor (rightly) reports as a bug.
      totalKg: Math.round(count * kgEach * 100) / 100,
      short: count < per,
    })
  }
  return out
}

/**
 * Pallet serial: `{LOT}-P{nn}`.
 *
 * Deliberately derived from the batch lot rather than a random id, because the
 * operator has to be able to hand-write it on a tag when the printer is down —
 * the same reason every other serial on this floor is human-typeable. The
 * `-P` marker is what makes a pallet scan distinguishable from a box scan
 * (`{LOT}-001`) without a database round-trip.
 */
export function makePalletSerial(lot: string, index: number): string {
  return `${String(lot).trim().toUpperCase()}-P${String(index).padStart(2, '0')}`
}

/** True when a scanned code looks like a pallet serial rather than a box serial. */
export function isPalletSerial(serial: string): boolean {
  return /-P\d{2,}$/i.test(String(serial ?? '').trim())
}

/**
 * Box serial: `{LOT}-{nnn}` on the physical bag number.
 *
 * Keyed on the bag number the operator writes on the box — not on a running
 * per-session counter — so re-saving a session, or correcting a bag count,
 * always regenerates the SAME serial for the same physical box instead of
 * minting a duplicate identity for it. This mirrors what persist() already
 * does for pasteuriser output; it's centralised here so the print path and the
 * write path cannot drift.
 */
export function makeBoxSerial(lot: string, bagNo: number): string {
  return `${String(lot).trim().toUpperCase()}-${String(bagNo).padStart(3, '0')}`
}
