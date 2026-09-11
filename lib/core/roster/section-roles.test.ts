import { describe, it, expect } from 'vitest'
import {
  SECTION_ROLE_KEYS, ALL_SECTION_ROLE_KEYS,
  roleKeysForSection, sectionForRoleKey,
  captureShiftForRosterShift, rosterShiftForCaptureShift,
  pinnedSectionFor, type RosterAssignment,
} from './section-roles'

const on = (roleKey: string, shift: string): RosterAssignment => ({ roleKey, shift })

describe('the role/section map', () => {
  it('round-trips every mapped section', () => {
    for (const [sectionId, keys] of Object.entries(SECTION_ROLE_KEYS)) {
      for (const k of keys) expect(sectionForRoleKey(k)).toBe(sectionId)
    }
  })

  it('never maps one role key to two sections', () => {
    expect(new Set(ALL_SECTION_ROLE_KEYS).size).toBe(ALL_SECTION_ROLE_KEYS.length)
  })

  it('carries both Granule role keys, because the roster has both', () => {
    expect(roleKeysForSection('granule')).toEqual(['granule_operator', 'granule'])
  })

  it('returns null for roster roles that are not capture sections', () => {
    // QC, store, maintenance, cleaning, the Rooibos Supervisor. Null is the
    // right answer for these, not an error.
    for (const k of ['qc_supervisor', 'store_operator', 'maintenance_tech', 'rooibos_supervisor', 'cleaner'])
      expect(sectionForRoleKey(k)).toBeNull()
  })

  it('has no smallblender key, because the roster has no such role', () => {
    // Deliberate. Mapping it to an invented key would read as "nobody is ever
    // assigned" instead of as a missing mapping.
    expect(roleKeysForSection('smallblender')).toEqual([])
  })

  it('gives [] rather than throwing for an unknown section', () => {
    expect(roleKeysForSection('not_a_section')).toEqual([])
  })
})

describe('shift vocabulary', () => {
  it('maps night to afternoon, because they are the same 16h00-01h00 shift', () => {
    expect(captureShiftForRosterShift('night')).toBe('afternoon')
    expect(captureShiftForRosterShift('day')).toBe('morning')
  })

  it('treats the legacy capture alias night as afternoon too', () => {
    expect(rosterShiftForCaptureShift('night')).toBe('night')
    expect(rosterShiftForCaptureShift('afternoon')).toBe('night')
    expect(rosterShiftForCaptureShift('morning')).toBe('day')
  })

  it('defaults anything unrecognised to the morning/day shift', () => {
    expect(captureShiftForRosterShift('')).toBe('morning')
    expect(captureShiftForRosterShift('NONSENSE')).toBe('morning')
    expect(rosterShiftForCaptureShift('')).toBe('day')
  })

  it('is case-insensitive, since the two tables are typed by different screens', () => {
    expect(captureShiftForRosterShift('Night')).toBe('afternoon')
    expect(rosterShiftForCaptureShift('Afternoon')).toBe('night')
  })
})

describe('pinnedSectionFor', () => {
  it('picks the section for the shift being asked about', () => {
    const rows = [on('sieving_tower', 'day'), on('blender', 'night')]
    expect(pinnedSectionFor(rows, 'morning')).toBe('sieving')
    expect(pinnedSectionFor(rows, 'afternoon')).toBe('blender')
  })

  it('falls back to any section that day when they are not on this shift', () => {
    // Opening the page before your shift starts should still land you on your
    // line, not on nothing.
    expect(pinnedSectionFor([on('blender', 'night')], 'morning')).toBe('blender')
  })

  it('prefers this shift over the other one', () => {
    const rows = [on('blender', 'night'), on('sieving_tower', 'day')]
    expect(pinnedSectionFor(rows, 'morning')).toBe('sieving')
  })

  it('resolves a double assignment the same way every load', () => {
    // The roster allows one person on two lines in a shift. Whichever order
    // the rows arrive in, the page must open on the same one.
    const a = [on('blender', 'day'), on('sieving_tower', 'day')]
    const b = [on('sieving_tower', 'day'), on('blender', 'day')]
    expect(pinnedSectionFor(a, 'morning')).toBe(pinnedSectionFor(b, 'morning'))
  })

  it('returns null for someone who runs no line', () => {
    expect(pinnedSectionFor([on('qc_supervisor', 'day')], 'morning')).toBeNull()
    expect(pinnedSectionFor([], 'morning')).toBeNull()
  })

  it('ignores rows with an unknown role rather than failing the whole lookup', () => {
    expect(pinnedSectionFor([on('brand_new_role', 'day'), on('blender', 'day')], 'morning')).toBe('blender')
  })
})
