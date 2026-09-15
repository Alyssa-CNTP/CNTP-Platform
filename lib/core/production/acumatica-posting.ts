/**
 * What a production record posts into Acumatica.
 *
 * ── Why this is core ───────────────────────────────────────────────────────
 *
 * The same answer is needed in three places that must never disagree: the
 * panel on the order summary that shows an operator what WOULD post, the route
 * that actually posts it, and the record kept afterwards of what DID post. A
 * posting that computes its own quantities at send time is a posting nobody
 * reviewed. So the document is built once, here, and the page renders exactly
 * the object the route transmits.
 *
 * Pure: no I/O, no React, no clock. The Acumatica item is RESOLVED upstream
 * (from `production.inventory_items`) and handed in — core may not read a
 * table, and an item id must never be constructed from a template, which is
 * how a renamed product silently ships with a blank code.
 *
 * ── `production_runs.production_order` holds two different things ──────────
 *
 * On Sieving, Refining 1/2 and the Granule line it holds the INVENTORY ITEM —
 * `S10LGBL-C`, `15IGDIS-C`, `20BGCHS-F-C`, `20BGGSG-001-C`. All of those are
 * rows in `inventory_items` and go straight onto the order header.
 *
 * On the Blender it holds the BOM ID. `25SFCKUN25C` is not an item and never
 * was; it is the bill of materials, and `bom_components` maps it to the item:
 *
 *     BOM 25SFCKUN25C    →  25BLSFC-KUN25-C
 *     BOM 25SGNAT26C-1   →  25BLSG-NAT26-1-C
 *     BOM 25CH50C50WBC   →  25BLCH-50C-50W-B-C
 *
 * which is exactly what Acumatica's own ProductionOrder carries — InventoryID
 * `25BLSFC-KUN25-C` against BOMID `25SFCKUN25C`. Acumatica is the source of
 * truth for the BOM, so the id is resolved through it rather than derived.
 *
 * Both are therefore handed in separately, and a BOM-identified section whose
 * BOM did not resolve is a blocker rather than a post against a guessed item.
 *
 * ── The posting scope is not the run, and not the day ──────────────────────
 *
 * Two records that share a variant and a grade are ONE Acumatica order even
 * when they are separate runs.
 *
 * On 11 September 2026 the Sieving tower filed three records:
 *
 *     ST-110926-01  morning    Organic       grade A   run 601c65e2
 *     ST-110926-02  morning    Conventional  grade B   run 49e99fcb
 *     ST-110926-03  afternoon  Conventional  grade B   run b4c8566a
 *
 * That is two production orders — `S10LGE-O` for the organic morning, and
 * `S10LGBL-C` covering the conventional morning AND afternoon. Grouping by
 * `run_id`, which is what the summary DOCUMENT does, would raise three; the
 * afternoon opened a fresh run rather than continuing the morning's, and the
 * order item cannot tell them apart because `S10LGBL-C` encodes only the grade
 * and the variant.
 *
 * Grouping by the whole day is the opposite error and the worse one: it would
 * post the organic output under a conventional code.
 *
 * So the key is `(section, production day, variant, grade)` — every field of
 * which `production_runs` already carries. The document scope and the posting
 * scope are deliberately different questions and this module answers only the
 * second.
 *
 * ── Sign convention, per section ───────────────────────────────────────────
 *
 * An Acumatica material line is a CONSUMPTION by default. Output is therefore
 * entered negative — except on the Blender, where it is not. This is a
 * per-section difference of the same kind as the five mass-balance formulas
 * (ARCHITECTURE.md §4): it mirrors how each line is modelled in Acumatica, and
 * unifying it would silently invert a whole section's inventory movement.
 */

import { n } from '@/lib/core/num'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** One debagging row — material going INTO the line. */
export interface PostingInputRow {
  /** As typed on the floor. Cleaned here, never at the call site. */
  lotNumber: string | null
  kgNett: number
  /** Machine spillage: weight counts, but it is not a bag that was carried in. */
  isSpillage: boolean
}

/** One output bag, from the `bag_tags` ledger. */
export interface PostingOutputRow {
  /** `bag_tags.acumatica_id`. Null is a blocker, never a guess. */
  acumaticaId: string | null
  productType: string | null
  kg: number
}

