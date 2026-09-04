/**
 * The section discriminant.
 *
 * Capture code used to tell the five section data shapes apart by guessing at
 * their fields:
 *
 *     if ('bomId' in d) { … }        // Blender
 *     else if ('inputs' in d) { … }  // Refining
 *     else if ('blends' in d) { … }  // Granule
 *     else if ('byProducts' in d) { … } // Pasteuriser
 *     else { … }                     // Sieving — the unguarded fallback
 *
 * Adding a field named `inputs` to any section silently rerouted it into
 * Refining's branch, and anything unrecognised fell through to Sieving. That is
 * the mechanism behind "a change to one section broke another".
 *
 * The section is already known from the route and from `prod_sessions.section_id`
 * — it never needed to be inferred. Dispatch on this instead. See
 * ARCHITECTURE.md §4.
 */

/**
 * What KIND of line a section is. Note refining1 and refining2 are two physical
 * lines that share one data shape, so they collapse to a single kind.
 */
export type SectionKind = 'sieving' | 'refining' | 'granule' | 'blender' | 'pasteuriser'

/**
 * Every section id the app routes to, mapped to its kind. Mirrors the CHECK
 * constraint on production.prod_sessions.section_id, as widened by
 * 20260714_001_smallblender_section.sql.
 *
 * Keep this in step with SECTION_MODE in lib/production/capture-config.ts —
 * that is the other list of every real section. `smallblender` is a genuine
 * section (work centre '05-BLENDER SMALL') that shares Blender's data shape,
 * which is why the pre-existing `isBlenderSection()` helper accepts both.
 * Omitting it here would send it down the Sieving fallback — precisely the
 * class of bug this discriminant exists to remove.
 */
export const SECTION_KIND = {
  sieving:      'sieving',
  refining1:    'refining',
  refining2:    'refining',
  granule:      'granule',
  blender:      'blender',
  smallblender: 'blender',
  pasteuriser:  'pasteuriser',
} as const satisfies Record<string, SectionKind>

export type SectionId = keyof typeof SECTION_KIND

export function isSectionId(id: string): id is SectionId {
  return Object.prototype.hasOwnProperty.call(SECTION_KIND, id)
}

/**
 * Resolve a section id to its kind.
 *
 * An unknown id is a programming error — a section was added without being
 * mapped here. It falls back to 'sieving' (the historic default) rather than
 * throwing, because throwing during render would blank the capture screen an
 * operator is mid-shift on, but it logs loudly so the mistake surfaces on
 * staging rather than living quietly in production.
 *
 * The real protection is not this fallback: it is that every `switch` on
 * SectionKind ends in assertNever, so adding a kind here without handling it
 * everywhere fails the BUILD.
 */
export function sectionKindFor(sectionId: string): SectionKind {
  if (isSectionId(sectionId)) return SECTION_KIND[sectionId]
  console.error(
    `[capture] Unknown section id "${sectionId}" — add it to SECTION_KIND in ` +
    `lib/core/types/capture.ts. Falling back to 'sieving'.`,
  )
  return 'sieving'
}

/**
 * Exhaustiveness guard for a switch or if/else chain over a union.
 *
 * Put it in the final `else`/`default`. TypeScript then refuses to compile if
 * any member of the union is unhandled, which is what turns "adding a section
 * quietly breaks another one" into a build failure.
 */
export function assertNever(value: never, context = 'value'): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`)
}
