/**
 * Numeric parsing for operator-typed input.
 *
 * Extracted from 12 byte-identical copies across the capture components
 * (BlenderCapture, GranuleCapture, PasteuriserCapture, RefiningCapture,
 * SievingCapture, CaptureOverview, OutputPicker, ShiftBagLog,
 * HalfBagTopUpModal, RebagModal, [section]/page.tsx, shift-report-builder).
 * Two of those copies were added recently, so the duplication was still
 * spreading — see ARCHITECTURE.md §1A.
 *
 * Behaviour is preserved EXACTLY as it was in those copies. It is pinned by
 * num.test.ts. Do not "improve" it here without changing the tests
 * deliberately: several capture screens depend on the current edge cases,
 * including the comma quirk documented below.
 */

/**
 * Parse an operator-typed value into a number, returning 0 for anything
 * unparseable. Accepts a decimal comma (`'1,5'` → `1.5`) because the factory
 * tablets are set to a locale where the numeric keypad emits a comma.
 *
 * Known quirk, preserved deliberately: only the FIRST comma is replaced, so a
 * thousands-separated string does not parse as a whole number —
 * `n('1,234')` is `1.234`, not `1234`. No capture screen currently types
 * thousands separators (weights are per-bag, well under 1000 kg), so this has
 * never bitten. It is pinned by a test rather than silently fixed, because
 * changing it would alter what every existing screen computes.
 *
 * Returns 0 for `null`, `undefined`, empty string, and non-numeric text.
 * Note this means a genuine 0 and an unparseable value are indistinguishable —
 * callers that need to tell "empty" from "zero" must check the raw string.
 */
export function n(v: unknown): number {
  return parseFloat(String(v).replace(',', '.')) || 0
}
