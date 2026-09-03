import { describe, it, expect } from 'vitest'
import { formatMeshConfig, parseMeshConfig, isCanonicalMeshConfig, MESH_DECKS } from './mesh'

describe('formatMeshConfig — the app types the #, not the operator', () => {
  it('writes the three decks top-down', () => {
    expect(formatMeshConfig(['12', '14', '16'])).toBe('#12 / #14 / #16')
  })

  it('does not double up a # the operator typed anyway', () => {
    expect(formatMeshConfig(['#12', '14', '#16'])).toBe('#12 / #14 / #16')
    expect(formatMeshConfig(['##12', '14', '16'])).toBe('#12 / #14 / #16')
  })

  it('trims what was typed', () => {
    expect(formatMeshConfig([' 12 ', '14', ' 16'])).toBe('#12 / #14 / #16')
  })

  it('keeps a blank deck in position rather than collapsing the list', () => {
    // '#12 / #16' would read as a two-deck machine, and there is no way to tell
    // afterwards which deck was left out.
    expect(formatMeshConfig(['12', '', '16'])).toBe('#12 / — / #16')
    expect(formatMeshConfig(['', '14', ''])).toBe('— / #14 / —')
  })

  it('is empty only when nothing was filled in at all', () => {
    expect(formatMeshConfig(['', '', ''])).toBe('')
    expect(formatMeshConfig([])).toBe('')
    expect(formatMeshConfig([null, undefined, ''])).toBe('')
    expect(formatMeshConfig(['12', '', ''])).not.toBe('')
  })

  it('preserves a non-integer designation as typed', () => {
    expect(formatMeshConfig(['12', '3.5', '16'])).toBe('#12 / #3.5 / #16')
  })
})

describe('parseMeshConfig — restores every shape the free-text box accepted', () => {
  it.each([
    ['#12 / #14 / #16', ['12', '14', '16']],
    ['12/14/16',        ['12', '14', '16']],
    ['#12 #14 #16',     ['12', '14', '16']],
    ['12, 14, 16',      ['12', '14', '16']],
    ['top 12 mid 14 bottom 16', ['12', '14', '16']],
  ])('%s', (stored, expected) => {
    expect(parseMeshConfig(stored)).toEqual(expected)
  })

  it('always returns one entry per deck, so callers can index without checking', () => {
    for (const stored of ['', '#12', '#12 / #14', '#12 / #14 / #16', null, undefined]) {
      expect(parseMeshConfig(stored)).toHaveLength(MESH_DECKS.length)
    }
  })

  it('leaves absent decks blank', () => {
    expect(parseMeshConfig('#12')).toEqual(['12', '', ''])
    expect(parseMeshConfig('')).toEqual(['', '', ''])
  })

  it('round-trips anything this module wrote', () => {
    for (const sizes of [['12','14','16'], ['8','10','12'], ['12','','16'], ['','','']]) {
      expect(formatMeshConfig(parseMeshConfig(formatMeshConfig(sizes)))).toBe(formatMeshConfig(sizes))
    }
  })
})

describe('isCanonicalMeshConfig — can this old value go in the three boxes?', () => {
  it('accepts what this module writes, and blank', () => {
    expect(isCanonicalMeshConfig('#12 / #14 / #16')).toBe(true)
    expect(isCanonicalMeshConfig('#12 / — / #16')).toBe(true)
    expect(isCanonicalMeshConfig('')).toBe(true)
  })

  it('rejects free text, so the operator is shown what was really recorded', () => {
    expect(isCanonicalMeshConfig('top 12 mid 14 bottom 16')).toBe(false)
    expect(isCanonicalMeshConfig('12/14/16')).toBe(false)
    expect(isCanonicalMeshConfig('standard config')).toBe(false)
  })
})
