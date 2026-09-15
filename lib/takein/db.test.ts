import { describe, it, expect } from 'vitest'
import { errMsg, visibleSites, scopedSites } from './db'

// A PostgrestError as supabase-js actually throws it: a plain object, NOT an
// Error instance. The original errMsg tested `instanceof Error`, so every one
// of these fell through to the generic fallback and the real diagnosis — the
// PGRST code — never reached the screen.
describe('errMsg', () => {
  it('carries a PostgrestError through, code included', () => {
    const e = { message: 'The schema must be one of the following: public, production',
                details: null, hint: null, code: 'PGRST106' }
    const out = errMsg(e, 'Could not load contracts.')
    expect(out).toContain('The schema must be one of the following')
    expect(out).toContain('PGRST106')
    expect(out).not.toBe('Could not load contracts.')
  })

  it('still reads a real Error', () => {
    expect(errMsg(new Error('boom'), 'fallback')).toBe('boom')
  })

  it('includes the hint when one is given', () => {
    const out = errMsg({ message: 'no relation', hint: 'did you mean contracts?' }, 'fallback')
    expect(out).toContain('no relation')
    expect(out).toContain('did you mean contracts?')
  })

  it('keeps the fallback visible when the error carries only a code', () => {
    expect(errMsg({ code: 'PGRST301' }, 'Could not load.')).toBe('Could not load. — [PGRST301]')
  })

  it('falls back on a thrown value with nothing usable', () => {
    expect(errMsg(null, 'fallback')).toBe('fallback')
    expect(errMsg(undefined, 'fallback')).toBe('fallback')
    expect(errMsg({}, 'fallback')).toBe('fallback')
    expect(errMsg('   ', 'fallback')).toBe('fallback')
  })

  it('takes a plain string', () => {
    expect(errMsg('just this', 'fallback')).toBe('just this')
  })
})

// Empty means EVERY depot. That is what makes Blackheath and Management work
// without enumerating depots, and it is the rule most likely to be "tidied"
// into a deny-by-default that silently blanks their dashboard.
describe('visibleSites', () => {
  const sites = [
    { code: 'GD' }, { code: 'VD' }, { code: 'BH' },
  ] as unknown as Parameters<typeof visibleSites>[0]

  it('shows every site when the user is scoped to none', () => {
    expect(visibleSites(sites, []).map((d: { code: string }) => d.code)).toEqual(['GD', 'VD', 'BH'])
    expect(visibleSites(sites, undefined).map((d: { code: string }) => d.code)).toEqual(['GD', 'VD', 'BH'])
  })

  it('narrows to the codes the user holds', () => {
    expect(visibleSites(sites, ['GD']).map((d: { code: string }) => d.code)).toEqual(['GD'])
  })

  it('ignores blank codes rather than treating them as a scope', () => {
    expect(visibleSites(sites, ['', '  ']).map((d: { code: string }) => d.code)).toEqual(['GD', 'VD', 'BH'])
  })
})

// Reached from a site's page in Warehousing (`?site=GD`). It must NARROW and
// never widen: a hand-typed query string is not a grant.
describe('scopedSites', () => {
  const sites = [
    { code: 'GD' }, { code: 'VD' }, { code: 'GT' },
  ] as unknown as Parameters<typeof scopedSites>[0]

  it('narrows to the requested site', () => {
    expect(scopedSites(sites, [], 'GD').map((d: { code: string }) => d.code)).toEqual(['GD'])
  })

  it('ignores case and surrounding space', () => {
    expect(scopedSites(sites, [], ' gd ').map((d: { code: string }) => d.code)).toEqual(['GD'])
  })

  it('REFUSES to widen past what the user is scoped to', () => {
    // A Graafwater clerk hand-typing ?site=VD must not reach Vanrhynsdorp.
    expect(scopedSites(sites, ['GD'], 'VD').map((d: { code: string }) => d.code)).toEqual(['GD'])
  })

  it('leaves the scope alone for an absent or unknown code', () => {
    expect(scopedSites(sites, [], null).map((d: { code: string }) => d.code)).toEqual(['GD', 'VD', 'GT'])
    expect(scopedSites(sites, [], 'ZZ').map((d: { code: string }) => d.code)).toEqual(['GD', 'VD', 'GT'])
    expect(scopedSites(sites, [], '').map((d: { code: string }) => d.code)).toEqual(['GD', 'VD', 'GT'])
  })
})
