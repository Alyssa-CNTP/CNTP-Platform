import { NextRequest, NextResponse } from 'next/server'
import { queryGeminiDetailed } from '@/lib/intelligence/gemini'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { yieldData, reliabilityData, velocityData, period } = body

    const prompt = `You are an operations analyst for a South African botanical processing facility. Analyse the following production data and provide actionable insights.

Period: ${period}

YIELD DATA (kg output per section per month):
${JSON.stringify(yieldData, null, 2)}

COUNT RELIABILITY (match rate % per counter):
${JSON.stringify(reliabilityData, null, 2)}

INVENTORY VELOCITY (avg days sitting per section):
${JSON.stringify(velocityData, null, 2)}

Respond in this exact JSON structure:
{
  "summary": "2-3 sentence executive summary of overall production health",
  "highlights": [
    { "type": "positive|warning|critical", "title": "short title", "detail": "1-2 sentence insight with specific numbers" }
  ],
  "recommendations": [
    { "priority": "high|medium|low", "action": "specific action to take", "rationale": "why this matters with data reference" }
  ],
  "yieldInsight": "1-2 sentences specifically on yield trends",
  "reliabilityInsight": "1-2 sentences on count accuracy",
  "velocityInsight": "1-2 sentences on inventory movement"
}

Be direct, data-driven, and specific. Reference actual numbers from the data.`

    const result = await queryGeminiDetailed({
      prompt,
      systemOverride: 'You are a precise operations data analyst. Return only valid JSON, no markdown fences.',
      maxTokens: 1200,
      temperature: 0.3,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.response }, { status: 500 })
    }

    // Strip markdown fences if model adds them anyway
    const cleaned = result.response
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    const parsed = JSON.parse(cleaned)
    return NextResponse.json({ insights: parsed, model: result.model })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 })
  }
}
