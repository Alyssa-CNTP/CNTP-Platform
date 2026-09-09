/**
 * Which maintenance AREA a capture section's machines live in.
 *
 * The section is never asked for — it is the production order the operator has
 * open, so a stoppage takes it as given. What this map adds is the name
 * MAINTENANCE uses for the same physical place, so the notification a stoppage
 * sends names somewhere a fitter recognises.
 *
 * It is a table rather than string-matching on the section name because the two
 * vocabularies genuinely disagree: capture says "Granule Line", maintenance
 * says "Granules - RB"; capture's `smallblender` is maintenance's
 * "Unit 3 Blender"; and maintenance spells the Pasteuriser with a z. A
 * near-miss is not a warning, it is a name nobody recognises on a page that
 * matters.
 *
 * An earlier version also mapped the reverse direction — every area whose job
 * cards should reach a section — so the capture screen could poll
 * `maintenance.job_cards`. That polling is gone (see prompts.ts), and so is
 * that half of the map.
 */

/** Section id → the maintenance area that section's machines sit in. */
const SECTION_AREA: Record<string, string> = {
  sieving:      'Sieving Tower',
  refining1:    'Refining 1',
  refining2:    'Refining 2',
  granule:      'Granules - RB',
  blender:      'Diamond Blender',
  smallblender: 'Unit 3 Blender',
  pasteuriser:  'Pasteurizer',
}

/**
 * The area to record on a stoppage, from the section the operator is capturing.
 *
 * Null for a section with no mapping, which is honest: better a stoppage with
 * no area than one filed against the wrong line. The notification falls back to
 * the section's own display name in that case.
 */
export function primaryAreaForSection(sectionId: string): string | null {
  return SECTION_AREA[sectionId] ?? null
}

/** Is this section mapped at all? */
export function hasAreaMapping(sectionId: string): boolean {
  return sectionId in SECTION_AREA
}
