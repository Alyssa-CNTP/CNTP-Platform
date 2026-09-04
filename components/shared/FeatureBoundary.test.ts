import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import FeatureBoundary from './FeatureBoundary'

/**
 * The crash guard from ARCHITECTURE.md §3, exercised.
 *
 * It had zero usages and zero tests, which is the same problem the boundary lint
 * rule had: a safety mechanism nobody has ever seen work. The load-bearing part
 * is `getDerivedStateFromError` being a STATIC on a CLASS — that is the entire
 * reason React treats this component as an error boundary. Convert it to a
 * function component, or lose the static in a refactor, and it silently stops
 * catching anything while still rendering its children perfectly.
 *
 * No DOM here on purpose. React elements are plain objects, so the component's
 * contract can be checked directly and the unit suite stays node-only
 * (vitest.config.mts). Whether React *invokes* an error boundary is React's
 * responsibility, not ours; that it IS one, and what it renders, is ours.
 */

function render(props: { name: string; silent?: boolean; fallback?: React.ReactNode }, error: Error | null) {
  const instance = new FeatureBoundary({ ...props, children: 'CAPTURE CONTENT' })
  instance.state = { error }
  return instance.render()
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

describe('it is actually an error boundary', () => {
  it('exposes getDerivedStateFromError as a static', () => {
    // If this disappears, the component still renders and still looks fine, and
    // every feature it wraps quietly loses its containment.
    expect(typeof (FeatureBoundary as unknown as { getDerivedStateFromError?: unknown })
      .getDerivedStateFromError).toBe('function')
  })

  it('moves a thrown error into state rather than swallowing it', () => {
    const err = new Error('feature exploded')
    expect(FeatureBoundary.getDerivedStateFromError(err)).toEqual({ error: err })
  })

  it('is a class component — a function component cannot catch', () => {
    expect(FeatureBoundary.prototype).toBeInstanceOf(React.Component)
  })
})

describe('what the operator sees', () => {
  it('renders the feature untouched when nothing has thrown', () => {
    expect(render({ name: 'Supervisor adjustments' }, null)).toBe('CAPTURE CONTENT')
  })

  it('replaces a crashed feature with a notice, naming it', () => {
    const out = render({ name: 'Supervisor adjustments' }, new Error('boom')) as React.ReactElement
    expect(out).not.toBe('CAPTURE CONTENT')
    expect(JSON.stringify(out)).toContain('Supervisor adjustments')
  })

  it('reassures that capture itself is unaffected', () => {
    // The wording matters: an operator mid-shift needs to know their session is
    // intact, not just that something broke.
    const out = render({ name: 'Line chat' }, new Error('boom'))
    expect(JSON.stringify(out)).toMatch(/capture is unaffected/i)
  })

  it('renders nothing at all when silent', () => {
    expect(render({ name: 'Decorative panel', silent: true }, new Error('boom'))).toBe(null)
  })

  it('silent still renders the feature normally when it has not thrown', () => {
    expect(render({ name: 'Decorative panel', silent: true }, null)).toBe('CAPTURE CONTENT')
  })
})

describe('the crash is reported', () => {
  it('logs rather than hiding it', () => {
    // Silent containment would mean a feature broken on staging reaches the floor
    // with nobody having seen an error.
    const instance = new FeatureBoundary({ name: 'Supervisor adjustments', children: null })
    instance.componentDidCatch(new Error('boom'), { componentStack: '' } as React.ErrorInfo)
    expect(console.error).toHaveBeenCalled()
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain('Supervisor adjustments')
  })
})

describe('a section mount needs its own fallback', () => {
  /**
   * The default notice tells the operator "your capture is unaffected". For a
   * decorative side panel that is true. For the section capture component — the
   * form they enter bags into — it is exactly wrong, and the capture screen
   * mounts one of five of those. Hence the `fallback` prop.
   */
  it('renders the given fallback instead of the default notice', () => {
    const out = render(
      { name: 'Sieving Tower capture', fallback: 'ASK YOUR SUPERVISOR' },
      new Error('boom'),
    ) as React.ReactElement
    // A fragment wrapping the caller's node, not the built-in red box.
    expect(out).not.toBe(null)
    expect(JSON.stringify(out)).toContain('ASK YOUR SUPERVISOR')
    expect(JSON.stringify(out)).not.toContain('your capture is unaffected')
  })

  it('still renders the children when nothing has thrown', () => {
    expect(render({ name: 'Sieving Tower capture', fallback: 'ASK YOUR SUPERVISOR' }, null))
      .toBe('CAPTURE CONTENT')
  })

  it('silent beats fallback — an explicit "show nothing" is not overridden', () => {
    expect(render({ name: 'x', silent: true, fallback: 'SHOULD NOT APPEAR' }, new Error('boom')))
      .toBe(null)
  })
})
