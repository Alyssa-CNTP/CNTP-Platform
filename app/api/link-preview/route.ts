// app/api/link-preview/route.ts
// WhatsApp-style rich link preview. Fetches an allow-listed URL server-side
// (browsers can't, due to CORS), parses its Open Graph / meta tags, and returns
// a compact preview card payload. Cached for a day.
//
// Only the company's own public pages are allow-listed. Facebook / Instagram
// are intentionally NOT here: they serve a login wall to server bots, so a
// preview would come back blank — the client renders branded cards for those.

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const revalidate = 86400 // 1 day

const ALLOW_HOSTS = ['rooibostea.co.za', 'www.rooibostea.co.za']

function meta(html: string, ...names: string[]): string | null {
  for (const name of names) {
    // property="og:title" content="…"  OR  content="…" property="og:title"
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, 'i'),
    ]
    for (const re of patterns) {
      const m = html.match(re)
      if (m?.[1]) return decode(m[1].trim())
    }
  }
  return null
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#x27;/gi, "'")
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('url')
  if (!target) return NextResponse.json({ error: 'Missing url' }, { status: 400 })

  let parsed: URL
  try { parsed = new URL(target) } catch { return NextResponse.json({ error: 'Bad url' }, { status: 400 }) }
  if (parsed.protocol !== 'https:' || !ALLOW_HOSTS.includes(parsed.hostname)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 403 })
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(parsed.toString(), {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CNTP-Platform/1.0; link-preview)' },
      next: { revalidate },
    })
    if (!res.ok) return NextResponse.json({ error: `Upstream ${res.status}` }, { status: 502 })
    const html = (await res.text()).slice(0, 200_000) // cap parse work

    let image = meta(html, 'og:image', 'twitter:image', 'twitter:image:src')
    if (image && image.startsWith('/')) image = `${parsed.origin}${image}`

    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
    return NextResponse.json({
      url: parsed.toString(),
      title: meta(html, 'og:title', 'twitter:title') ?? (titleTag ? decode(titleTag.trim()) : parsed.hostname),
      description: meta(html, 'og:description', 'twitter:description', 'description') ?? '',
      image: image ?? null,
      siteName: meta(html, 'og:site_name') ?? parsed.hostname.replace(/^www\./, ''),
    })
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Timed out' : (e?.message ?? 'Fetch error')
    return NextResponse.json({ error: msg }, { status: 502 })
  } finally {
    clearTimeout(timer)
  }
}
