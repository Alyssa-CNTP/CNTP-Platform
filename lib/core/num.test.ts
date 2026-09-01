import { describe, it, expect } from 'vitest'
import { n } from './num'

/**
 * CHARACTERISATION TESTS.
 *
 * These pin what the 12 duplicated copies of `n()` did BEFORE extraction, so
 * that replacing them one call site at a time cannot change what any capture
 * screen computes. If one of these fails after a refactor, the refactor changed
 * behaviour — that is the signal, not a test to relax.
 *
 * Where a case looks wrong (see "quirks" below), it is still pinned. Fixing it
 * is a separate, deliberate change with its own test update and its own deploy.
 */
describe('n() — operator numeric input', () => {
  it('parses plain decimals', () => {
    expect(n('12.5')).toBe(12.5)
    expect(n('0.25')).toBe(0.25)
    expect(n('900')).toBe(900)
  })

  it('accepts a decimal comma from the tablet keypad', () => {
    expect(n('12,5')).toBe(12.5)
    expect(n('0,25')).toBe(0.25)
  })

  it('returns 0 for empty and unparseable input', () => {
    expect(n('')).toBe(0)
    expect(n('   ')).toBe(0)
    expect(n('abc')).toBe(0)
    expect(n('-')).toBe(0)
  })

  it('returns 0 for null and undefined', () => {
    // Both historic variants — String(v) and String(v ?? '') — landed on 0 here,
    // which is why they could be collapsed into one function.
    expect(n(null)).toBe(0)
    expect(n(undefined)).toBe(0)
  })

  it('accepts numbers as well as strings', () => {
    expect(n(7)).toBe(7)
    expect(n(7.5)).toBe(7.5)
    expect(n(0)).toBe(0)
    expect(n(NaN)).toBe(0)
  })

  it('handles negatives and surrounding whitespace', () => {
    expect(n('-5')).toBe(-5)
    expect(n('  5  ')).toBe(5)
    expect(n('-2,5')).toBe(-2.5)
  })

  it('takes the leading number and ignores a trailing unit', () => {
    // Operators sometimes type "25kg". parseFloat stops at the first non-numeric
    // character rather than rejecting the whole value.
    expect(n('25kg')).toBe(25)
    expect(n('12.5 kg')).toBe(12.5)
  })

  // ── Pinned quirks ─────────────────────────────────────────────────────────
  // Current behaviour, deliberately preserved. See the doc comment on n().

  it('QUIRK: replaces only the first comma, so thousands separators mis-parse', () => {
    // '1,234' is a thousands-separated 1234 to a human, but becomes '1.234'.
    // Safe today only because per-bag weights never reach 1000.
    expect(n('1,234')).toBe(1.234)
    expect(n('1,234,567')).toBe(1.234)
  })

  it('QUIRK: cannot distinguish a genuine zero from unparseable input', () => {
    // `|| 0` collapses both. Callers needing "empty vs zero" must check the raw
    // string — this is why some screens keep the text value alongside the number.
    expect(n('0')).toBe(0)
    expect(n('nonsense')).toBe(0)
  })

  it('QUIRK: accepts exponent notation', () => {
    expect(n('1e3')).toBe(1000)
  })
})
