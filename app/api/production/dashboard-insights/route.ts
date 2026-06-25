// app/api/production/dashboard-insights/route.ts
// AI analyst for the production *dashboard* (distinct from /insights, which feeds
// the operations analytics page with a yield/reliability/velocity shape). This
// one takes a compact aggregate blob and returns the same structured narrative
// contract as the maintenance analyst, so AiAnalystPanel can be reused as-is.

import { NextRequest, NextResponse } from 'next/server'
import { queryGeminiDetailed } from '@/lib/intelligence/gemini'

export const runtime = 'nodejs'
export const maxDuration = 30

const PROD_ANALYST_SYSTEM = `You are a production performance analyst for a South African botanical (rooibos) processing facility. You receive AGGREGATED production KPIs — never raw rows — covering bagged output, yield, mass-balance variance, section activity, sign-offs and breakdowns affecting production. Identify what the production manager should act on: yield slipping, mass-balance losses, idle or lagging sections, sign-offs piling up, and equipment breakdowns stealing run time. Be concrete and prescriptive. NEVER invent numbers that are not present in the data. Return ONLY valid JSON, no markdown fences.`

export async function POST(req: NextRequest) {
  try {
    const aggregates = await req.json()

    const prompt = `Analyse this production performance snapshot and respond with insights.

DATA (aggregates only):
${JSON.stringify(aggregates, null, 2)}

Respond in this EXACT JSON structure:
{
  "summary": "2-3 sentence plain-English summary of production health for a non-technical manager",
  "highlights": [
    { "type": "positive|warning|critical", "title": "short title", "detail": "1-2 sentences with specific numbers from the data" }
  ],
  "recommendations": [
    { "priority": "high|medium|low", "action": "specific action to take", "rationale": "why, referencing the data" }
  ],
  "watchlist": [
    { "asset": "section or area name", "reason": "why it needs watching" }
  ]
}

Be direct and data-driven. Reference actual numbers. If a section has nothing meaningful, return an empty array for it.`

    const result = await queryGeminiDetailed({
      prompt,
      systemOverride: PROD_ANALYST_SYSTEM,
      maxTokens: 1400,
      temperature: 0.3,
    })
    if (!result.ok) return NextResponse.json({ error: result.response }, { status: 500 })

    const cleaned = result.response
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    return NextResponse.json({ insights: parsed, model: result.model })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}
