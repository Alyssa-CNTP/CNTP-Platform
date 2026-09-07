import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Every custom colour utility must name a token that exists.
 *
 * ── Why this test exists ────────────────────────────────────────────────────
 *
 * The pasteuriser label pages shipped with `bg-primary text-white` on seven
 * buttons. There is no `--color-primary` in globals.css — the token is
 * `--color-brand`. Under Tailwind 4 an undefined token generates NO CSS, so
 * those buttons rendered as WHITE TEXT ON A WHITE CARD. They were not missing
 * and not disabled; they were invisible. The reported symptoms were "I cannot
 * see the buttons" and "I can't assign a PO anywhere" — a workflow that looked
 * broken because a control could not be found.
 *
 * NOTHING ELSE CATCHES THIS. It compiles, lints, typechecks and builds; every
 * test passes; the boundary rule has no opinion about CSS; the render smoke
 * tests render the button happily. The only detector was a person looking at
 * the screen and not seeing a button.
 *
 * ── How it is enforced ──────────────────────────────────────────────────────
 *
 * A hard gate over the pasteuriser label feature, which has been audited, plus
 * a RATCHET over the rest of the app — because the audit found the same fault
 * well outside this feature, and a hard gate there would fail immediately on
 * pages nobody has reviewed, which is how a test gets deleted instead of acted
 * on. Same convention the repo already uses for lint and types
 * (ARCHITECTURE.md §8).
 */

const REPO = process.cwd()

/** Tailwind 4's built-in palette, plus its non-palette colour keywords. */
const TAILWIND_COLOURS = new Set([
  'inherit', 'current', 'transparent', 'black', 'white',
  'slate', 'gray', 'grey', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
])

/**
 * Utilities sharing a prefix with a colour utility but taking something else —
 * `text-sm` is a size, `border-collapse` a table mode, `stroke-dasharray` an
 * SVG attribute. Without these the scan reports noise and gets ignored.
 */
const NON_COLOUR = new Set([
  'collapse', 'separate', 'box', 'content', 'clone', 'slice', 'in',
  'dasharray', 'dashoffset', 'color', 'inset', 'width', 'linecap', 'opacity',
  'xs', 'sm', 'base', 'md', 'lg', 'xl', 'none', 'left', 'center', 'right',
  'justify', 'start', 'end', 'top', 'bottom', 'wrap', 'nowrap', 'balance',
  'pretty', 'ellipsis', 'clip', 'solid', 'dashed', 'dotted', 'double',
  'hidden', 'inner', 'full', 'auto', 'px', 'x', 'y', 'r', 'l', 't', 'b',
  'se', 'inline',
])

// `shadow` is deliberately not scanned: shadows are --shadow-* tokens, not
// --color-*, so including it produces only false positives.
const PREFIXES = 'bg|text|border|ring|from|to|via|stroke|divide|outline|decoration|caret|accent'
const RE = new RegExp(
  '(?:^|[\\s"\'`])(?:[a-z-]+:)*(?:' + PREFIXES + ')-(?:[trblxyse]-)?([a-z][a-z0-9]*(?:-[a-z0-9]+)*)',
  'g',
)

const FEATURE_DIRS = ['app/(app)/pasteuriser', 'features/pasteuriser-labels']
const ALL_DIRS = ['app', 'components', 'features']

function definedTokens(): Set<string> {
  const css = readFileSync(join(REPO, 'app/globals.css'), 'utf8')
  const names = new Set<string>()
  for (const m of css.matchAll(/--color-([a-z0-9-]+)\s*:/g)) names.add(m[1])
  return names
}

function componentFiles(dirs: string[]): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let entries: string[]
    try { entries = readdirSync(d) } catch { return }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.tsx')) out.push(p)
    }
  }
  for (const d of dirs) walk(join(REPO, d))
  return out
}

describe('colour tokens', () => {
  const tokens = definedTokens()

  function scan(dirs: string[]): string[] {
    const offences: string[] = []
    for (const file of componentFiles(dirs)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(RE)) {
        const name = m[1]
        if (tokens.has(name)) continue
        const head = name.split('-')[0]
        if (TAILWIND_COLOURS.has(head)) continue
        if (NON_COLOUR.has(name) || NON_COLOUR.has(head)) continue
        const rel = relative(REPO, file).split('\\').join('/')
        offences.push(rel + ': ' + m[0].trim())
      }
    }
    return [...new Set(offences)].sort()
  }

  it('parses globals.css — otherwise every assertion below is vacuous', () => {
    expect(tokens.has('brand')).toBe(true)
    expect(tokens.has('surface-rule')).toBe(true)
    expect(tokens.size).toBeGreaterThan(20)
  })

  it('does not define `primary` — the token seven invisible buttons used', () => {
    expect(tokens.has('primary')).toBe(false)
  })

  it('finds components to scan', () => {
    expect(componentFiles(ALL_DIRS).length).toBeGreaterThan(100)
  })

  /** HARD GATE. This feature has been audited, so it gets zero tolerance. */
  it('the pasteuriser label feature has no undefined colour tokens', () => {
    const offences = scan(FEATURE_DIRS)
    expect(
      offences,
      'Undefined tokens generate NO css under Tailwind 4 — these render invisible:\n' +
        offences.join('\n'),
    ).toEqual([])
  })

  /**
   * RATCHET over everything else.
   *
   * The audit found the same class of fault across intelligence, sales,
   * marketing, count, admin and the shared Toast / ConfirmSheet / SignaturePad
   * components — `text-danger`, `bg-background`, `bg-brand-bg`,
   * `status-danger`, `status-error`. Each renders with no colour.
   *
   * LOWER THIS AS THEY ARE FIXED. NEVER RAISE IT.
   */
  const BASELINE = 35

  it('the rest of the app is no worse than the recorded baseline', () => {
    const feature = new Set(scan(FEATURE_DIRS))
    const rest = scan(ALL_DIRS).filter(o => !feature.has(o))
    if (rest.length > BASELINE) {
      throw new Error(
        'Undefined colour tokens rose to ' + rest.length +
          ', above the baseline of ' + BASELINE + ':\n' + rest.join('\n'),
      )
    }
    expect(
      rest.length,
      'Down to ' + rest.length + ' from ' + BASELINE + '. Lower BASELINE to bank it.',
    ).toBeGreaterThan(BASELINE - 8)
  })
})
