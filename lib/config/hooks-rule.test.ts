import { describe, it, expect, vi } from 'vitest'
import { ESLint } from 'eslint'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The Rules of Hooks gate (`npm run lint:hooks`, eslint.hooks.mjs).
 *
 * ── The incident ────────────────────────────────────────────────────────────
 *
 * On 2026-09-01 a `useMemo` landed below the render gates in
 * app/(app)/production/capture/[section]/page.tsx. The gates return early while
 * `loading` is true, so the first render called N hooks and the second called
 * N+1 — React error #310, "Rendered more hooks than during the previous
 * render". The capture screen showed "This page couldn't load" for every
 * section that had an assignment, which is to say whenever capture would
 * otherwise have worked. It stayed broken for two days.
 *
 * `react-hooks/rules-of-hooks` was already enabled and DID report it, at the
 * exact line. Nothing happened, because the full lint is a ratchet over ~3,000
 * pre-existing errors and one more does not move a baseline anyone reads.
 *
 * So the rule now has its own config, its own script and a hard zero in CI —
 * the same treatment the Core/Feature boundary gets. These tests exist because
 * a gate nobody has watched fail is a gate nobody knows works; the last one
 * was on the whole time and still let a page-killer through.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function lint() {
  return new ESLint({
    cwd: repoRoot,
    overrideConfigFile: path.join(repoRoot, 'eslint.hooks.mjs'),
  })
}

async function errorsFor(source: string, filePath = 'app/(app)/fixture/page.tsx'): Promise<string[]> {
  const [result] = await lint().lintText(source, { filePath: path.join(repoRoot, filePath) })
  return (result?.messages ?? []).filter(m => m.severity === 2).map(m => m.message)
}

/** The exact shape that broke capture: a hook below an early return. */
const HOOK_AFTER_EARLY_RETURN = `
'use client'
import { useState, useMemo } from 'react'
export default function Screen({ loading }: { loading: boolean }) {
  const [n] = useState(0)
  if (loading) return null
  const doubled = useMemo(() => n * 2, [n])
  return <div>{doubled}</div>
}
`

describe('the gate catches what took capture down', () => {
  it('rejects a hook called after an early return', async () => {
    const errs = await errorsFor(HOOK_AFTER_EARLY_RETURN)
    expect(errs.join('\n')).toMatch(/called conditionally/i)
  })

  it('names the early return in the message, so the fix is obvious', async () => {
    const errs = await errorsFor(HOOK_AFTER_EARLY_RETURN)
    expect(errs.join('\n')).toMatch(/early return/i)
  })

  it('rejects a hook inside a condition', async () => {
    const errs = await errorsFor(`
'use client'
import { useState, useEffect } from 'react'
export default function Screen({ on }: { on: boolean }) {
  const [n] = useState(0)
  if (on) { useEffect(() => { console.log(n) }, [n]) }
  return <div>{n}</div>
}
`)
    expect(errs.length).toBeGreaterThan(0)
  })

  it('cannot be silenced by an inline disable comment', async () => {
    // noInlineConfig in eslint.hooks.mjs. Rules of Hooks has no legitimate
    // per-line exception, and a gate that a comment can switch off is not one.
    const errs = await errorsFor(`
'use client'
import { useState, useMemo } from 'react'
export default function Screen({ loading }: { loading: boolean }) {
  const [n] = useState(0)
  if (loading) return null
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const doubled = useMemo(() => n * 2, [n])
  return <div>{doubled}</div>
}
`)
    expect(errs.join('\n')).toMatch(/called conditionally/i)
  })
})

describe('what the gate must NOT reject', () => {
  it('accepts hooks above the early return — the fix', async () => {
    const errs = await errorsFor(`
'use client'
import { useState, useMemo } from 'react'
export default function Screen({ loading }: { loading: boolean }) {
  const [n] = useState(0)
  const doubled = useMemo(() => n * 2, [n])
  if (loading) return null
  return <div>{doubled}</div>
}
`)
    expect(errs).toEqual([])
  })

  it('does not fire on a plain module with no React at all', async () => {
    const errs = await errorsFor(`
export function double(x: number) { return x * 2 }
export const y = double(2)
`, 'lib/production/fixture.ts')
    expect(errs).toEqual([])
  })

  it('DOES fire on a use-prefixed function called at module top level', async () => {
    // Not a false positive — the rule reads a use* name as a hook, which is the
    // convention it is built on. Worth pinning: it means naming a plain helper
    // `useX` and calling it outside a component fails this gate, and the fix is
    // to rename the helper rather than to weaken the rule.
    const errs = await errorsFor(`
export function useSomething(x: number) { return x * 2 }
export const y = useSomething(2)
`, 'lib/production/fixture.ts')
    expect(errs[0] ?? '').toMatch(/cannot be called at the top level/i)
  })

  it('reports nothing for exhaustive-deps, which is deliberately not in this gate', async () => {
    // Bundling exhaustive-deps here would make the gate unpassable against the
    // existing backlog, and an unpassable gate gets ignored — which is how the
    // ratchet failed in the first place.
    const errs = await errorsFor(`
'use client'
import { useState, useEffect } from 'react'

// Booting ESLint is slow — seconds, not milliseconds — and these tests do it for
// real rather than mocking the rule they exist to prove still bites. Vitest's
// 5s default is a limit on TEST logic, and under a loaded worker pool ESLint's
// startup alone exceeds it, so the suite went red for a reason that had nothing
// to do with the rules. The timeout is raised here rather than globally: every
// other test in this repo is pure and should stay on a tight default.
vi.setConfig({ testTimeout: 30_000 })
export default function Screen() {
  const [n, setN] = useState(0)
  useEffect(() => { setN(n + 1) }, [])
  return <div>{n}</div>
}
`)
    expect(errs).toEqual([])
  })
})
