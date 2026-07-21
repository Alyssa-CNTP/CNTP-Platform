// lib/github/client.ts
// Minimal read-only GitHub REST client for the AXIS changelog's automatic
// commit/PR feed. Mirrors lib/acumatica/odata.ts's shape: getGitHubConfig()
// reads env, returns null when unconfigured so the route can answer 503
// instead of throwing. Plain fetch — no octokit SDK, matching the existing
// github-pr proxy route's house style.

export interface GitHubConfig {
  owner: string
  repo:  string
  token: string | null // optional — unauthenticated requests work but are rate-limited
}

export function getGitHubConfig(): GitHubConfig | null {
  const owner = process.env.GITHUB_REPO_OWNER ?? ''
  const repo  = process.env.GITHUB_REPO_NAME  ?? ''
  if (!owner || !repo) return null
  return { owner, repo, token: process.env.GITHUB_API_TOKEN || null }
}

function headers(cfg: GitHubConfig): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
  }
}

export interface MergedPR {
  number:        number
  title:         string
  html_url:      string
  merged_at:     string
  author_login:  string | null
  author_avatar: string | null
  additions:     number | null
  deletions:     number | null
  changed_files: number | null
}

// Lists recently-updated closed PRs against `base`, filtered to merged-only.
// GitHub's list endpoint has no server-side "merged" filter, only "closed".
// Defaults to 'staging' — this repo's workflow merges feature branches to
// staging (which auto-deploys), not main (see CLAUDE.md), so that's where
// "what's actually shipping" shows up.
export async function fetchMergedPRs(cfg: GitHubConfig, opts: { base?: string; perPage?: number } = {}): Promise<MergedPR[]> {
  const base    = opts.base ?? 'staging'
  const perPage = opts.perPage ?? 30

  const res = await fetch(
    `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/pulls?state=closed&base=${base}&sort=updated&direction=desc&per_page=${perPage}`,
    { headers: headers(cfg), next: { revalidate: 300 } }
  )
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`)

  const list: any[] = await res.json()
  return list
    .filter(pr => pr.merged_at)
    .map(pr => ({
      number:        pr.number,
      title:         pr.title,
      html_url:      pr.html_url,
      merged_at:     pr.merged_at,
      author_login:  pr.user?.login ?? null,
      author_avatar: pr.user?.avatar_url ?? null,
      additions:     null,
      deletions:     null,
      changed_files: null,
    }))
}

// Full PR detail (diff stat) — only worth fetching for PRs not already stored,
// since this is a per-PR call and the list endpoint above doesn't include stats.
export async function fetchPRDetail(cfg: GitHubConfig, number: number): Promise<Pick<MergedPR, 'additions' | 'deletions' | 'changed_files'>> {
  const res = await fetch(
    `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/pulls/${number}`,
    { headers: headers(cfg), next: { revalidate: 3600 } }
  )
  if (!res.ok) return { additions: null, deletions: null, changed_files: null }
  const pr = await res.json()
  return {
    additions:     pr.additions ?? null,
    deletions:     pr.deletions ?? null,
    changed_files: pr.changed_files ?? null,
  }
}
