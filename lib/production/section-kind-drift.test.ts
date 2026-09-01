import { describe, it, expect } from 'vitest'
import { SECTION_MODE } from '@/lib/production/capture-config'
import { SECTION_KIND } from '@/lib/core/types/capture'

/**
 * Drift guard.
 *
 * There are two lists of "every real section" in this codebase: SECTION_MODE
 * (which sections exist and how they capture) and SECTION_KIND (which data shape
 * each one has). If they fall out of step, a section silently takes the wrong
 * branch — which is exactly what happened when SECTION_KIND was first written
 * from the original 2026-06-11 migration and missed `smallblender`, added a
 * month later by 20260714_001_smallblender_section.sql. That would have routed
 * Small Blender's data down the Sieving fallback.
 *
 * This test lives here rather than under lib/core so that core does not depend
 * on lib/production, even in a test. See ARCHITECTURE.md §2.
 */
describe('SECTION_KIND vs SECTION_MODE', () => {
  it('covers every section the app knows about', () => {
    const known = Object.keys(SECTION_MODE).sort()
    const mapped = Object.keys(SECTION_KIND).sort()
    expect(mapped).toEqual(known)
  })

  it('names no section that does not exist', () => {
    for (const id of Object.keys(SECTION_KIND)) {
      expect(SECTION_MODE, `SECTION_KIND has "${id}" but SECTION_MODE does not`)
        .toHaveProperty(id)
    }
  })
})
