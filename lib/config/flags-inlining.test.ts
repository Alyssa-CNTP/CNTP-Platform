import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Flags must be readable in the BROWSER, and that is a property of how the
 * source is written, not of what it computes.
 *
 * Next replaces `process.env.NEXT_PUBLIC_FOO` with a literal at build time by
 * matching the static member access in the source text. `process.env[name]`
 * cannot be replaced — the key is only known at runtime — and in the client
 * bundle `process` is a polyfill whose `env` is `{}`. So a dynamic lookup
 * compiles to `{}[name]` → `undefined` → the fallback.
 *
 * That is exactly what this file used to do, and the consequence was total and
 * silent: **every flag was stuck at its fallback in the browser**, on every
 * environment, for as long as the file had existed. Setting a flag on staging
 * and rebuilding changed nothing, and nothing reported a problem. It surfaced
 * only by grepping the built bundle:
 *
 *     NEXT_PUBLIC_SUPABASE_URL       name absent, value inlined   ← static, works
 *     NEXT_PUBLIC_FF_PASTEURISER_LABELS  name present as a string ← dynamic, dead
 *
 * A unit test cannot catch this by calling `flags` — under vitest, Node has a
 * real `process.env`, so the broken form passes. The bug lives in the emitted
 * bundle, so the source is what has to be asserted.
 *
 * This is the same tactic as boundary-rule.test.ts: prove the guard still
 * bites, rather than trusting that it does.
 */

const flagsPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'flags.ts',
)
const source = fs.readFileSync(flagsPath, 'utf8')

/** The file minus its comments — the comments discuss the broken form. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')

describe('feature flags reach the browser', () => {
  it('never reads process.env with a computed key', () => {
    // `process.env[` — the form Next cannot inline.
    expect(code).not.toMatch(/process\s*\.\s*env\s*\[/)
  })

  it('reads every flag through a static NEXT_PUBLIC_ member access', () => {
    const declared = [...code.matchAll(/^\s{2}(\w+):\s*(envFlag|sectionSetFlag)\(/gm)]
      .map(m => m[1])
    // Guard the guard: if the flags object is restructured so this regex stops
    // matching, the test must fail rather than vacuously pass.
    expect(declared.length).toBeGreaterThanOrEqual(6)

    const staticReads = [...code.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)]
    expect(staticReads.length).toBe(declared.length)
  })

  it('passes the value to the helpers, never the name', () => {
    // A string literal argument means someone reintroduced the name-based form.
    expect(code).not.toMatch(/(envFlag|sectionSetFlag)\(\s*['"`]/)
  })

  it('every env var it reads is NEXT_PUBLIC_, or the browser cannot see it', () => {
    for (const [, name] of code.matchAll(/process\.env\.(\w+)/g)) {
      expect(name, `${name} is not exposed to the browser`).toMatch(/^NEXT_PUBLIC_/)
    }
  })
})

describe('the helpers themselves', () => {
  it('treats unset and empty as "use the fallback", not as false', async () => {
    const { flags } = await import('./flags')
    // changeover defaults TRUE and nothing sets it in test, so an unset var
    // must yield the fallback rather than a blanket false. This is the
    // silent-latch case called out in its own comment: a wrong answer here
    // removes a control supervisors use, with nothing in the logs.
    expect(flags.changeover).toBe(true)
  })

  it('defaults the rest to off', async () => {
    const { flags } = await import('./flags')
    expect(flags.supervisorAdjustments).toBe(false)
    expect(flags.ledgerAuthoritative).toBe(false)
  })
})
