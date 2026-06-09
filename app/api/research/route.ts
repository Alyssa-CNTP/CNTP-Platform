import { NextResponse } from 'next/server'

// ─── Model routing ────────────────────────────────────────────────────────────
// Routes queries to the appropriate model based on complexity.
// Fast model handles most requests. Complex prompts escalate automatically.

const MODELS = {
  fast:  'tinyllama:latest',  // ~1–2s  — signals, quick analysis (until mistral is pulled)
  mid:   'phi3:latest',       // ~8–15s — detailed reports, multi-part analysis
  heavy: 'llama3:latest',     // ~20s+  — deep research, long-form strategy
}

function selectModel(prompt: string): { model: string; maxTokens: number } {
  const len   = prompt.length
  const lower = prompt.toLowerCase()

  // Heavy: long prompts or explicit deep-research keywords
  if (
    len > 800 ||
    lower.includes('full report') ||
    lower.includes('comprehensive') ||
    lower.includes('detailed analysis') ||
    lower.includes('strategy document') ||
    lower.includes('partnership roadmap')
  ) {
    return { model: MODELS.heavy, maxTokens: 600 }
  }

  // Mid: moderate complexity
  if (
    len > 300 ||
    lower.includes('competitor') ||
    lower.includes('market entry') ||
    lower.includes('certif') ||
    lower.includes('regulation') ||
    lower.includes('pitch') ||
    lower.includes('proposal') ||
    lower.includes('compare') ||
    lower.includes('versus') ||
    lower.includes('analyse') ||
    lower.includes('analyze')
  ) {
    return { model: MODELS.mid, maxTokens: 450 }
  }

  // Fast: short signals, quick questions, feed items
  return { model: MODELS.fast, maxTokens: 300 }
}

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json()

    const { model, maxTokens } = selectModel(prompt)
    console.log(`[research] model=${model} tokens=${maxTokens} prompt_len=${prompt.length}`)

    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 90000)

    const response = await fetch('http://localhost:11434/api/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream:      false,
        num_predict: maxTokens,
        temperature: 0.4,
        prompt: `You are the CNTP Research Director — an expert analyst specialising in rooibos tea manufacturing, rosehip synergy products, and global herbal export markets.

Analyse the following and respond with:
1. A one-line summary of what this means for CNTP
2. Key implications (2–3 bullet points, specific and actionable)
3. Recommended next step

Be direct and professional. No filler. No restating the question.

Query: ${prompt}

Analysis:`,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`)
    }

    const data = await response.json()
    let text: string = data.response ?? ''

    // Strip leaked [INST] tags
    text = text
      .replace(/\[INST\][\s\S]*?\[\/INST\]/g, '')
      .replace(/\[INST\]/g, '')
      .replace(/\[\/INST\]/g, '')
      .replace(/^[\s\n]+/, '')
      .trim()

    if (!text) {
      return NextResponse.json({ response: 'Engine returned an empty response. Try rephrasing.' })
    }

    // Return which model handled it so the UI can show it
    return NextResponse.json({ response: text, model })

  } catch (error: any) {
    console.error('[research/route] Error:', error?.message ?? error)
    if (error.name === 'AbortError') {
      return NextResponse.json(
        { response: 'Engine timed out. The model may still be loading — try again in a moment.' },
        { status: 504 }
      )
    }
    return NextResponse.json(
      { response: `Could not reach the research engine (${error?.message ?? 'unknown error'}). Make sure Docker is running.` },
      { status: 500 }
    )
  }
}