// app/api/pipeline/ingest/route.ts
// Receives signals from n8n (or gather_v2.py during dev).
// Validates the secret header, writes to sales.signals, creates alerts for high-score signals.
// Never called from the browser — server-to-server only.

import { NextResponse } from 'next/server'
import { createClient }  from '@supabase/supabase-js'

// Service role client — bypasses RLS so n8n can write signals.
// This key never goes to the browser. Only used here, server-side.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: 'sales' }
  }
)

const PIPELINE_SECRET = process.env.PIPELINE_INGEST_SECRET!

// ─── Types ────────────────────────────────────────────────────────────────────

interface IngestPayload {
  source_type:      string
  source_url?:      string | null
  source_domain?:   string | null
  language?:        string | null
  title:            string
  summary_en?:      string | null
  classification?:  string | null
  relevance_score?: number | null
  sections?:        string[]
  keyword_group?:   string | null
  region?:          string | null
  media_url?:       string | null
  raw_content?:     string | null
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(body: unknown): body is IngestPayload {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  if (typeof b.source_type !== 'string' || !b.source_type.trim()) return false
  if (typeof b.title       !== 'string' || !b.title.trim())       return false
  return true
}

function sanitise(payload: IngestPayload): IngestPayload {
  return {
    source_type:     payload.source_type.trim().toLowerCase(),
    source_url:      payload.source_url      ?? null,
    source_domain:   payload.source_domain   ?? null,
    language:        payload.language        ?? 'en',
    title:           payload.title.trim().slice(0, 500),
    summary_en:      payload.summary_en      ? payload.summary_en.trim().slice(0, 1000) : null,
    classification:  VALID_CLASSIFICATIONS.includes(payload.classification ?? '')
                       ? payload.classification
                       : 'neutral',
    relevance_score: typeof payload.relevance_score === 'number'
                       ? Math.min(10, Math.max(0, Math.round(payload.relevance_score)))
                       : 0,
    sections:        Array.isArray(payload.sections) ? payload.sections : [],
    keyword_group:   payload.keyword_group   ?? null,
    region:          payload.region          ?? null,
    media_url:       payload.media_url       ?? null,
    raw_content:     payload.raw_content     ? payload.raw_content.trim().slice(0, 5000) : null,
  }
}

const VALID_CLASSIFICATIONS = [
  'opportunity', 'threat', 'competitor',
  'regulation',  'relationship', 'neutral',
]

// ─── Alert creation ───────────────────────────────────────────────────────────
// Only fires when relevance_score >= 8 and classification is actionable.
// Keeps the alerts table clean — not every signal becomes an alert.

async function maybeCreateAlert(signalId: string, payload: IngestPayload) {
  const score          = payload.relevance_score ?? 0
  const classification = payload.classification  ?? 'neutral'

  if (score < 8) return
  if (['neutral', 'regulation'].includes(classification)) return

  const alertType = classification === 'threat' ? 'threat' : 'opportunity'

  const title = classification === 'threat'
    ? `⚠️ Threat detected — ${payload.source_domain ?? payload.source_type}`
    : `🎯 High-value signal — ${payload.source_domain ?? payload.source_type}`

  await supabase.from('alerts').insert({
    signal_id:  signalId,
    type:       alertType,
    title,
    body:       payload.summary_en ?? payload.title,
    section:    payload.sections?.[0] ?? 'sales',
    dismissed:  false,
    // Keep existing columns from your schema intact
    source:     payload.source_url ?? null,
    created_by: null,
  })
  // We don't throw on alert failure — signal is already saved, alert is non-critical
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // 1. Validate secret header — reject anything without it immediately
  const secret = req.headers.get('x-pipeline-secret')
  if (!secret || secret !== PIPELINE_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  // 2. Parse body
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // 3. Validate shape
  if (!validate(body)) {
    return NextResponse.json(
      { error: 'Missing required fields: source_type, title' },
      { status: 422 }
    )
  }

  // 4. Sanitise
  const payload = sanitise(body)

  // 5. Insert signal
  const { data, error } = await supabase
    .from('signals')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    console.error('[pipeline/ingest] Supabase insert error:', error.message)
    return NextResponse.json(
      { error: 'Failed to save signal' },
      { status: 500 }
    )
  }

  // 6. Maybe create an alert (non-blocking — does not affect response)
  await maybeCreateAlert(data.id, payload)

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
}

// Block all other methods cleanly
export async function GET()    { return NextResponse.json({ error: 'Method not allowed' }, { status: 405 }) }
export async function PUT()    { return NextResponse.json({ error: 'Method not allowed' }, { status: 405 }) }
export async function DELETE() { return NextResponse.json({ error: 'Method not allowed' }, { status: 405 }) }