/**
 * The capture shapes core READS — declared here, not imported from the section
 * components.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `lib/core/capture-rows` used to do this:
 *
 *     import type { SievingData } from '@/components/production/capture/SievingCapture'
 *
 * which is core reaching into a `'use client'` React component for its own
 * contract. `eslint.boundaries.mjs` did not catch it — CORE_FORBIDDEN listed
 * `features/`, `app/`, React/Next and `lib/supabase/`, but not `components/` —
 * so it was legal by the letter of the rule and against every word of
 * ARCHITECTURE.md §2. That gap is closed in the same commit as this file.
 *
 * ── Why structural, rather than moving the components' types into core ──────
 *
 * Moving `SievingData` and its four siblings into core would give one
 * declaration and no possibility of drift, which is the textbook answer. It was
 * rejected here for a specific reason: it edits all five section components,
 * and those five files are the most contested in the `main`/`staging` fork —
 * 1,187 differing lines across the capture module, all five components already
 * divergent. Deepening that fork to tidy a type import makes the promotion
 * harder in exactly the place it is already hardest.
 *
 * This is also not a new pattern. `lib/core/mass-balance/sieving.ts` already
 * declares `SievingBalanceData` as "only the fields the balance needs", for the
 * same reason. Two modules in core now answer the question the same way.
 *
 * ── What keeps the two in step ──────────────────────────────────────────────
 *
 * A structural copy CAN drift from the component it mirrors. Three things stop
 * it silently:
 *
 *   1. `components/production/capture/core-conformance.ts` asserts, at compile
 *      time, that each component's real type is assignable to the shape here.
 *      Rename a field in a component and that file fails to typecheck.
 *   2. The 42 characterisation tests over the row builders pin the field names
 *      that reach the database.
 *   3. Every field below is one core actually reads. Nothing is here
 *      speculatively, so the surface stays small enough to keep honest.
 *
 * ── How to read the types ───────────────────────────────────────────────────
 *
 * Everything core does with these values is `n(v)`, `v || fallback` or
 * `serialOrNull(v)`, all of which tolerate undefined. So fields are optional and
 * widely typed wherever the reading code already copes — that is not laziness,
 * it is the actual contract. The exception is Sieving's three arrays, which core
 * iterates unguarded (`sd.spillage.forEach`), so they are required here too.
 */

/** A weight as the capture screens hold it — a text input, never a number. */
type Kg = string

/** Set by the screen when the operator adds the row; used for `bagging_time`. */
type LoggedAt = string | null | undefined

/** 'manual' means the serial was typed and may not exist in `bag_tags`. */
type InputMode = string | null | undefined

// ── Refining 1 / 2 ───────────────────────────────────────────────────────────

export interface CoreRefiningInput {
  weight?: Kg
  inputMode?: InputMode
  serial?: string | null
  lot?: string | null
  productType?: string | null
  variant?: string | null
  deliveryDate?: string | null
}

export interface CoreRefiningOutputBag {
  weight?: Kg
  serial?: string | null
  productType?: string | null
  code?: string | null
  logged_at?: LoggedAt
}

export interface CoreRefiningGroup {
  bags?: readonly CoreRefiningOutputBag[]
}

export interface CoreRefiningData {
  inputs?: readonly CoreRefiningInput[]
  /**
   * `| null`, not just optional. The component types these as
   * `RefiningOutputGroup | null` — a group the run type does not use is
   * present and null, not absent. Core reads them as `(g?.bags ?? [])`, which
   * copes with both; declaring only `?` made the conformance check fail, which
   * is exactly the drift this pair is meant to surface.
   */
  outputA?: CoreRefiningGroup | null
  outputB?: CoreRefiningGroup | null
  outputC?: CoreRefiningGroup | null
  outputD?: CoreRefiningGroup | null
}

// ── Granule Line ─────────────────────────────────────────────────────────────

