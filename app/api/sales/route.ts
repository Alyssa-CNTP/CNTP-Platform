// app/api/sales/route.ts
// Sales intelligence API — powered by Gemini (Google).
// Auto-fallback across model chain if primary is overloaded.

import { NextResponse }                          from 'next/server'
import { createServerClient }                    from '@supabase/ssr'
import { cookies }                               from 'next/headers'
import { queryGeminiDetailed, PROMPTS }          from '@/lib/intelligence/gemini'
import { EXTENDED_PROMPTS }                      from '@/lib/internal-sales-intelligence'
import { houseStyleBlock }                       from '@/lib/intelligence/house-style'

export const maxDuration = 60

type SalesAction =
  | 'briefing' | 'risk' | 'market_entry'
  | 'competitor_scan' | 'competitor_gaps' | 'competitor_advantages'
  | 'partnerships' | 'objections' | 'contacts'
  | 'agent' | 'file_analysis' | 'report' | 'scout' | 'alerts'
  | 'company_profile' | 'pitch_builder' | 'expansion_briefing'
  | 'contradiction_check' | 'cultural_scout' | 'audience_signals'
  | 'gap_finder' | 'variance_finder' | 'source_analysis' | 'loophole_scan'

// ─── Vault context helper ─────────────────────────────────────────────────────

const CHROMA_BASE         = 'http://localhost:8000'
const VAULT_COLLECTION_ID = process.env.CHROMA_VAULT_COLLECTION_ID ?? ''

async function fetchVaultContext(query: string): Promise<string> {
  if (!VAULT_COLLECTION_ID) return ''

  try {
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(
      `${CHROMA_BASE}/api/v1/collections/${VAULT_COLLECTION_ID}/query`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query_texts: [query], n_results: 3 }),
        signal:  controller.signal,
      }
    )
    clearTimeout(timeoutId)

    if (!res.ok) return ''
    const data  = await res.json()
    const docs  = data.documents?.flat() ?? []
    const metas = data.metadatas?.flat() ?? []
    return docs
      .map((t: string, i: number) => `[${metas[i]?.doc_type ?? 'doc'}] ${t}`)
      .join('\n\n')
  } catch {
    return ''
  }
}

// ─── Signal context helper ────────────────────────────────────────────────────

