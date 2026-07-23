// ══════════════════════════════════════════════════════════════════════════════
// lib/production/batch-key.ts
//
// Canonical batch/lot identity for the app layer. This is the TypeScript mirror
// of the SQL function production.normalize_batch(text) (migration
// 20260721_002_batch_spine.sql). The two MUST stay in sync — the app writes and
// reads batch keys with this function, and the DB backfills/joins with the SQL
// one, so any divergence silently breaks batch matching.
//
// Rules (deliberately conservative so distinct batches never merge):
//   • upper-case + trim
//   • collapse whitespace around hyphens:  "GS - 0098" -> "GS-0098"
//   • collapse any remaining whitespace runs to a single space
//   • empty / whitespace-only -> null
// ══════════════════════════════════════════════════════════════════════════════

export function normalizeBatch(input: string | null | undefined): string | null {
  if (input == null) return null
  const upper = String(input).trim().toUpperCase()
  if (upper === '') return null
  const normalized = upper
    .replace(/\s*-\s*/g, '-') // collapse spaces around hyphens
    .replace(/\s+/g, ' ') // collapse remaining whitespace runs
    .trim()
  return normalized === '' ? null : normalized
}

// True when two raw lot strings refer to the same canonical batch.
export function sameBatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeBatch(a)
  const nb = normalizeBatch(b)
  return na != null && na === nb
}