export interface CoreGranuleBlendRow {
  weight?: Kg
  inputMode?: InputMode
  serial?: string | null
  lot?: string | null
  /**
   * Required, and a plain `string`: it is passed straight to
   * `RowBuildContext.dustProductType(key: string)` with no fallback. Widening
   * it here would only move the error into core.
   */
  dustKey: string
  variant?: string | null
}

export interface CoreGranuleBlend {
  blendNo?: number | string
  rows?: readonly CoreGranuleBlendRow[]
}

export interface CoreGranuleOutput {
  weight?: Kg
  serial?: string | null
  lot?: string | null
  item?: string | null
  code?: string | null
  logged_at?: LoggedAt
}

export interface CoreGranuleDustOutput {
  weight?: Kg
  serial?: string | null
  /** SGD / SFD / … — deliberately NOT the granule code (ARCHITECTURE.md §5). */
  dustType?: string | null
  code?: string | null
}

export interface CoreGranuleData {
  blends?: readonly CoreGranuleBlend[]
  outputs?: readonly CoreGranuleOutput[]
  dustOutputs?: readonly CoreGranuleDustOutput[]
}

// ── Blender / Small Blender ──────────────────────────────────────────────────

export interface CoreBlenderInput {
  weight?: Kg
  inputMode?: InputMode
  serial?: string | null
  destination?: string | null
  lot?: string | null
  productType?: string | null
  variant?: string | null
}

export interface CoreBlenderOutput {
  weight?: Kg
  serial?: string | null
  logged_at?: LoggedAt
}

export interface CoreBlenderData {
  inputs?: readonly CoreBlenderInput[]
  outputs?: readonly CoreBlenderOutput[]
  /** The blend consumed. Becomes both `product_type` and `acumatica_id`. */
  bomId?: string | null
}

// ── Pasteuriser ──────────────────────────────────────────────────────────────

export interface CorePasteuriserDebagRow {
  weight?: Kg
  inputMode?: InputMode
  serial?: string | null
  /** 'postsieve' marks a bag from another line, e.g. the Granule Line. */
  stream?: string | null
  lot?: string | null
  productType?: string | null
  variant?: string | null
}

export interface CorePasteuriserOutputLine {
  bagCount?: string | number
  bagWeight?: string | number
  serial?: string | null
  lot?: string | null
  item?: string | null
  /** Final Product / High Moisture / Refill — all three count (§5). */
  kind?: string | null
  itemCode?: string | null
  logged_at?: LoggedAt
}

export interface CorePasteuriserByProduct {
  weight?: Kg
  serial?: string | null
  type?: string | null
}

export interface CorePasteuriserData {
  debag?: readonly CorePasteuriserDebagRow[]
  outputs?: readonly CorePasteuriserOutputLine[]
  byProducts?: readonly CorePasteuriserByProduct[]
  batchNo?: string | null
  weightPerBag?: string | number
}

// ── Sieving Tower ────────────────────────────────────────────────────────────

export interface CoreSievingSpillage {
  kg?: Kg
}

export interface CoreSievingDebagRow {
  nett?: Kg
  gross?: Kg
  /** The operator's physical bag number — goes to `notes`, not a serial. */
  bag_no?: string | null
  lot?: string | null
  delivery_date?: string | null
  grade?: string | null
  logged_at?: LoggedAt
}

export interface CoreSievingOutput {
  weight?: Kg
  serial?: string | null
  batch?: string | null
  productType?: string | null
  code?: string | null
  logged_at?: LoggedAt
}

/**
 * The three arrays are REQUIRED, unlike every other section's, because core
 * iterates them without a `?? []` guard. Keeping the type honest about that is
 * the point — loosening it here would move the crash from the compiler to the
 * floor.
 */
export interface CoreSievingData {
  spillage: readonly CoreSievingSpillage[]
  debag: readonly CoreSievingDebagRow[]
  outputs: readonly CoreSievingOutput[]
}

/** The union `buildDebagRows` / `buildBagRows` accept as a production's data. */
export type CoreCaptureData =
  | CoreSievingData
  | CoreRefiningData
  | CoreGranuleData
  | CoreBlenderData
  | CorePasteuriserData
