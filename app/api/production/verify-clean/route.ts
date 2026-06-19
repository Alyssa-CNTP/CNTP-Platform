// app/api/production/verify-clean/route.ts
// Vision: photo-evidence check for cleaning. The operator snaps the cleaned
// equipment/area; Gemini gives a quick clean/not-clean verdict + note that is
// recorded in the cleaning audit log (the image itself is not stored).
// Mirrors the /api/ocr-tag pattern (model fallback, 25s timeout).

import { NextRequest, NextResponse } from 'next/server'

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash']
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export async function POST(req: NextRequest) {
  try {
    const { image, mimeType = 'image/jpeg', area = 'equipment' } = await req.json()
    if (!image) return NextResponse.json({ error: 'No image provided' }, { status: 400 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 })

    const prompt = `You are a food-safety cleaning inspector at a rooibos tea factory looking at a photo of "${area}" after cleaning.
Judge whether it looks clean: no visible tea/dust build-up, debris, spillage, or foreign material.

Return ONLY this JSON, no markdown:
{"clean": <true or false>, "note": "<one short factual sentence on what you see>"}

Be strict but fair. If you genuinely cannot tell, set clean to false and say why in the note.`

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: image } }] }],
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
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body,
        })
        clearTimeout(timeout)
        if (res.status === 429 || res.status === 404 || res.status === 503) {
          const e = await res.json().catch(() => ({})); lastError = (e as any)?.error?.message ?? lastError; continue
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
    const clean = rawText.replace(/```json\n?|```/g, '').trim()
    let parsed: { clean: boolean; note?: string } = { clean: false, note: '' }
    try { parsed = JSON.parse(clean) }
    catch { const m = clean.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]) } catch { /* keep default */ } } }

    return NextResponse.json({ clean: !!parsed.clean, note: parsed.note ?? '', model: usedModel })
  } catch (err: any) {
    if (err.name === 'AbortError') return NextResponse.json({ error: 'Verify timeout.' }, { status: 504 })
    console.error('[verify-clean] error:', err)
    return NextResponse.json({ error: err.message ?? 'Unknown error' }, { status: 500 })
  }
}
