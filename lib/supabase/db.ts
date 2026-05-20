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