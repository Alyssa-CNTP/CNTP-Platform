// app/api/production/read-value/route.ts
// Vision: read a single numeric value from a photo of a machine display / gauge /
// scale on the line, so operators don't mistype. Mirrors the /api/ocr-tag pattern
// (model fallback, 25s timeout). Server-side only — keeps GEMINI_API_KEY off the client.

import { NextRequest, NextResponse } from 'next/server'

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash']
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ status: 'error', message: 'GEMINI_API_KEY not set' }, { status: 500 })
  return NextResponse.json({ status: 'ready', models: MODELS })
}

export async function POST(req: NextRequest) {
  try {
    const { image, mimeType = 'image/jpeg', label = 'reading', unit = '' } = await req.json()
    if (!image) return NextResponse.json({ error: 'No image provided' }, { status: 400 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 })

    const prompt = `You are reading ONE numeric value from a photo of a machine display, gauge, or scale on a factory line.
The value being read is: "${label}"${unit ? ` (unit: ${unit})` : ''}.

Return ONLY this JSON, no markdown:
{"value": <number or null>, "raw": "<exactly what you see on the display>"}

Rules:
- Return just the number — no unit, no extra text.
- If several numbers are shown, return the main/largest reading for "${label}".
- Decimals: keep them (e.g. 14.2).
- If the display is blank or illegible, set value to null. Never guess or invent a number.`

    const body = JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: image } },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
    })

    let lastError = 'All Gemini models unavailable.'
    let geminiRes: Response | null = null
    let usedModel = ''

    for (const model of MODELS) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 25000)
      try {
        const res = await fetch(`${BASE}/${model}:generateContent?key=${apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          signal: controller.signal, body,
        })
        clearTimeout(timeout)
        if (res.status === 429 || res.status === 404 || res.status === 503) {
          const e = await res.json().catch(() => ({}))
          lastError = (e as any)?.error?.message ?? lastError
          continue
        }
        geminiRes = res; usedModel = model; break
      } catch (err: any) {
        clearTimeout(timeout)
        if (err.name === 'AbortError') { lastError = `${model} timed out`; continue }
        throw err
      }
    }

    if (!geminiRes) return NextResponse.json({ error: lastError }, { status: 429 })
    if (!geminiRes.ok) {
      const e = await geminiRes.json().catch(() => ({}))
      return NextResponse.json({ error: (e as any)?.error?.message ?? 'Gemini error' }, { status: 502 })
    }

    const data = await geminiRes.json()
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!rawText) return NextResponse.json({ error: 'No response from Gemini' }, { status: 502 })

    const clean = rawText.replace(/```json\n?|```/g, '').trim()
    let parsed: { value: number | null; raw?: string } = { value: null }
    try { parsed = JSON.parse(clean) }
    catch {
      const m = clean.match(/\{[\s\S]*\}/)
      if (m) { try { parsed = JSON.parse(m[0]) } catch { /* leave null */ } }
    }

    const value = typeof parsed.value === 'number' && isFinite(parsed.value) ? parsed.value : null
    return NextResponse.json({ value, raw: parsed.raw ?? rawText, model: usedModel })
  } catch (err: any) {
    if (err.name === 'AbortError') return NextResponse.json({ error: 'Read timeout.' }, { status: 504 })
    console.error('[read-value] error:', err)
    return NextResponse.json({ error: err.message ?? 'Unknown error' }, { status: 500 })
  }
}
