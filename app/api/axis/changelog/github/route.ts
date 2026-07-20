// app/api/axis/changelog/github/route.ts
// Pulls recently-merged GitHub PRs and ingests any not already stored into
// axis.change_logs as source='github' rows, alongside manual entries.
// Called on-demand when the Changelog page loads (no cron needed — this is a
// low-traffic internal admin page; the client's own revalidate window on the
// GitHub API calls keeps repeat loads cheap).

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { getGitHubConfig, fetchMergedPRs, fetchPRDetail } from '@/lib/github/client'

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const cfg = getGitHubConfig()
  if (!cfg) return NextResponse.json({ error: 'GitHub integration not configured' }, { status: 503 })

  const axis = (getAdminClient() as any).schema('axis')

  let merged
  try {
    merged = await fetchMergedPRs(cfg)
  } catch (err: any) {
    console.error('[api/axis/changelog/github GET] fetch failed', err)
    return NextResponse.json({ error: err?.message ?? 'GitHub fetch failed' }, { status: 502 })
  }

  const { data: existing } = await axis
    .from('change_logs')
    .select('github_pr_number')
    .not('github_pr_number', 'is', null)

  const known = new Set((existing ?? []).map((r: any) => r.github_pr_number))
  const fresh = merged.filter(pr => !known.has(pr.number))

  if (fresh.length > 0) {
    const rows = await Promise.all(fresh.map(async pr => {
      const detail = await fetchPRDetail(cfg, pr.number)
      return {
        sector:            'applications-code',
        change_type:       'PR Merged',
        description:        pr.title,
        reason:            '',
        risk_level:        'low',
        review_status:     'not_required',
        source:            'github',
        environment:       'staging',
        author_id:         caller.userId,
        github_pr_number:  pr.number,
        github_pr_url:     pr.html_url,
        github_author:     pr.author_login,
        github_avatar_url: pr.author_avatar,
        github_diff_stat:  detail,
        created_at:        pr.merged_at,
      }
    }))

    const { error } = await axis.from('change_logs').insert(rows)
    if (error) console.error('[api/axis/changelog/github GET] insert failed', error)
  }

  const { data, error } = await axis
    .from('change_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
