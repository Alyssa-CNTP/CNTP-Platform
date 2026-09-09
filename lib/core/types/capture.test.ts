import { describe, it, expect, vi, afterEach } from 'vitest'
import { SECTION_KIND, sectionKindFor, isSectionId, assertNever } from './capture'

afterEach(() => { vi.restoreAllMocks() })

describe('sectionKindFor', () => {
  it('maps every routed section id to its kind', () => {
    expect(sectionKindFor('sieving')).toBe('sieving')
    expect(sectionKindFor('granule')).toBe('granule')
    expect(sectionKindFor('blender')).toBe('blender')
    expect(sectionKindFor('pasteuriser')).toBe('pasteuriser')
  })

  it('collapses the two refining lines onto one kind', () => {
    // refining1 and refining2 are separate physical lines sharing a data shape.
    expect(sectionKindFor('refining1')).toBe('refining')
    expect(sectionKindFor('refining2')).toBe('refining')
  })

  it('treats smallblender as a blender', () => {
    // A real section (work centre '05-BLENDER SMALL', added by
    // 20260714_001_smallblender_section.sql) that shares Blender's data shape —
    // which is why the pre-existing isBlenderSection() accepts both. Omitting it
    // would send it down the Sieving fallback.
    expect(sectionKindFor('smallblender')).toBe('blender')
  })

  it('covers exactly the real section ids', () => {
    // Must stay in step with SECTION_MODE in lib/production/capture-config.ts.
    expect(Object.keys(SECTION_KIND).sort()).toEqual(
      ['blender', 'granule', 'pasteuriser', 'refining1', 'refining2', 'sieving', 'smallblender'],
    )
  })

  it('falls back to sieving on an unknown id rather than throwing', () => {
    // Throwing during render would blank an operator's capture screen.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(sectionKindFor('packaging')).toBe('sieving')
    expect(err).toHaveBeenCalledOnce()
    expect(err.mock.calls[0][0]).toContain('packaging')
  })

  it('logs loudly on the fallback so it surfaces on staging', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    sectionKindFor('')
    expect(err).toHaveBeenCalled()
    expect(err.mock.calls[0][0]).toContain('SECTION_KIND')
  })
})

describe('isSectionId', () => {
  it('recognises real ids and rejects others', () => {
    expect(isSectionId('refining2')).toBe(true)
    expect(isSectionId('packaging')).toBe(false)
    // Must not be fooled by inherited Object properties.
    expect(isSectionId('toString')).toBe(false)
    expect(isSectionId('constructor')).toBe(false)
  })
})

describe('assertNever', () => {
  it('throws, naming the unhandled value', () => {
    expect(() => assertNever('packaging' as never, 'section kind'))
      .toThrow(/Unhandled section kind: "packaging"/)
  })
})
