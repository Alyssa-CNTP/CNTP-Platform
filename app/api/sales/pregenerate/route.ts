// app/api/sales/pregenerate/route.ts
//
// Called once on first Sales Intelligence tab load.
// Generates and caches all static intelligence in the background.
// The UI loads from cache — no waiting for generation on every visit.
// Only regenerates content that has expired (>24h old).

import { NextResponse }         from 'next/server'
import { createServerClient }   from '@supabase/ssr'
import { cookies }              from 'next/headers'
import { queryGemini, PROMPTS } from '@/lib/intelligence/gemini'

export const maxDuration = 120   // allow up to 2 minutes for full pre-gen

// Content to pre-generate — key matches sales.intel_cache cache_key
const PRE_GEN_TASKS = [
  { key: 'briefing',      prompt: () => PROMPTS.globalBriefing(),        tokens: 8192 },
  { key: 'risk',          prompt: () => PROMPTS.riskAnalysis(),           tokens: 4096 },
  { key: 'competitors',   prompt: () => PROMPTS.competitorScan(),         tokens: 8192 },
  { key: 'comp_gaps',     prompt: () => PROMPTS.competitorGaps(),         tokens: 4096 },
  { key: 'partnerships',  prompt: () => PROMPTS.partnershipStrategy(),    tokens: 8192 },
  { key: 'objections',    prompt: () => PROMPTS.objectionBattlecards(),   tokens: 4096 },
  { key: 'contacts',      prompt: () => PROMPTS.whoToContact(),           tokens: 8192 },
]

export async function POST(req: Request) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appRole } = await supabase
    .schema('shared' as any)
    .from('app_roles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!appRole || !['admin', 'management', 'sales'].includes(appRole.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Check which keys are already fresh ────────────────────────────────────
  const { data: existingCache } = await supabase
    .schema('sales')
    .from('intel_cache')
    .select('cache_key, expires_at')

  const freshKeys = new Set(
    (existingCache ?? [])
      .filter(r => new Date(r.expires_at) > new Date())
      .map(r => r.cache_key)
  )

  // ── Only generate stale/missing content ───────────────────────────────────
  const tasks = PRE_GEN_TASKS.filter(t => !freshKeys.has(t.key))

  if (tasks.length === 0) {
    return NextResponse.json({ message: 'All content is fresh — no generation needed', regenerated: [] })
  }

  const regenerated: string[] = []
  const errors: string[] = []

  // Run tasks sequentially to avoid hammering the API
  for (const task of tasks) {
    try {
      const content = await queryGemini({
        prompt:    task.prompt(),
        maxTokens: task.tokens,
      })

      if (content.startsWith('All Gemini models') || content.startsWith('No Gemini')) {
        errors.push(task.key)
        continue
      }

      // Save to cache
      await supabase.schema('sales').from('intel_cache').upsert({
        cache_key:    task.key,
        content,
        generated_by: user.id,
        expires_at:   new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'cache_key' })

      regenerated.push(task.key)
    } catch (e: any) {
      console.error(`[pregenerate] failed for ${task.key}:`, e.message)
      errors.push(task.key)
    }
  }

  return NextResponse.json({
    message: `Generated ${regenerated.length} items, ${errors.length} failed`,
    regenerated,
    errors,
    skipped: Array.from(freshKeys),
  })
}