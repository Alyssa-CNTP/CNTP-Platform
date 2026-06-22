// ─────────────────────────────────────────────────────────────────────────────
// lib/intelligence/house-style.ts
//
// Fetches the currently-active house-style document from sales.house_style
// and caches it in-process for 60s so back-to-back Gemini calls don't hit
// Supabase every time. Server-side only — pulled into the system prompt by
// the API routes that call queryGemini().
//
// Pair with: scripts/migrations_sales_intelligence.sql (table + seed row).
// ─────────────────────────────────────────────────────────────────────────────

import { createServerClient } from '@supabase/ssr'
import { cookies }            from 'next/headers'

export interface HouseStyle {
  version: number
  content: string
}

// In-process cache (per Node worker). Short TTL so edits in the admin UI
// take effect within a minute without forcing a redeploy or restart.
let cache:   HouseStyle | null = null
let cacheAt: number            = 0
const TTL_MS = 60_000

export async function getActiveHouseStyle(): Promise<HouseStyle | null> {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache

  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } },
    )

    const { data, error } = await supabase
      .schema('sales' as any)
      .from('house_style')
      .select('version, content')
      .eq('is_active', true)
      .maybeSingle()

    if (error || !data) return cache  // serve stale on failure, never null after first success

    cache   = data as HouseStyle
    cacheAt = Date.now()
    return cache
  } catch {
    return cache
  }
}

// Manual cache-buster for the future admin UI when a new version is published.
export function invalidateHouseStyleCache(): void {
  cache   = null
  cacheAt = 0
}

// Convenience: returns the system-prompt fragment (with header) or '' if unavailable.
export async function houseStyleBlock(): Promise<{ block: string; version: number | null }> {
  const hs = await getActiveHouseStyle()
  if (!hs) return { block: '', version: null }
  return {
    block:   `\n\n## HOUSE STYLE (v${hs.version})\n${hs.content}`,
    version: hs.version,
  }
}
