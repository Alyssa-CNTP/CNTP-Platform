/**
 * Which maintenance AREAS a capture section's machines live in.
 *
 * The maintenance module keys job cards on `area` — a physical place from
 * `AREAS` in lib/maintenance/constants.ts — while capture keys everything on
 * `section_id`. Nothing joined the two, which is why a breakdown on the
 * Sieving Tower and an operator's "machine stopped" note on the Sieving capture
 * screen were two unrelated records of the same event.
 *
 * This map is the join, and it is the ONLY place it is written down. It is a
 * table rather than string-matching on the section name because the two
 * vocabularies genuinely disagree: capture says "Granule Line", maintenance
 * says "Granules - RB"; capture's `smallblender` is maintenance's
 * "Unit 3 Blender"; and maintenance spells the Pasteuriser with a z.
 *
 * A section maps to an ARRAY because a line can span more than one maintenance
 * area (the Granule Line has its own and shares the Rosehips granulator), and
 * because leaving one out means a real breakdown never reaches the operator's
 * prompt. Over-including is recoverable — the operator declines a card that
 * isn't theirs. Under-including is the silent failure.
 */

/** Section id → the maintenance areas whose job cards belong to that line. */
const SECTION_AREAS: Record<string, string[]> = {
  sieving:      ['Sieving Tower'],
  refining1:    ['Refining 1'],
  refining2:    ['Refining 2'],
  granule:      ['Granules - RB', 'Rosehips Granules'],
  blender:      ['Diamond Blender'],
  smallblender: ['Unit 3 Blender'],
  pasteuriser:  ['Pasteurizer', 'Vacuum Packing', 'Pallet Wrapper'],
}

/**
 * Areas whose cards matter to every line: a boiler or facility-wide failure
 * stops whichever section is running, so those cards are offered everywhere.
 * Kept separate from the per-section map so adding a section cannot forget them.
 */
const SHARED_AREAS: string[] = ['Boiler Room', 'Factory', 'Facility']

/** Every maintenance area whose job cards should reach this section's operator. */
export function areasForSection(sectionId: string): string[] {
  return [...(SECTION_AREAS[sectionId] ?? []), ...SHARED_AREAS]
}

/**
 * The area to record on a stoppage the operator logged themselves, when they
 * did not pick a card. The section's OWN first area — never a shared one, since
 * "Factory" would attribute a Sieving Tower breakdown to nowhere in particular.
 * Null for a section with no mapping, which is honest: better a stoppage with
 * no area than one filed against the wrong machine.
 */
export function primaryAreaForSection(sectionId: string): string | null {
  return SECTION_AREAS[sectionId]?.[0] ?? null
}

/** Is this section mapped at all? Used to explain an empty maintenance panel. */
export function hasAreaMapping(sectionId: string): boolean {
  return (SECTION_AREAS[sectionId]?.length ?? 0) > 0
}
