import { createBrowserClient } from '@supabase/ssr'

// Turbopack / hot-reload safe singleton
// We attach to globalThis so the instance survives HMR re-imports
const GLOBAL_KEY = '__cntp_supabase_client__'

export function getSupabaseClient() {
  if (typeof window === 'undefined') {
    // SSR — always create fresh (no singleton needed server-side)
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { db: { schema: 'production' } }
    )
  }

  // Browser — reuse the same instance across HMR cycles
  if (!(globalThis as any)[GLOBAL_KEY]) {
    ;(globalThis as any)[GLOBAL_KEY] = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { db: { schema: 'production' } }
    )
  }

  return (globalThis as any)[GLOBAL_KEY]
}