// app/api/maintenance/transcribe/route.ts
// Voice-note → smart job card. Accepts a short audio clip (base64), sends it to
// Gemini for transcription + refinement, and returns structured fields. The
// audio is NEVER stored — it lives only in this request and is discarded; only
// the refined text is returned for the client to save into the job card.
//
// modes:
//   'jobcard'  → { transcript, short_description, long_description, maint_types[] }
//   'rootcause'→ { transcript, root_cause, work_done }

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'

const GEMINI_MODEL = 'gemini-2.5-flash'           // robust audio understanding
const FALLBACK_MODEL = 'gemini-3.1-flash-lite-preview'
const MAX_AUDIO_BYTES = 4 * 1024 * 1024           // ~30s of opus is well under this

const PLANNED_TYPES = ['Planned Maintenance', 'Safety Related', 'Engineering', 'Repair', 'Temporary Repair', 'Improvement', 'Audit/Inspection Finding']

const PROMPTS: Record<string, string> = {
  jobcard: `You are helping a Cape Natural Tea Products factory worker raise a maintenance job card by voice.
Transcribe the audio (South African English; the speaker may mix in Afrikaans/isiXhosa — keep meaning, write in English).
Then turn it into a clean, professional job card. Return ONLY valid JSON, no markdown:
{"transcript":"<verbatim transcript>","short_description":"<one concise line: what is wrong>","long_description":"<any extra detail, or empty string>","maint_types":[<zero or more of: ${PLANNED_TYPES.map(t => `"${t}"`).join(', ')}>]}
Keep short_description under 90 characters. Do not invent details that were not said.`,
  rootcause: `You are helping a Cape Natural Tea Products maintenance technician record the ROOT CAUSE and work done on a job, by voice.
Transcribe the audio (South African English; speaker may mix Afrikaans/isiXhosa — keep meaning, write in English).
Then refine it into clear, professional maintenance notes. Return ONLY valid JSON, no markdown:
{"transcript":"<verbatim transcript>","root_cause":"<concise refined root cause>","work_done":"<work carried out, if mentioned, else empty string>"}
Do not invent details that were not said.`,
}

function parseJSON(raw: string): any {
  const clean = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim()
  const s = clean.indexOf('{'), e = clean.lastIndexOf('}')
  return JSON.parse(s !== -1 && e > s ? clean.slice(s, e + 1) : clean)
}

async function callGemini(model: string, prompt: string, audioB64: string, mimeType: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: audioB64 } }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${model} (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!content) throw new Error('Gemini returned an empty response')
  return content as string
}

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: 'Voice transcription is not configured (no GEMINI_API_KEY).' }, { status: 500 })

    const b = await req.json().catch(() => ({}))
    const mode = (b.mode === 'rootcause' ? 'rootcause' : 'jobcard') as 'jobcard' | 'rootcause'
    const audioB64: string = b.audio ?? ''
    const mimeType: string = b.mimeType || 'audio/webm'
    if (!audioB64) return NextResponse.json({ error: 'No audio supplied' }, { status: 400 })
    if (Buffer.byteLength(audioB64, 'base64') > MAX_AUDIO_BYTES)
      return NextResponse.json({ error: 'Voice note too long — keep it under ~30 seconds.' }, { status: 413 })

    const prompt = PROMPTS[mode]
    let raw: string
    try {
      raw = await callGemini(GEMINI_MODEL, prompt, audioB64, mimeType)
    } catch {
      raw = await callGemini(FALLBACK_MODEL, prompt, audioB64, mimeType) // retry on a second model
    }

    let parsed: any
    try { parsed = parseJSON(raw) }
    catch { return NextResponse.json({ error: 'Could not understand the recording — please try again or type it in.' }, { status: 422 }) }

    // Keep only known maint_types
    if (Array.isArray(parsed.maint_types)) parsed.maint_types = parsed.maint_types.filter((t: string) => PLANNED_TYPES.includes(t))
    return NextResponse.json({ ok: true, mode, ...parsed })
  } catch (err: any) {
    console.error('[api/maintenance/transcribe]', err)
    return NextResponse.json({ error: err?.message ?? 'Transcription failed' }, { status: 500 })
  }
}
