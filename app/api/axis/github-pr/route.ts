// app/api/axis/github-pr/route.ts
// Server-side proxy: fetch a GitHub PR's summary from its URL.
// Keeps the GitHub token server-side; called by the consideration board.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'

export async function GET(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const url = new URL(req.url)
  const prUrl = url.searchParams.get('url') ?? ''

  // Parse: https://github.com/owner/repo/pull/number
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return NextResponse.json({ error: 'Not a valid GitHub PR URL' }, { status: 400 })

  const [, owner, repo, number] = match
  const token = process.env.GITHUB_API_TOKEN

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    next: { revalidate: 60 },
  })

  if (!res.ok) {
    const txt = await res.text()
    console.error('[github-pr]', res.status, txt)
    return NextResponse.json({ error: `GitHub returned ${res.status}` }, { status: res.status })
  }

  const pr = await res.json()
  return NextResponse.json({
    number:     pr.number,
    title:      pr.title,
    body:       pr.body,
    state:      pr.state,
    merged:     pr.merged,
    merged_at:  pr.merged_at,
    merged_by:  pr.merged_by?.login ?? null,
    head_ref:   pr.head?.ref ?? null,
    html_url:   pr.html_url,
  })
}
