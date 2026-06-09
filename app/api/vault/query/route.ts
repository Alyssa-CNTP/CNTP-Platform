// app/api/vault/query/route.ts
// POST /api/vault/query
// Auth: requires authenticated user session.
// Queries the vault ChromaDB collection, synthesises answer via Gemini.
// Never returns raw vault chunks to client — only synthesised answers.
// Rate limited to 50 queries/day per user.

import { NextResponse }       from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies }            from 'next/headers'
import { queryGemini }        from '@/lib/intelligence/gemini'

const CHROMA_BASE         = 'http://localhost:8000'
const VAULT_COLLECTION_ID = process.env.CHROMA_VAULT_COLLECTION_ID ?? ''
const DAILY_QUERY_LIMIT   = 50

const ALLOWED_DOC_TYPES = new Set([
  'trip_report', 'pricing_history', 'contract', 'client_profile',
  'competitor_intel', 'market_study', 'product_spec', 'sales_report',
])

export const maxDuration = 60

// ─── Vault query ──────────────────────────────────────────────────────────────

async function queryVaultChunks(
  query: string,
  docTypes?: string[],
): Promise<{ text: string; docType: string; sourceFile: string }[]> {
  if (!VAULT_COLLECTION_ID) return []

  try {
    const where = docTypes?.length
      ? { doc_type: { $in: docTypes } }
      : undefined

    const body: Record<string, unknown> = {
      query_texts: [query],
      n_results:   5,
    }
    if (where) body.where = where

    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(
      `${CHROMA_BASE}/api/v1/collections/${VAULT_COLLECTION_ID}/query`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      }
    )

    clearTimeout(timeoutId)

    if (!res.ok) return []

    const data = await res.json()
    const docs  = data.documents?.flat()  ?? []
    const metas = data.metadatas?.flat()  ?? []

    return docs.map((text: string, i: number) => ({
      text,
      docType:    metas[i]?.doc_type    ?? 'unknown',
      sourceFile: metas[i]?.source_file ?? 'unknown',
    }))

  } catch {
    return []
  }
}

// ─── Rate limit check ─────────────────────────────────────────────────────────

async function checkRateLimit(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0]

  const { count } = await supabase
    .schema('sales' as any)
    .from('vault_query_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', `${today}T00:00:00`)

  return (count ?? 0) < DAILY_QUERY_LIMIT
}

async function logQuery(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  query: string,
): Promise<void> {
  await supabase
    .schema('sales' as any)
    .from('vault_query_log')
    .insert({ user_id: userId, query: query.slice(0, 200) })
    .then(() => {})  // non-blocking, ignore error
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const supabase    = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const query: string    = body.query ?? ''
  // Whitelist docTypes — reject unknown values silently
  const docTypes: string[] = Array.isArray(body.doc_types)
    ? body.doc_types.filter((t: unknown) => typeof t === 'string' && ALLOWED_DOC_TYPES.has(t))
    : []

  if (!query.trim()) {
    return NextResponse.json({ error: 'query required' }, { status: 400 })
  }

  if (!VAULT_COLLECTION_ID) {
    return NextResponse.json(
      { error: 'Vault not configured — set CHROMA_VAULT_COLLECTION_ID in .env.local' },
      { status: 503 }
    )
  }

  // Rate limit check (non-blocking if vault_query_log table doesn't exist yet)
  try {
    const withinLimit = await checkRateLimit(supabase, user.id)
    if (!withinLimit) {
      return NextResponse.json(
        { error: 'Daily vault query limit reached (50/day). Try again tomorrow.' },
        { status: 429 }
      )
    }
  } catch {
    // Table may not exist yet — allow query to proceed
  }

  // Query vault
  const chunks = await queryVaultChunks(query, docTypes)

  if (!chunks.length) {
    return NextResponse.json({
      answer:      'No relevant vault documents found for this query.',
      sourceTypes: [],
    })
  }

  // Synthesise answer via Gemini — never expose raw chunks
  const vaultContext = chunks
    .map((c, i) => `[Doc ${i + 1} — ${c.docType}]\n${c.text}`)
    .join('\n\n---\n\n')

  const prompt = `Answer this question using ONLY the internal vault documents below. Do not add information from outside these documents. If the documents don't contain enough information to answer fully, say so clearly.

VAULT DOCUMENTS:
${vaultContext}

QUESTION: ${query}

Synthesise a precise, specific answer. If documents contain pricing, name the figures. If they contain contacts or companies, name them. Do not hedge unnecessarily. Format clearly with bullet points where relevant.`

  const answer = await queryGemini({ prompt, maxTokens: 800, temperature: 0.3 })

  // Log query (non-blocking)
  logQuery(supabase, user.id, query).catch(() => {})

  return NextResponse.json({
    answer,
    sourceTypes: [...new Set(chunks.map(c => c.docType))],
  })
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}