/** The identity of the order being posted. */
export interface PostingScope {
  sectionId: string
  /** The PRODUCTION day (07h00→01h00), as stored on the run. */
  productionDay: string
  variant: string | null
  grade: string | null
  /** Every record folded into this order, for the reader. */
  recordNos: readonly string[]
}

/**
 * The authoritative totals, from `productionTotals()`.
 *
 * Passed in rather than summed here. A day's input and output do not reconcile
 * by addition alone — bucket-elevator carry-over moves weight between days, and
 * a naive in-minus-out reads 6.6% short on 11 September and 5.1% over on the
 * 10th, both far outside the ±1% tolerance, purely from that. The line sums
 * computed below are checked AGAINST these, not substituted for them.
 *
 * ⚠ `toleranceKg` must come from `massBalanceToleranceKg(totalIn)`, NOT from
 * `production_runs.tolerance_kg`. Every run row on production still carries the
 * retired flat 15 — 0.16% of a 9 500 kg order, so reading the stored value
 * would fail almost every post for being 60 kg outside a tolerance that no
 * longer exists (ARCHITECTURE.md §5).
 */
export interface PostingTotals {
  totalInputKg: number
  totalOutputKg: number
  toleranceKg: number
}

export interface PostingLine {
  inventoryId: string
  /** Signed per section. Negative means "produced" everywhere but the Blender. */
  quantity: number
  uom: 'KG'
  /** Issue lines only. Already normalised. */
  lotSerialNbr?: string
  byproduct: boolean
}

export type PostingBlockerCode =
  | 'no-order-item'
  | 'no-bom-id'
  | 'no-operation-number'
  | 'missing-item-code'
  | 'lot-missing'
  | 'lot-suspect'
  | 'no-inputs'
  | 'no-outputs'
  | 'line-total-mismatch'
  | 'balance-out-of-tolerance'
  | 'unknown-section'

export interface PostingBlocker {
  code: PostingBlockerCode
  /** Written for the operator reading the summary page, not for a log. */
  message: string
}

export interface PostingDocument {
  scope: PostingScope
  /** Acumatica `InventoryID` for the order header. Null when unresolved. */
  orderItem: string | null
  /** Acumatica `BOMID`. The identity itself on a BOM-identified section. */
  bomId: string | null
  operationNbr: string | null
  qtyToProduce: number
  issueLines: PostingLine[]
  byproductLines: PostingLine[]
  blockers: PostingBlocker[]
  /** True only when there is nothing left to fix. */
  postable: boolean
}

// ---------------------------------------------------------------------------
// Per-section rules
// ---------------------------------------------------------------------------

/**
 * Which way an output line is signed.
 *
 * Input is positive everywhere. Output is negative everywhere EXCEPT the
 * Blender (and the Small Blender, which is the same capture shape on a
 * different physical line).
 */
const OUTPUT_SIGN: Readonly<Record<string, 1 | -1>> = {
  sieving:      -1,
  refining1:    -1,
  refining2:    -1,
  granule:      -1,
  pasteuriser:  -1,
  blender:      +1,
  smallblender: +1,
}

/**
 * What `QtyToProduce` on the order header means.
 *
 * Sieving raises the order against the total DEBAGGED — the tower's order is
 * for the material it is about to sieve. Every other line raises it against
 * what it produced.
 */
const QTY_SOURCE: Readonly<Record<string, 'input' | 'output'>> = {
  sieving:      'input',
  refining1:    'output',
  refining2:    'output',
  granule:      'output',
  blender:      'output',
  smallblender: 'output',
  pasteuriser:  'output',
}

export function outputSignFor(sectionId: string): 1 | -1 | null {
  return OUTPUT_SIGN[sectionId] ?? null
}

/**
 * Sections whose order is identified by its BOM rather than by its item.
 *
 * The Blender's run records a BOM id (`25SFCKUN25C`); the item that comes off
 * it (`25BLSFC-KUN25-C`) is whatever `bom_components` says the BOM outputs.
 * The Pasteuriser is the same shape — its BOMs are already synced (39 of them)
 * even though the line has not yet bagged anything.
 *
 * Everywhere else the run records the item directly and the BOM is Acumatica's
 * own default for it.
 */
const BOM_IDENTIFIED: ReadonlySet<string> = new Set(['blender', 'smallblender', 'pasteuriser'])

export function isBomIdentified(sectionId: string): boolean {
  return BOM_IDENTIFIED.has(sectionId)
}

