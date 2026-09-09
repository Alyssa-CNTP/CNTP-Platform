import { describe, it, expect } from 'vitest'
import { areasForSection, primaryAreaForSection, hasAreaMapping } from './areas'
import { SECTION_ORDER } from '@/lib/production/capture-config'
import { AREAS } from '@/lib/maintenance/constants'

/**
 * DRIFT GUARD, in the spirit of section-kind-drift.test.ts.
 *
 * This file maps two vocabularies that are maintained by different people in
 * different modules: capture's `section_id` and maintenance's `area`. Nothing
 * at runtime notices when they stop agreeing — a renamed area just means the
 * operator's breakdown prompt goes quiet, which reads on the floor as "the
 * prompt doesn't work" rather than as an error.
 */

describe('areasForSection', () => {
  it('maps every built capture section', () => {
    // A section with no mapping shows an empty maintenance panel and never
    // prompts, so a new section must be added here at the same time.
    for (const id of SECTION_ORDER) {
      expect(hasAreaMapping(id), `${id} has no maintenance area mapping`).toBe(true)
    }
  })

  it('only names areas the maintenance module actually has', () => {
    // The names must match `AREAS` exactly — the query filters on `area`, so a
    // near-miss ('Pasteuriser' for 'Pasteurizer') returns nothing at all,
    // silently.
    const known = new Set(AREAS)
    for (const id of SECTION_ORDER) {
      for (const area of areasForSection(id)) {
        expect(known.has(area), `"${area}" (${id}) is not in lib/maintenance/constants AREAS`).toBe(true)
      }
    }
  })

  it('includes the facility-wide areas for every section', () => {
    // A boiler failure stops whichever line is running, so those cards reach
    // every operator.
    for (const id of SECTION_ORDER) {
      expect(areasForSection(id)).toContain('Boiler Room')
    }
  })

  it('keeps the two Refining lines and the two Blenders apart', () => {
    // smallblender shares SectionKind 'blender' but is a different physical
    // line (ARCHITECTURE.md §5) — one area for both would put Unit 3's
    // breakdowns on the Diamond Blender's record.
    expect(areasForSection('refining1')).toContain('Refining 1')
    expect(areasForSection('refining1')).not.toContain('Refining 2')
    expect(areasForSection('blender')).toContain('Diamond Blender')
    expect(areasForSection('blender')).not.toContain('Unit 3 Blender')
    expect(areasForSection('smallblender')).toContain('Unit 3 Blender')
    expect(areasForSection('smallblender')).not.toContain('Diamond Blender')
  })

  it('returns only the shared areas for an unknown section', () => {
    expect(areasForSection('quality_lab')).toEqual(['Boiler Room', 'Factory', 'Facility'])
    expect(hasAreaMapping('quality_lab')).toBe(false)
  })
})

describe('primaryAreaForSection', () => {
  it("is the section's OWN first area, never a shared one", () => {
    // A stoppage filed against "Factory" is attributed to nowhere in
    // particular, which is worse than no area at all.
    expect(primaryAreaForSection('sieving')).toBe('Sieving Tower')
    expect(primaryAreaForSection('granule')).toBe('Granules - RB')
    for (const id of SECTION_ORDER) {
      expect(['Boiler Room', 'Factory', 'Facility']).not.toContain(primaryAreaForSection(id))
    }
  })

  it('is null for an unmapped section rather than a wrong guess', () => {
    expect(primaryAreaForSection('quality_lab')).toBeNull()
  })
})
