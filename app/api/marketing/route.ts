// app/api/marketing/route.ts
// Marketing intelligence API — powered by Gemini.
// Actions: campaign_brief | content_angles | audience_brief | signal_bookmark

import { NextResponse }      from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient }       from '@supabase/supabase-js'
import { cookies }            from 'next/headers'
import { queryGeminiDetailed } from '@/lib/intelligence/gemini'
import { houseStyleBlock }     from '@/lib/intelligence/house-style'

export const maxDuration = 60

const ALLOWED = ['IT', 'Sales', 'Management', 'Marketing']

const marketingDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'marketing' } }
)

const salesDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'sales' } }
)

async function recentSignalContext(keyword: string): Promise<{ context: string; ids: string[] }> {
  try {
    const { data } = await salesDb
      .from('signals')
      .select('id, title, summary_en, classification, region, source_type')
      .ilike('title', `%${keyword}%`)
      .order('created_at', { ascending: false })
      .limit(8)
    if (!data?.length) return { context: '', ids: [] }
    return {
      context: data.map((s: any) => `[${s.source_type}/${s.region ?? 'global'}] ${s.summary_en || s.title}`).join('\n'),
      ids:     data.map((s: any) => s.id as string),
    }
  } catch { return { context: '', ids: [] } }
}

export async function POST(req: Request) {
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
    .select('department, permissions')
    .eq('user_id', user.id)
    .single()

  const dept      = (appRole as any)?.department as string | null
  const overrides = ((appRole as any)?.permissions ?? {}) as Record<string, boolean>
  const canAccess = ALLOWED.includes(dept ?? '')
    || overrides['can_access_marketing'] === true
    || overrides['can_access_sales'] === true

  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body   = await req.json().catch(() => ({}))
  const action = body.action as string

  // ── Non-AI actions ──────────────────────────────────────────────────────────

  if (action === 'save_campaign') {
    if (!body.title) return NextResponse.json({ error: 'title required' }, { status: 400 })
    const { data, error } = await marketingDb
      .from('campaigns')
      .insert({
        created_by:   user.id,
        title:        body.title,
        market:       body.market ?? null,
        audience_tag: body.audience_tag ?? null,
        brief:        body.brief ?? null,
        notes:        body.notes ?? null,
        status:       'draft',
        channel:      body.channel ?? null,
        signal_ids:   body.signal_ids ?? [],
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ id: (data as any).id })
  }

  if (action === 'bookmark_signal') {
    if (!body.signal_id) return NextResponse.json({ error: 'signal_id required' }, { status: 400 })
    const { error } = await marketingDb
      .from('signal_bookmarks')
      .upsert({ created_by: user.id, signal_id: body.signal_id, notes: body.notes ?? null, use_case: body.use_case ?? 'content' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'list_campaigns') {
    const { data, error } = await marketingDb
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ campaigns: data ?? [] })
  }

  if (action === 'list_audiences') {
    const { data, error } = await marketingDb
      .from('audience_segments')
      .select('*')
      .order('tag')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ audiences: data ?? [] })
  }

  // ── AI actions ──────────────────────────────────────────────────────────────

  const { block: hsBlock } = await houseStyleBlock()

  // campaign_brief is handled separately so it can return signal_ids alongside the brief
  if (action === 'campaign_brief') {
    if (!body.market || !body.audience_tag)
      return NextResponse.json({ error: 'market and audience_tag required' }, { status: 400 })
    const { context: signalContext, ids: signalIds } = await recentSignalContext(`${body.market} ${body.audience_tag}`)
    const prompt = `Generate a complete marketing campaign brief for a South African rooibos and herbal tea exporter (CNTP).

TARGET MARKET: ${body.market}
AUDIENCE SEGMENT: ${body.audience_tag}
${body.product ? `PRODUCT FOCUS: ${body.product}` : ''}

${signalContext ? `RECENT MARKET SIGNALS:\n${signalContext}\n` : ''}

## CAMPAIGN OBJECTIVE
What should this campaign achieve? (awareness, trial, trade relationship, B2B lead generation)

## KEY MESSAGE
One sentence — what CNTP stands for in this market for this audience.

## CONTENT PILLARS (3)
Three themes to build content around. Each with: the angle, why it resonates with this audience, one example execution.

## CHANNEL STRATEGY
Best platforms for reaching this audience in this market. Priority order with rationale.

## TONE & STYLE
How to communicate — formal/informal, visual style, language register. What to avoid.

## PROOF POINTS
The 3 most compelling facts about CNTP rooibos that matter to this audience.

## CALL TO ACTION
The single most important next step for this audience to take.

## TIMELINE SUGGESTION
A realistic 6-week campaign arc.`
    const { response, ok } = await queryGeminiDetailed({ prompt, systemExtra: hsBlock, maxTokens: 900 })
    if (!ok) return NextResponse.json({ error: 'AI unavailable' }, { status: 503 })
    return NextResponse.json({ response, signal_ids: signalIds })
  }

  let prompt: string

  switch (action) {

    case 'content_angles': {
      if (!body.platform || !body.market)
        return NextResponse.json({ error: 'platform and market required' }, { status: 400 })
      const { context: signalContext } = await recentSignalContext(body.market)
      prompt = `Generate 5 specific content angles for a South African rooibos exporter posting on ${body.platform}.

MARKET: ${body.market}
${body.audience_tag ? `AUDIENCE: ${body.audience_tag}` : ''}
${body.product ? `PRODUCT: ${body.product}` : ''}

${signalContext ? `RECENT SIGNALS (use these as hooks where relevant):\n${signalContext}\n` : ''}

For each angle provide:
1. HOOK — the opening line or visual concept (platform-native)
2. ANGLE — the story or idea behind it
3. WHY IT WORKS — why this audience on this platform will engage
4. FORMAT — post type (carousel, short video, article, story, etc.)
5. CTA — what you want them to do after

Make the angles specific, not generic. Reference real things: the Cederberg origin, appellation protection, specific products, red espresso, aspalathin. Not "we have great rooibos".`
      break
    }

    case 'audience_brief': {
      if (!body.audience_tag)
        return NextResponse.json({ error: 'audience_tag required' }, { status: 400 })
      const { context: signalContext } = await recentSignalContext(body.audience_tag)
      prompt = `Generate a detailed audience intelligence brief for the segment: ${body.audience_tag}

${signalContext ? `RECENT SIGNALS FOR THIS AUDIENCE:\n${signalContext}\n` : ''}

## WHO THEY ARE
Demographics, psychographics, values, purchase behaviour. Where they are geographically strongest.

## WHAT THEY WANT FROM A PRODUCT LIKE ROOIBOS
Functional needs, emotional needs, credence attributes (certifications, origin, ethics).

## HOW THEY DISCOVER & BUY
Channels, influences, trusted voices, where they research, where they purchase.

## WHAT CNTP CAN SAY TO THIS AUDIENCE
Specific messages, proof points, product formats that resonate. What to lead with. What to avoid.

## COMPETITOR CONTENT IN THIS SPACE
What other brands are doing to reach this audience — and what the gap is.

## CONTENT THAT PERFORMS WITH THIS SEGMENT
Formats, tones, hooks that have traction. Based on signals and market patterns.

## RECOMMENDED FIRST CAMPAIGN MOVE
One specific, actionable first step to reach this audience in the next 4 weeks.`
      break
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const { response, ok } = await queryGeminiDetailed({ prompt, systemExtra: hsBlock, maxTokens: 900 })

  if (!ok) return NextResponse.json({ error: 'AI unavailable' }, { status: 503 })
  return NextResponse.json({ response })
}