// ---------------------------------------------------------------------------
// Lot numbers
// ---------------------------------------------------------------------------

/**
 * Clean a lot number to the form Acumatica stores.
 *
 * Five distinct lots on production carry whitespace the floor typed around the
 * hyphen — `'RSGG -05826'`, `'RSGG- 05526'`, `'RSFG- 05726'`. Acumatica matches
 * `LotSerialNbr` exactly, so each of those is a rejected line.
 *
 * Deliberately NOT uppercased and NOT otherwise reshaped: the goal is to undo
 * a typing slip, not to invent a lot that might not exist.
 */
export function normalizeLotSerial(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s*-\s*/g, '-')   // 'RSGG - 05826' → 'RSGG-05826'
    .replace(/\s+/g, ' ')       // any remaining run of spaces → one
}

/**
 * A lot that cleaned up but still does not look like an Acumatica lot.
 *
 * A slash or an interior space survives normalisation, and both appear on
 * production — `'04-09-26/1'`, `'09-09-26/2'` are dates somebody typed into the
 * lot box. They are flagged rather than rejected, because only the floor knows
 * what the bag really was.
 */
export function isSuspectLotSerial(cleaned: string): boolean {
  return cleaned.length === 0 || /[/\\]/.test(cleaned) || /\s/.test(cleaned)
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/** Round to 6dp so summed floats compare cleanly. Acumatica takes 6. */
function q(v: number): number {
  return Math.round(v * 1e6) / 1e6
}

export interface BuildPostingArgs {
  scope: PostingScope
  inputs: readonly PostingInputRow[]
  outputs: readonly PostingOutputRow[]
  totals: PostingTotals
  /**
   * Acumatica `InventoryID` for the order header, resolved from
   * `production.inventory_items` by the caller. Null when (section, grade,
   * variant) has no item — a blocker, never a guess.
   */
  orderItem: string | null
  /**
   * Acumatica `BOMID`, resolved from `production.bom_components`. Required on
   * a BOM-identified section (see `isBomIdentified`), where it IS the identity;
   * elsewhere it is optional and Acumatica defaults the BOM from the item.
   */
  bomId?: string | null
  /** Per-section operation number. Null blocks: it is not ours to invent. */
  operationNbr: string | null
}

export function buildPostingDocument(args: BuildPostingArgs): PostingDocument {
  const { scope, inputs, outputs, totals, orderItem, operationNbr } = args
  const bomId = args.bomId ?? null
  const blockers: PostingBlocker[] = []
  const add = (code: PostingBlockerCode, message: string) => blockers.push({ code, message })

  const sign = outputSignFor(scope.sectionId)
  if (sign === null) {
    add('unknown-section', `No Acumatica posting rule for section "${scope.sectionId}".`)
  }

  if (!orderItem) {
    add('no-order-item',
      `No Acumatica item for ${scope.sectionId} · ${scope.variant ?? 'no variant'} · grade ${scope.grade ?? '—'}.`)
  }
  if (isBomIdentified(scope.sectionId) && !bomId) {
    add('no-bom-id',
      `${scope.sectionId} orders are identified by their BOM, and this record has none.`)
  }
  if (!operationNbr) {
    add('no-operation-number', `No operation number configured for ${scope.sectionId}.`)
  }

  // ── Issue lines: one per lot, consumption, always positive ────────────────
  const byLot = new Map<string, number>()
  let missingLot = 0
  let inputKg = 0

  for (const row of inputs) {
    const kg = n(row.kgNett)
    inputKg += kg
    // Spillage is loss off the machine, not a bag carried in — its weight
    // counts as input but it has no lot to issue against.
    if (row.isSpillage) continue
    const lot = normalizeLotSerial(row.lotNumber)
    if (!lot) { missingLot += 1; continue }
    byLot.set(lot, q((byLot.get(lot) ?? 0) + kg))
  }

  const issueLines: PostingLine[] = [...byLot.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lot, kg]) => ({
      inventoryId: '',        // filled by the caller from the input item map
      quantity: q(kg),        // input is positive on every section
      uom: 'KG' as const,
      lotSerialNbr: lot,
      byproduct: false,
    }))

  if (missingLot > 0) {
    add('lot-missing',
      `${missingLot} debagging ${missingLot === 1 ? 'row has' : 'rows have'} no lot number.`)
  }
  const suspect = [...byLot.keys()].filter(isSuspectLotSerial)
  if (suspect.length > 0) {
    add('lot-suspect',
      `${suspect.length} lot ${suspect.length === 1 ? 'number does' : 'numbers do'} not look like Acumatica lots: ${suspect.slice(0, 4).join(', ')}${suspect.length > 4 ? '…' : ''}.`)
  }
  if (issueLines.length === 0) add('no-inputs', 'Nothing was debagged against this order.')

  // ── Byproduct lines: one per Acumatica item, signed per section ───────────
  const byItem = new Map<string, number>()
  let missingCode = 0
  let outputKg = 0

  for (const bag of outputs) {
    const kg = n(bag.kg)
    outputKg += kg
    const id = (bag.acumaticaId ?? '').trim()
    if (!id) { missingCode += 1; continue }
    byItem.set(id, q((byItem.get(id) ?? 0) + kg))
  }

  const byproductLines: PostingLine[] = [...byItem.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, kg]) => ({
      inventoryId: id,
      quantity: q(kg * (sign ?? -1)),
      uom: 'KG' as const,
      byproduct: true,
    }))

  if (missingCode > 0) {
    add('missing-item-code',
      `${missingCode} ${missingCode === 1 ? 'bag has' : 'bags have'} no Acumatica item code.`)
  }
  if (byproductLines.length === 0) add('no-outputs', 'No output bags on this order.')

  // ── The lines must add up to what the record says ─────────────────────────
  //
  // A posting whose lines quietly disagree with the summary above them is the
  // failure this whole module exists to prevent: the page shows one number, the
  // ledger receives another, and nobody can tell which was right afterwards.
  const TOL = 0.5   // kg — below a single bag, above float noise
  if (Math.abs(inputKg - n(totals.totalInputKg)) > TOL) {
    add('line-total-mismatch',
      `Issue lines total ${inputKg.toFixed(1)} kg but the record reports ${n(totals.totalInputKg).toFixed(1)} kg input.`)
  }
  if (Math.abs(outputKg - n(totals.totalOutputKg)) > TOL) {
    add('line-total-mismatch',
      `Output lines total ${outputKg.toFixed(1)} kg but the record reports ${n(totals.totalOutputKg).toFixed(1)} kg output.`)
  }

  // ── Mass balance, from the authoritative totals ───────────────────────────
  const balance = n(totals.totalInputKg) - n(totals.totalOutputKg)
  const tol = Math.abs(n(totals.toleranceKg))
  if (tol > 0 && Math.abs(balance) > tol) {
    add('balance-out-of-tolerance',
      `Mass balance is ${balance > 0 ? '+' : ''}${balance.toFixed(1)} kg against a ±${tol.toFixed(1)} kg tolerance.`)
  }

  const qtySource = QTY_SOURCE[scope.sectionId] ?? 'output'
  const qtyToProduce = q(qtySource === 'input' ? n(totals.totalInputKg) : n(totals.totalOutputKg))

  return {
    scope,
    orderItem,
    bomId,
    operationNbr,
    qtyToProduce,
    issueLines,
    byproductLines,
    blockers,
    postable: blockers.length === 0,
  }
}

// ---------------------------------------------------------------------------
// Scope grouping
// ---------------------------------------------------------------------------

/** Trim-and-fold, so ' Conventional ' and 'conventional' are one variant. */
function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase()
}

/**
 * The key that decides which records post as ONE Acumatica order.
 *
 * `(section, production day, variant, grade)` — see the header. Not the run id:
 * two runs on the same day with the same variant and grade are one order.
 *
 * On a BOM-identified section the BOM replaces the grade, because there the two
 * do not reliably agree: 8 of 55 blender runs on production carry a `grade` that
 * differs from their own `production_order` (`grade=25SFCKUN25C` against
 * `production_order=25SGNAT233C`, and similar). Keying on the grade folded two
 * days' worth of separate blends into one order. The BOM is the order's
 * identity on those lines, so it is what the key asks.
 */
export function postingScopeKey(s: {
  sectionId: string
  productionDay: string
  variant: string | null
  grade: string | null
  /** The BOM id. Used in place of the grade where the section is BOM-identified. */
  bomId?: string | null
}): string {
  const identity = isBomIdentified(s.sectionId) ? norm(s.bomId) : norm(s.grade)
  return `${s.sectionId}|${s.productionDay}|${norm(s.variant)}|${identity}`
}
