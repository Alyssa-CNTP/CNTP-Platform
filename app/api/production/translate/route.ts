import { NextRequest, NextResponse } from 'next/server'
import { queryGemini } from '@/lib/intelligence/gemini'

// POST /api/production/translate
// Body: { strings: Record<string, string>, lang: string, langName: string }
// Returns: { translations: Record<string, string> }
// Used by the live capture page to translate UI labels into any SA official language.

export async function POST(req: NextRequest) {
  const { strings, lang, langName } = await req.json()

  if (lang === 'en') {
    return NextResponse.json({ translations: strings })
  }

  const pairs = Object.entries(strings as Record<string, string>)
    .map(([k, v]) => `"${k}": ${JSON.stringify(v)}`)
    .join(',\n')

  const prompt = `Translate the following JSON object values into ${langName} (language code: ${lang}).
Return ONLY a valid JSON object — no markdown, no explanation, no code fences.
Rules:
- Keep the same keys exactly.
- Do NOT translate: unit symbols (kg, %), codes (CON, ORG, RA CON, RA ORG, A, B, C), abbreviations (FIFO, FEFO), serial formats, or proper nouns.
- Preserve special characters (…, →, ✓, ⚠, ·).
- If a value is already a single word that works in the target language, you may keep it.

Input:
{
${pairs}
}`

  const raw = await queryGemini({
    prompt,
    systemOverride: 'You are a precise translation engine for a South African industrial operations app. Output only valid JSON.',
    maxTokens: 2048,
    temperature: 0.1,
  })

  // Strip any markdown fences if the model added them
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim()

  try {
    const translations = JSON.parse(cleaned)
    return NextResponse.json({ translations })
  } catch {
    // Return originals on parse failure — page degrades gracefully to English
    return NextResponse.json({ translations: strings })
  }
}
