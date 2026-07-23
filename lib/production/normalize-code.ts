/**
 * lib/production/normalize-code.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Central capitalisation / normalisation for lot numbers, batch numbers and
 * serials.
 *
 * Historically each capture form up-cased its own fields on `onChange`
 * (BatchKeypadField, the Blender scan modal, etc.), so a value entered through
 * a path that FORGOT to up-case — or written programmatically — could land in
 * the database in a different case from the same code entered elsewhere. Two
 * spellings of one lot ("gs-0271" vs "GS-0271") then read as two different
 * lots, which quietly breaks traceability lookups and "was this consumed?"
 * checks that compare strings exactly.
 *
 * `upperCode` is the one function every WRITE path can funnel lot/batch/serial
 * values through so the stored form is always consistent, regardless of which
 * UI field (or none) produced it. It is deliberately conservative: trims outer
 * whitespace and up-cases, nothing else — it never rewrites the internal shape
 * of a code, so it is safe to apply blindly at the persistence layer.
 */

/** Trim + upper-case a code, preserving null/empty as-is. */
export function upperCode<T extends string | null | undefined>(v: T): T {
  if (v == null) return v
  const s = String(v).trim()
  return (s ? s.toUpperCase() : s) as T
}

/** Up-case every truthy value in a list of codes (nulls/blanks pass through). */
export function upperCodes(values: (string | null | undefined)[]): (string | null | undefined)[] {
  return values.map(upperCode)
}
