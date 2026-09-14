// Untyped Supabase client for direct DB operations.
// Used when the production schema types resolve to 'never' due to
// Supabase JS client schema inference limitations.
// Replace with generated types once `npx supabase gen types` is run.
import { getSupabaseClient } from './client'

// Untyped wrapper — use this for all database queries in the production schema
// The typed client resolves production schema tables to 'never', so we cast here
export function getDb() {
  return getSupabaseClient() as any
}

/**
 * The same client, re-pointed at `public`.
 *
 * ── Why this has to be asked for explicitly ────────────────────────────────
 *
 * `getSupabaseClient()` is constructed with `db: { schema: 'production' }`, so
 * `getDb().from('x')` resolves to `production.x` — NOT `public.x`. That is
 * correct for the capture tables and invisible for everything else, because a
 * table that is not in the pinned schema does not error in a way that reads
 * like a schema mistake. PostgREST answers:
 *
 *     404 PGRST205  Could not find the table 'production.job_cards_pasteuriser'
 *                   in the schema cache
 *
 * and an RPC answers the same way:
 *
 *     404 PGRST202  Could not find the function production.next_job_card_no
 *                   without parameters in the schema cache
 *
 * Both read exactly like a migration that was never applied, which is how the
 * Pasteuriser job card screen came to say "migration 20260729_003 must be
 * applied in this environment" against a staging database where it had been
 * applied all along. The job card tables, the label tables and
 * `next_job_card_no` all live in `public`; the screens reaching them through
 * `getDb()` were reaching `production` and finding nothing.
 *
 * So: `getDb()` for the capture/production tables, `getPublicDb()` for the job
 * card, label and sales-order tables. The distinction is load-bearing, and the
 * failure mode when it is got wrong is a 404 that blames the schema migration
 * rather than the caller.
 */
export function getPublicDb() {
  return getSupabaseClient().schema('public') as any
}
