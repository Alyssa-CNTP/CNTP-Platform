import { describe, it, expect, vi } from 'vitest'
import { ESLint } from 'eslint'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Booting ESLint is slow — seconds, not milliseconds — and these tests do it for
// real rather than mocking the rule they exist to prove still bites. Vitest's
// 5s default is a limit on TEST logic, and under a loaded worker pool ESLint's
// startup alone exceeds it, so the suite went red for a reason that had nothing
// to do with the rules. The timeout is raised here rather than globally: every
// other test in this repo is pure and should stay on a tight default.
vi.setConfig({ testTimeout: 30_000 })

/**
 * The Core/Feature boundary is the architecture's only hard CI gate
 * (ARCHITECTURE.md §2). Everything else about the split is convention; this rule
 * is the part a machine enforces.
 *
 * Nobody had ever seen it fail. A lint rule that has never rejected anything is
 * indistinguishable from a lint rule that matches nothing — a typo'd glob, a
 * config that silently stopped being loaded, a rule downgraded to `warn` during
 * some unrelated cleanup. These tests make it fail on purpose, so we know it
 * still bites.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function lint() {
  return new ESLint({
    cwd: repoRoot,
    overrideConfigFile: path.join(repoRoot, 'eslint.boundaries.mjs'),
  })
}

/** Error-level messages ESLint reports for `source`, as if it were at `filePath`. */
async function errorsFor(filePath: string, source: string): Promise<string[]> {
  const [result] = await lint().lintText(source, { filePath: path.join(repoRoot, filePath) })
  return (result?.messages ?? []).filter(m => m.severity === 2).map(m => m.message)
}

describe('lib/core may not import from features/', () => {
  it('rejects it, at error severity', async () => {
    const errs = await errorsFor('lib/core/fixture.ts', `
      import { resolveItem } from '@/features/acumatica-items'
      export const x = resolveItem
    `)
    expect(errs.join('\n')).toMatch(/must not import from features/i)
  })

  it('rejects a relative path to a feature too', async () => {
    // The rule has to catch the shape, not one spelling of it.
    const errs = await errorsFor('lib/core/fixture.ts', `
      import { thing } from '../../features/acumatica-items/resolve'
      export const x = thing
    `)
    expect(errs.length).toBeGreaterThan(0)
  })
})

describe('lib/core may not import app, React or Next', () => {
  it('rejects an app import', async () => {
    const errs = await errorsFor('lib/core/fixture.ts', `
      import { thing } from '@/app/(app)/production/capture/thing'
      export const x = thing
    `)
    expect(errs.join('\n')).toMatch(/must not import from app/i)
  })

  it('rejects React — core is pure logic', async () => {
    const errs = await errorsFor('lib/core/fixture.ts', `
      import { useState } from 'react'
      export const x = useState
    `)
    expect(errs.join('\n')).toMatch(/pure logic/i)
  })
})

describe('lib/core may not perform I/O', () => {
  it('rejects a supabase import', async () => {
    const errs = await errorsFor('lib/core/fixture.ts', `
      import { getDb } from '@/lib/supabase/db'
      export const x = getDb
    `)
    expect(errs.join('\n')).toMatch(/must not perform I\/O/i)
  })

  it('allows it under lib/core/ledger, which owns ledger access', async () => {
    // The one documented exemption (ARCHITECTURE.md §2). It is tested because an
    // exemption that stops working is a rule that silently got stricter, and an
    // exemption that over-applies is a hole. Note lib/core/ledger does not exist
    // yet — it arrives in Phase 4 — so this pins the rule ahead of the code.
    const errs = await errorsFor('lib/core/ledger/fixture.ts', `
      import { getDb } from '@/lib/supabase/db'
      export const x = getDb
    `)
    expect(errs).toEqual([])
  })

  it('still forbids features and React inside lib/core/ledger', async () => {
    const errs = await errorsFor('lib/core/ledger/fixture.ts', `
      import { resolveItem } from '@/features/acumatica-items'
      export const x = resolveItem
    `)
    expect(errs.length).toBeGreaterThan(0)
  })
})

describe('what the rule must NOT reject', () => {
  it('lets core import core', async () => {
    const errs = await errorsFor('lib/core/fixture.ts', `
      import { n } from '@/lib/core/num'
      export const x = n
    `)
    expect(errs).toEqual([])
  })

  it('lets a feature import core — the whole point of the boundary', async () => {
    const errs = await errorsFor('features/acumatica-items/fixture.ts', `
      import { canonicalProductType } from '@/lib/core/product-names'
      export const x = canonicalProductType
    `)
    expect(errs).toEqual([])
  })

  it('lets a feature import lib/production and supabase', async () => {
    // Features are allowed to do I/O; only core is not.
    const errs = await errorsFor('features/acumatica-items/fixture.ts', `
      import { getDb } from '@/lib/supabase/db'
      export const x = getDb
    `)
    expect(errs).toEqual([])
  })

  it('stops a feature deep-importing another feature past its index', async () => {
    const errs = await errorsFor('features/supervisor-adjustments/fixture.ts', `
      import { resolveItem } from '@/features/acumatica-items/resolve'
      export const x = resolveItem
    `)
    expect(errs.join('\n')).toMatch(/index\.ts only/i)
  })
})
