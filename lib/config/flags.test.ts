import { describe, it, expect, vi, afterEach } from 'vitest'

// The rollout gate for the serial scheme. A boolean could not express the
// flag's own contract ("rolled out one section at a time"), and serials are
// printed onto physical bags — a bad rollout is not undone by reverting code.

const KEY = 'NEXT_PUBLIC_FF_DB_SERIAL_ALLOCATION'
const original = process.env[KEY]

afterEach(() => {
  if (original === undefined) delete process.env[KEY]
  else process.env[KEY] = original
  vi.resetModules()
})

// Flags are read at module load, so each case needs a fresh module.
async function usesDbSerialsWith(value: string | undefined) {
  if (value === undefined) delete process.env[KEY]
  else process.env[KEY] = value
  vi.resetModules()
  const mod = await import('./flags')
  return mod.usesDbSerials
}

describe('serial rollout flag', () => {
  it('defaults to no section — the new format ships dark', async () => {
    const usesDbSerials = await usesDbSerialsWith(undefined)
    for (const s of ['sieving', 'granule', 'refining1', 'refining2', 'blender', 'smallblender']) {
      expect(usesDbSerials(s), s).toBe(false)
    }
  })

  it('enables exactly the sections listed, one at a time', async () => {
    const usesDbSerials = await usesDbSerialsWith('sieving')
    expect(usesDbSerials('sieving')).toBe(true)
    expect(usesDbSerials('granule')).toBe(false)
  })

  it('takes a comma-separated list, tolerating spaces and case', async () => {
    const usesDbSerials = await usesDbSerialsWith(' Sieving , granule ')
    expect(usesDbSerials('sieving')).toBe(true)
    expect(usesDbSerials('granule')).toBe(true)
    expect(usesDbSerials('blender')).toBe(false)
  })

  it('rolls the two Refining lines out separately', async () => {
    const usesDbSerials = await usesDbSerialsWith('refining1')
    expect(usesDbSerials('refining1')).toBe(true)
    expect(usesDbSerials('refining2')).toBe(false)
  })

  it('keeps the two blenders independent', async () => {
    const usesDbSerials = await usesDbSerialsWith('blender')
    expect(usesDbSerials('blender')).toBe(true)
    expect(usesDbSerials('smallblender')).toBe(false)
  })

  it('accepts all, and the old boolean spellings as synonyms for it', async () => {
    // An environment already set to the previous boolean form must not
    // silently come to mean "no sections" now that the shape has changed.
    for (const v of ['all', 'true', '1']) {
      const usesDbSerials = await usesDbSerialsWith(v)
      expect(usesDbSerials('sieving'), v).toBe(true)
      expect(usesDbSerials('smallblender'), v).toBe(true)
    }
  })
})
