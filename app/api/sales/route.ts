// app/api/sales/route.ts
//
// Sales intelligence API — powered by Gemini (Google).
// Auto-fallback across model chain if primary is overloaded.

import { NextResponse }         from 'next/server'
import { createServerClient }   from '@supabase/ssr'
import { cookies }              from 'next/headers'
import { queryGemini, PROMPTS } from '@/lib/intelligence/gemini'

export const maxDuration = 60

type SalesAction =
  | 'briefing' | 'risk' | 'market_entry'
  | 'competitor_scan' | 'competitor_gaps' | 'competitor_advantages'
  | 'partnerships' | 'objections' | 'contacts'
  | 'agent' | 'file_analysis' | 'report' | 'scout' | 'alerts'

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

  // ── Role check ─────────────────────────────────────────────────────────────
  const { data: appRole } = await supabase
    .schema('production')
    .from('app_roles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!appRole || !['admin', 'management', 'sales'].includes(appRole.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  const body = await req.json().catch(() => ({}))
  const action: SalesAction = body.action ?? 'agent'

  // ── Build prompt ───────────────────────────────────────────────────────────
  let prompt: string
  const maxTokens = action === 'report' ? 1200 : action === 'scout' ? 600 : 900

  switch (action) {
    case 'briefing':
      prompt = PROMPTS.globalBriefing(); break

    case 'risk':
      prompt = PROMPTS.riskAnalysis(); break

    case 'market_entry':
      if (!body.country) return NextResponse.json({ error: 'country required' }, { status: 400 })
      prompt = PROMPTS.marketEntry(body.country); break

    case 'competitor_scan':
      prompt = PROMPTS.competitorScan(); break

    case 'competitor_gaps':
    case 'competitor_advantages':
      prompt = PROMPTS.competitorGaps(); break

    case 'partnerships':
      prompt = PROMPTS.partnershipStrategy(body.market); break

    case 'objections':
      prompt = PROMPTS.objectionBattlecards(); break

    case 'contacts':
      prompt = PROMPTS.whoToContact(); break

    case 'agent':
      if (!body.query) return NextResponse.json({ error: 'query required' }, { status: 400 })
      prompt = PROMPTS.agentQuery(body.query); break

    case 'file_analysis':
      if (!body.filename || !body.content)
        return NextResponse.json({ error: 'filename and content required' }, { status: 400 })
      prompt = PROMPTS.fileAnalysis(body.filename, body.content); break

    case 'report':
      if (!body.reportType) return NextResponse.json({ error: 'reportType required' }, { status: 400 })
      prompt = PROMPTS.fullReport(body.reportType as any); break

    case 'scout':
      prompt = PROMPTS.scoutMarkets(body.filter ?? 'all'); break

    case 'alerts':
      prompt = `Generate 5 urgent market intelligence alerts for CNTP rooibos bulk exports.
Each alert: a real competitor move, demand signal, regulatory change, or opportunity window.
Format each as: TYPE | TITLE | DETAIL (one per line). Max 200 words.`
      break

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  // ── Call Gemini with auto-fallback ─────────────────────────────────────────
  const response = await queryGemini({ prompt, maxTokens })
  return NextResponse.json({ response })
}