async function fetchSignalContext(
  supabase: ReturnType<typeof createServerClient>,
  keyword: string,
): Promise<string> {
  try {
    const { data } = await supabase
      .schema('sales' as any)
      .from('signals')
      .select('title, summary_en, classification, region, source_type')
      .ilike('title', `%${keyword}%`)
      .order('created_at', { ascending: false })
      .limit(10)

    if (!data?.length) return ''
    return data
      .map((s: any) => `[${s.source_type}/${s.region}] ${s.summary_en || s.title}`)
      .join('\n')
  } catch {
    return ''
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

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

  // ── Access check — IT, Sales, Management, or explicit can_access_sales permission ──
  const { data: appRole } = await supabase
    .schema('shared' as any)
    .from('app_roles')
    .select('role, department, permissions')
    .eq('user_id', user.id)
    .single()

  const dept        = (appRole as any)?.department as string | null
  const overrides   = ((appRole as any)?.permissions ?? {}) as Record<string, boolean>
  const canAccess   = ['IT', 'Sales', 'Management', 'Marketing'].includes(dept ?? '')
                      || overrides['can_access_sales'] === true
                      || overrides['can_access_intelligence'] === true

  if (!canAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  const body = await req.json().catch(() => ({}))
  const action: SalesAction = body.action ?? 'agent'

  // ── Retrieval accumulator — captured for the interaction log ───────────────
  const retrieved: { vault: Record<string, string>; signals: Record<string, string> } = {
    vault: {}, signals: {},
  }
  const captureVault = async (key: string, query: string) => {
    const ctx = await fetchVaultContext(query)
    if (ctx) retrieved.vault[key] = ctx
    return ctx
  }
  const captureSignals = async (key: string, kw: string) => {
    const ctx = await fetchSignalContext(supabase, kw)
    if (ctx) retrieved.signals[key] = ctx
    return ctx
  }

  // ── Build prompt ───────────────────────────────────────────────────────────
  let prompt: string
  const maxTokens = action === 'report' ? 1200 : action === 'scout' ? 600 : 900

  switch (action) {
    // ── Existing actions ────────────────────────────────────────────────────
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
      prompt = `Generate 5 urgent market intelligence alerts for a South African rooibos bulk exporter.
Each alert: a real competitor move, demand signal, regulatory change, or opportunity window.
Format each as: TYPE | TITLE | DETAIL (one per line). Max 200 words.`
      break

    // ── New extended actions ─────────────────────────────────────────────────

    case 'company_profile': {
      if (!body.company) return NextResponse.json({ error: 'company required' }, { status: 400 })
      const vaultCtx = await captureVault('company', `${body.company} client buyer relationship`)
      prompt = EXTENDED_PROMPTS.companyProfile(body.company, vaultCtx)
      break
    }

    case 'pitch_builder': {
      if (!body.target_market || !body.buyer_type || !body.product_format) {
        return NextResponse.json(
          { error: 'target_market, buyer_type, and product_format required' },
          { status: 400 }
        )
      }
      const vaultCtx = await captureVault('pitch', `${body.target_market} ${body.buyer_type} pricing proposal`)
      prompt = EXTENDED_PROMPTS.pitchBuilder(
        body.target_market,
        body.buyer_type,
        body.product_format,
        body.cultural_context ?? '',
        vaultCtx,
      )
      break
    }

    case 'expansion_briefing': {
      if (!body.vector) return NextResponse.json({ error: 'vector required' }, { status: 400 })
      prompt = EXTENDED_PROMPTS.expansionBriefing(body.vector)
      break
    }

    case 'contradiction_check': {
      const market      = body.market ?? 'general'
      const vaultCtx    = await captureVault('market', market)
      const signalCtx   = await captureSignals('market', market)
      prompt = EXTENDED_PROMPTS.contradictionCheck(market, vaultCtx, signalCtx)
      break
    }

    case 'cultural_scout': {
      if (!body.country) return NextResponse.json({ error: 'country required' }, { status: 400 })
      prompt = EXTENDED_PROMPTS.culturalScout(body.country)
      break
    }

    case 'audience_signals': {
      if (!body.audience_tag) return NextResponse.json({ error: 'audience_tag required' }, { status: 400 })
      const signalCtx = await captureSignals('audience', body.audience_tag)
      prompt = EXTENDED_PROMPTS.audienceSignals(body.audience_tag, signalCtx)
      break
    }

    case 'gap_finder': {
      if (!body.market || !body.product)
        return NextResponse.json({ error: 'market and product required' }, { status: 400 })
      const vaultCtx   = await captureVault('gap', `${body.market} ${body.product} distributor middleman`)
      const signalCtx  = await captureSignals('gap', body.market)
      prompt = EXTENDED_PROMPTS.gapFinder(body.market, body.product, vaultCtx, signalCtx)
      break
    }

    case 'variance_finder': {
      if (!body.market)
        return NextResponse.json({ error: 'market required' }, { status: 400 })
      const vaultCtx = await captureVault('variance', `${body.market} product range whitespace`)
      prompt = EXTENDED_PROMPTS.varianceFinder(body.market, vaultCtx)
      break
    }

    case 'source_analysis': {
      if (!body.source_title || !body.source_text || !body.question)
        return NextResponse.json({ error: 'source_title, source_text, and question required' }, { status: 400 })
      prompt = EXTENDED_PROMPTS.sourceAnalysis(
        body.source_title,
        body.source_domain ?? '',
        body.source_text,
        body.question,
      )
      break
    }

    case 'loophole_scan': {
      const signalCtx = await captureSignals('loophole', body.keyword ?? 'rooibos competitor')
      const vaultCtx  = await captureVault('loophole', 'competitor weakness supply chain disruption')
      prompt = EXTENDED_PROMPTS.loopholeScan(signalCtx, vaultCtx)
      break
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  // ── Load house-style fragment + call Gemini with auto-fallback ────────────
  const { block: hsBlock, version: hsVersion } = await houseStyleBlock()
  const { response, model, ok } = await queryGeminiDetailed({
    prompt,
    systemExtra: hsBlock,
    maxTokens,
  })

  // ── Log the interaction (best-effort, never block the response) ───────────
  // Note: full_prompt stored here is the USER-side prompt (post-build). The
  // base system prompt + house style block are not duplicated per-row — the
  // version is captured separately so we can reconstruct exactly what the
  // model saw at request time.
  let interactionId: string | null = null
  if (ok) {
    try {
      // Strip large free-text fields from request_body to keep rows small.
      const safeBody = { ...body }
      if (typeof safeBody.content === 'string' && safeBody.content.length > 2000) {
        safeBody.content = safeBody.content.slice(0, 2000) + '…[truncated]'
      }

      const { data: logRow } = await supabase
        .schema('sales' as any)
        .from('ai_interactions')
        .insert({
          user_id:          user.id,
          action,
          request_body:     safeBody,
          full_prompt:      prompt,
          response,
          model,
          house_style_v:    hsVersion,
          retrieved_chunks: retrieved,
        })
        .select('id')
        .single()
      interactionId = (logRow as any)?.id ?? null
    } catch (logErr) {
      // Logging failure must not affect the response — only warn.
      console.warn('[sales] ai_interactions log failed:', logErr)
    }
  }

  return NextResponse.json({ response, interaction_id: interactionId })
}
