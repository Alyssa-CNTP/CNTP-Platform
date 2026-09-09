/**
 * Compile-time proof that each section's real data type still matches the shape
 * `lib/core` reads.
 *
 * ── Why this file, and why it is here rather than in core ───────────────────
 *
 * Core declares the capture shapes it reads structurally, in
 * `lib/core/types/capture-data.ts`, instead of importing them from these
 * component files — see that file's header for why. The cost of a structural
 * copy is that it can drift from the thing it mirrors, silently, until a row
 * quietly stops being written.
 *
 * This closes that. Each line below fails to compile if a component renames,
 * removes or re-types a field core depends on. It cannot live in core: core may
 * not import from components (ARCHITECTURE.md §2, now enforced for
 * `components/` too). Components importing core is the allowed direction, so
 * the check belongs on this side of the boundary.
 *
 * ── What it does and does not catch ─────────────────────────────────────────
 *
 * CATCHES: a field core reads being renamed, dropped, or narrowed to an
 * incompatible type. That is the drift that would otherwise reach production as
 * a NULL column.
 *
 * DOES NOT CATCH: a component ADDING a field core does not read — correct, core
 * does not care — or a field's MEANING changing while its name and type stay
 * put. Nothing type-level can catch the second; the characterisation tests in
 * `lib/core/capture-rows/capture-rows.test.ts` are what pin behaviour.
 *
 * ── There is no runtime here on purpose ─────────────────────────────────────
 *
 * `satisfies`-style assignability checks are erased by the compiler, so this
 * module emits nothing and is never imported. vitest strips types without
 * checking them, so it is `tsc` that enforces this, via the typecheck ratchet
 * in CI. If you are wondering why there is no test file: a test could not
 * observe any of this.
 */

import type { SievingData }     from './SievingCapture'
import type { RefiningData }    from './RefiningCapture'
import type { GranuleData }     from './GranuleCapture'
import type { BlenderData }     from './BlenderCapture'
import type { PasteuriserData } from './PasteuriserCapture'

import type {
  CoreSievingData,
  CoreRefiningData,
  CoreGranuleData,
  CoreBlenderData,
  CorePasteuriserData,
} from '@/lib/core/types/capture-data'

/**
 * `Conforms<Actual, Expected>` resolves to `Actual` only when the component's
 * type is assignable to core's. Otherwise the alias errors and names both
 * sides, which is a far more useful message than a failure at the call site
 * several files away.
 */
type Conforms<Actual extends Expected, Expected> = Actual

// One line per section. A rename in any capture component fails the build here.
export type SievingConforms     = Conforms<SievingData,     CoreSievingData>
export type RefiningConforms    = Conforms<RefiningData,    CoreRefiningData>
export type GranuleConforms     = Conforms<GranuleData,     CoreGranuleData>
export type BlenderConforms     = Conforms<BlenderData,     CoreBlenderData>
export type PasteuriserConforms = Conforms<PasteuriserData, CorePasteuriserData>
