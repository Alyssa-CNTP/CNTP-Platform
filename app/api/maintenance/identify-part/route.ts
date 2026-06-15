// app/api/maintenance/identify-part/route.ts
// Gemini-vision "identify by photo" for the maintenance storeroom. Receives a
// downscaled image + a COMPACT projection of the spare-parts register and asks
// Gemini which register part(s) the photographed item is. The photo is NEVER
// stored — it is only forwarded inline to Gemini and discarded.
//
// We call the REST generateContent endpoint directly (not queryGeminiDetailed)
// because that helper is text-only; vision needs an inline_data image part.

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

interface RegisterPart { id: number; part_no: string; description: string; class: string }

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, parts } = (await req.json()) as {
      imageBase64?: string
      parts?: RegisterPart[]
    }

    const register: RegisterPart[] = Array.isArray(parts) ? parts : []

    if (!process.env.GEMINI_API_KEY) {
      // Graceful: identify-by-photo is a progressive enhancement; the scanner
      // still works via handheld/camera/manual search without it.
      return NextResponse.json({ error: 'Gemini not configured', guess: '', matches: [] })
    }
    if (!imageBase64) {
      return NextResponse.json({ error: 'No image provided', guess: '', matches: [] })
    }

    // Strip any data-URL prefix (downscalePhoto returns "data:image/jpeg;base64,…").
    const base64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')

    const PROMPT = `You are a maintenance storeroom assistant. Identify the spare part / tool in the image. Here is the spare-parts register as JSON: ${JSON.stringify(register)}. Return ONLY valid JSON (no markdown fences): {"guess": "<what the item is>", "matches": [{"id": <part id from the register>, "confidence": "high|medium|low", "why": "<short reason>"}]}. Pick up to 3 most likely matching register ids; if nothing matches, return an empty matches array.`

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: 'image/jpeg', data: base64 } },
              ],
            },
          ],
          generationConfig: { temperature: 0.2 },
        }),
      },
    )

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const msg = err?.error?.message ?? `HTTP ${res.status}`
      return NextResponse.json({ error: msg, guess: '', matches: [] })
    }

    const data = await res.json()
    const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    const parsed = JSON.parse(cleaned) as {
      guess?: string
      matches?: { id: number; confidence?: string; why?: string }[]
    }

    const validIds = new Set(register.map(p => p.id))
    const matches = (Array.isArray(parsed.matches) ? parsed.matches : [])
      .filter(m => validIds.has(Number(m.id)))
      .map(m => ({
        id: Number(m.id),
        confidence: (m.confidence === 'high' || m.confidence === 'medium' || m.confidence === 'low')
          ? m.confidence
          : 'low',
        why: typeof m.why === 'string' ? m.why : '',
      }))

    return NextResponse.json({ guess: parsed.guess ?? '', matches })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error', guess: '', matches: [] })
  }
}
