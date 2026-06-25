// app/api/production/ask/route.ts
// Follow-up chat over the production dashboard aggregates. Cheap: only the
// compact aggregate blob (not raw rows) is ever sent to the model.

import { NextRequest, NextResponse } from 'next/server'
import { queryGeminiDetailed } from '@/lib/intelligence/gemini'

export const runtime = 'nodejs'
export const maxDuration = 30

const SYSTEM = `You are a production performance analyst for a South African botanical processing facility. Answer the manager's question using ONLY the aggregated production data provided. Be concise, plain-English, and prescriptive. Never invent numbers not present in the data. If the data cannot answer the question, say so and suggest what to look at.`

export async function POST(req: NextRequest) {
  try {
    const { aggregates, history, question } = await req.json()
    if (!question?.trim()) return NextResponse.json({ error: 'question required' }, { status: 400 })

    const convo = Array.isArray(history)
      ? history.map((m: any) => `${m.role === 'user' ? 'Manager' : 'Analyst'}: ${m.text}`).join('\n')
      : ''

    const prompt = `${convo ? `Conversation so far:\n${convo}\n\n` : ''}Manager's question: ${question}\n\nAnswer in plain text (no JSON, no markdown fences).`

    const result = await queryGeminiDetailed({
      prompt,
      systemOverride: SYSTEM,
      systemExtra: `\n\nPRODUCTION DATA (aggregates):\n${JSON.stringify(aggregates ?? {}, null, 2)}`,
      maxTokens: 1024,
      temperature: 0.4,
    })
    if (!result.ok) return NextResponse.json({ error: result.response }, { status: 500 })
    return NextResponse.json({ answer: result.response.trim(), model: result.model })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}
