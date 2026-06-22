// app/api/sales/health/route.ts
// GET /api/sales/health
// Diagnostic endpoint — checks every layer between the browser and Gemini.
// Safe to hit directly in the browser. Returns JSON you can read.

import { NextResponse }       from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies }            from 'next/headers'

export const maxDuration = 30

export async function GET() {
  const result: Record<string, unknown> = {}

  // ── 1. Session ────────────────────────────────────────────────────────────
  try {
    const cookieStore = await cookies()
    const supabase    = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    result.session = user ? `authenticated (${user.email})` : 'NO SESSION — not logged in'

    if (user) {
      const { data: appRole } = await supabase
        .schema('shared' as any)
        .from('app_roles')
        .select('role, department, permissions')
        .eq('user_id', user.id)
        .single()

      result.role       = (appRole as any)?.role       ?? null
      result.department = (appRole as any)?.department ?? null
      const dept        = result.department as string | null
      const overrides   = ((appRole as any)?.permissions ?? {}) as Record<string, boolean>
      result.sales_access = ['IT', 'Sales', 'Management', 'Marketing'].includes(dept ?? '')
                            || overrides['can_access_sales'] === true
                            || overrides['can_access_intelligence'] === true
    }
  } catch (e: any) {
    result.session = `ERROR: ${e.message}`
  }

  // ── 2. Gemini API key ─────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY
  result.gemini_key_present = !!apiKey
  result.gemini_key_length  = apiKey?.length ?? 0
  result.gemini_key_prefix  = apiKey ? `${apiKey.slice(0, 8)}…` : 'NOT SET'

  // ── 3. Live Gemini ping ───────────────────────────────────────────────────
  if (apiKey) {
    try {
      const models = [
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-flash-8b',
      ]

      let geminiResult = ''
      let modelUsed    = ''

      for (const model of models) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'Reply with exactly 3 words: "Alara is working"' }] }],
              generationConfig: { maxOutputTokens: 20 },
            }),
          }
        )

        if (res.status === 503 || res.status === 529) {
          geminiResult = `${model} overloaded, trying next…`
          continue
        }

        if (res.status === 400) {
          const err = await res.json().catch(() => ({}))
          geminiResult = `400 Bad Request on ${model}: ${(err as any)?.error?.message ?? 'unknown'}`
          break
        }

        if (res.status === 401 || res.status === 403) {
          const err = await res.json().catch(() => ({}))
          geminiResult = `AUTH FAILED on ${model} (${res.status}): ${(err as any)?.error?.message ?? 'Invalid API key'}`
          break
        }

        if (res.status === 429) {
          geminiResult = `${model} rate-limited (429), trying next…`
          continue
        }

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          geminiResult = `${res.status} on ${model}: ${(err as any)?.error?.message ?? 'unknown error'}`
          break
        }

        const data = await res.json()
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        if (!text) {
          geminiResult = `Empty response from ${model}`
          continue
        }

        geminiResult = text.trim()
        modelUsed    = model
        break
      }

      result.gemini_ping     = geminiResult
      result.gemini_model    = modelUsed || 'none succeeded'
      result.gemini_status   = modelUsed ? 'OK' : 'FAILED'

    } catch (e: any) {
      result.gemini_ping   = `EXCEPTION: ${e.message}`
      result.gemini_status = 'FAILED'
    }
  } else {
    result.gemini_ping   = 'Skipped — no API key'
    result.gemini_status = 'NO KEY'
  }

  // ── 4. Env check ─────────────────────────────────────────────────────────
  result.env = {
    NEXT_PUBLIC_SUPABASE_URL:    !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY:   !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    PIPELINE_INGEST_SECRET:      !!process.env.PIPELINE_INGEST_SECRET,
    CHROMA_COLLECTION_ID:        !!process.env.CHROMA_COLLECTION_ID,
    CHROMA_VAULT_COLLECTION_ID:  !!process.env.CHROMA_VAULT_COLLECTION_ID,
    VAULT_ENCRYPTION_KEY:        !!process.env.VAULT_ENCRYPTION_KEY,
    YOUTUBE_DATA_API_KEY:        !!process.env.YOUTUBE_DATA_API_KEY,
    EXA_API_KEY:                 !!process.env.EXA_API_KEY,
    APIFY_API_TOKEN:             !!process.env.APIFY_API_TOKEN,
    N8N_WEBHOOK_SECRET:          !!process.env.N8N_WEBHOOK_SECRET,
  }

  return NextResponse.json(result, { status: 200 })
}
