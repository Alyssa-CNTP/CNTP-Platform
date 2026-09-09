import { describe, it, expect } from 'vitest'
import { primaryAreaForSection, hasAreaMapping } from './areas'
import { SECTION_ORDER } from '@/lib/production/capture-config'
import { AREAS } from '@/lib/maintenance/constants'

/**
 * DRIFT GUARD, in the spirit of section-kind-drift.test.ts.
 *
 * This file maps two vocabularies maintained by different people in different
 * modules: capture's `section_id` and maintenance's `area`. Nothing at runtime
 * notices when they stop agreeing — the area string just ends up naming a place
 * nobody recognises, on the notification that tells a fitter where to go.
 */

describe('primaryAreaForSection', () => {
  it('maps every built capture section', () => {
    // A new section without a mapping sends a stoppage notification with no
    // location, so it has to be added here at the same time.
    for (const id of SECTION_ORDER) {
      expect(hasAreaMapping(id), `${id} has no maintenance area mapping`).toBe(true)
      expect(primaryAreaForSection(id), id).toBeTruthy()
    }
  })

  it('only names areas the maintenance module actually has', () => {
    // The names must match `AREAS` exactly. 'Pasteuriser' for 'Pasteurizer' is
    // not a near-miss anyone notices — it is just a wrong place name on a page.
    const known = new Set(AREAS)
    for (const id of SECTION_ORDER) {
      const area = primaryAreaForSection(id)
      expect(known.has(area as string), `"${area}" (${id}) is not in lib/maintenance/constants AREAS`).toBe(true)
    }
  })

  it('keeps the two Refining lines and the two Blenders apart', () => {
    // smallblender shares SectionKind 'blender' but is a different physical
    // line (ARCHITECTURE.md §5) — one area for both would put Unit 3's
    // stoppages on the Diamond Blender's record.
    expect(primaryAreaForSection('refining1')).toBe('Refining 1')
    expect(primaryAreaForSection('refining2')).toBe('Refining 2')
    expect(primaryAreaForSection('blender')).toBe('Diamond Blender')
    expect(primaryAreaForSection('smallblender')).toBe('Unit 3 Blender')
  })

  it('gives every section a DISTINCT area', () => {
    // Two sections sharing an area would merge two lines' downtime into one
    // figure, which is the opposite of per-line analysis.
    const areas = SECTION_ORDER.map(primaryAreaForSection)
    expect(new Set(areas).size).toBe(areas.length)
  })

  it('is null for an unmapped section rather than a wrong guess', () => {
    expect(primaryAreaForSection('quality_lab')).toBeNull()
    expect(hasAreaMapping('quality_lab')).toBe(false)
  })
})
