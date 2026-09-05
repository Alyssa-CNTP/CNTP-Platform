import { getAdminClient } from '@/lib/auth/server-helpers'

/**
 * Shared helpers for the Pasteuriser label routes.
 *
 * ── Why one cast lives here ────────────────────────────────────────────────
 *
 * `lib/supabase/database.types.ts` is generated from the schema and does not
 * know about the label tables (they arrive in migration 20260905_001). Every
 * query against them therefore needs an escape hatch.
 *
 * The choice is between one narrow, named, explained cast reused by five route
 * handlers, or thirty `as any` scattered through them. ARCHITECTURE.md §1A
 * blames exactly the second pattern — 57 `as any` casts in the capture screen —
 * for "the compiler being switched off exactly where it would have caught the
 * problem". Concentrating it means there is one line to delete when the types
 * are regenerated, and the rest of each handler stays honestly typed.
 *
 * This is NOT the §4 rule about casting across a section boundary. Nothing here
 * launders one section's data into another's shape; it is an untyped external
 * schema, which is a different and much smaller problem.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedSupabase = any

/** The admin client, untyped for the label tables. See the note above. */
export function labelDb(): UntypedSupabase {
  return getAdminClient()
}

/** JSON request bodies arrive untrusted and unshaped. */
export type Body = Record<string, unknown>

/** Parse a request body, or null when it is not JSON at all. */
export async function readBody(req: Request): Promise<Body | null> {
  try {
    const parsed = await req.json()
    return parsed && typeof parsed === 'object' ? parsed as Body : {}
  } catch {
    return null
  }
}

/** A trimmed string field, or '' when absent or not a string. */
export function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** A trimmed string field, or null when it would be empty. */
export function strOrNull(v: unknown): string | null {
  const s = str(v)
  return s === '' ? null : s
}

/** A positive integer field, or null. */
export function posInt(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/** Postgres unique-violation. Used to turn a race into a clear message. */
export function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23505'
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
