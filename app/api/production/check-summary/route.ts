// app/api/production/check-summary/route.ts
// Generates a concise plain-English shift audit summary from the machine-checks
// record, for the supervisor to review and for the audit trail. Reuses the
// Gemini wrapper with a production-auditor system prompt (not the sales persona).

import { NextRequest, NextResponse } from 'next/server'
import { queryGeminiDetailed } from '@/lib/intelligence/gemini'

const CHECKS_SYSTEM = `You are a production shift auditor at a South African rooibos processing factory.
Write a concise, factual plain-English summary of one shift's machine checks for a supervisor to review quickly.
Rules:
- 2 to 4 sentences. No markdown, no headings, no preamble — just the summary text.
- Lead with variant/grade and the mass balance (kg in / kg out / variance %).
- Then the infeed VSD reading range across the shift, then any flagged/failed checks or exceptions.
- State facts from the data only. Omit anything missing. Do not invent numbers.`

const CLEANING_SYSTEM = `You are a hygiene/compliance auditor at a South African rooibos processing factory.
Write a concise, factual plain-English summary of one shift's cleaning record for a supervisor to review quickly.
Rules:
- 1 to 3 sentences. No markdown, no headings, no preamble — just the summary text.
- State how many tasks were completed and call out any flagged exceptions with their reasons.
- Mention any photo-verified areas if present. State facts from the data only; do not invent anything.`

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const system = data?.kind === 'cleaning' ? CLEANING_SYSTEM : CHECKS_SYSTEM
    const prompt = `${data?.kind === 'cleaning' ? 'Shift cleaning data' : 'Shift checks data'} (JSON):\n${JSON.stringify(data)}\n\nWrite the summary now.`
    const { response, model, ok } = await queryGeminiDetailed({
      prompt, systemOverride: system, temperature: 0.3, maxTokens: 512,
    })
    return NextResponse.json({ summary: ok ? response.trim() : '', model, ok })
  } catch (err: any) {
    console.error('[check-summary] error:', err)
    return NextResponse.json({ summary: '', ok: false, error: err.message ?? 'Unknown error' }, { status: 500 })
  }
}
