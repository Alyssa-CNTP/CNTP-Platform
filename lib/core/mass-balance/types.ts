/**
 * Mass balance — shared vocabulary.
 *
 * The five sections keep SEPARATE formulas on purpose (ARCHITECTURE.md §4):
 * Blender is `out − in`, Refining and Sieving are `in − out`, Granule is
 * `H − G`. They mirror five different paper forms and must never be merged.
 *
 * What IS shared is the vocabulary below: the small set of figures every
 * consumer — the capture screen, the persisted prod_mass_balance row, and the
 * production-order summaries — needs from any section, so those three stop
 * computing it three different ways.
 */

export type Shift = 'morning' | 'afternoon'

/**
 * The section-agnostic view of one production's balance.
 *
 * `totalOut` is FINISHED PRODUCT: what the shift actually produced.
 *   - It INCLUDES half-bag top-ups made from this shift's own loose production
 *     (the increment only, never the whole bag), because that material was
 *     produced here even though the bag it went into may have been created on
 *     an earlier day and so never appears in this session's outputs.
 *   - It EXCLUDES bag-to-bag transfers, whose mass was already counted as
 *     output when the source bag was first bagged.
 *   - It EXCLUDES material left in the bucket elevator for tomorrow. That is
 *     work in progress, not product — it is reported separately as
 *     `carryOverOut`.
 *
 * `totalIn` INCLUDES carry-over consumed from a previous day, but only from the
 * same variant family (conventional never mixes with organic) — that portion is
 * also reported on its own as `carryOverIn`.
 *
 * `balance` is therefore `totalIn − totalOut − carryOverOut`, which reconciles
 * to zero on a clean shift. Note this is arithmetically identical to the older
 * `totalIn − (product + leftover)`: what changed is that "left in the elevator"
 * is no longer disguised as output.
 */
export interface ProductionTotals {
  totalIn: number
  totalOut: number
  /** Consumed from a previous day. Already counted inside totalIn. */
  carryOverIn: number
  /** Left for the next day. Deliberately NOT counted inside totalOut. */
  carryOverOut: number
  balance: number
}

/** Inputs a caller can supply that the captured data itself does not carry. */
export interface BalanceContext {
  shift?: Shift
  /**
   * Half-bag top-up kg made from this shift's own production. Pass only
   * `mode === 'production'` events — a `mode === 'existing'` bag-to-bag
   * transfer moves mass that was already counted when the source bag was
   * bagged, so including it double-counts.
   */
  topUpKg?: number
  /**
   * Carry-over consumed from a previous day, for the SAME variant family.
   * Read from production.bucket_elevator_log via outstandingBucketElevator().
   * When omitted, the section falls back to the figure typed on the capture
   * screen.
   */
  carryOverInKg?: number
}
