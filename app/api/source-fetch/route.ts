// app/api/source-fetch/route.ts
// Proxies a source URL server-side — keeps CNTP identity out of outbound headers,
// avoids browser CORS restrictions, and extracts readable text for AI analysis.

import { NextResponse }      from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies }            from 'next/headers'

export const maxDuration = 20

const MAX_CHARS = 4000

function extractText(html: string): { title: string; text: string } {
  // Pull <title>
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : ''

  // Remove scripts, styles, nav, footer, header blocks
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')

  // Strip remaining tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ')

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2019;/g, "'")
    .replace(/&#x201[CD];/g, '"')

  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  return { title, text: cleaned.slice(0, MAX_CHARS) }
}

export async function GET(req: Request) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const url = searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  // Validate it's a real http/https URL
  let parsed: URL
  try { parsed = new URL(url) } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return NextResponse.json({ error: 'Invalid protocol' }, { status: 400 })
  }

  try {
    const res = await fetch(url, {
      headers: {
        // Generic user-agent — no CNTP identifiers
        'User-Agent': 'Mozilla/5.0 (compatible; research-bot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: `Source returned ${res.status}`, title: '', text: '' },
        { status: 200 } // return 200 so the UI can show the error gracefully
      )
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return NextResponse.json({ error: 'Non-text source', title: '', text: '' })
    }

    const html = await res.text()
    const { title, text } = extractText(html)

    return NextResponse.json({ title, text, domain: parsed.hostname })
  } catch (err: any) {
    const msg = err?.name === 'TimeoutError' ? 'Source timed out' : 'Failed to fetch source'
    return NextResponse.json({ error: msg, title: '', text: '' })
  }
}
