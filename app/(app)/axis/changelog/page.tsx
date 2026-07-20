'use client'

// app/(app)/axis/changelog/page.tsx

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { CommentThread } from '@/components/axis/CommentThread'
import {
  Loader2, Plus, Lock, Clock, ChevronDown, ChevronUp,
  X, CornerDownRight, Code2, Cpu, Package, Server,
  Shield, Activity, Layers, FolderOpen, GitMerge,
} from 'lucide-react'

// ─── Category taxonomy — maps to OneDrive folder structure ────────────────────

const CATEGORIES = {
  'applications-code': {
    num: '01', label: 'Applications & Code', icon: Code2,
    folder: '01_Applications & Code',
    subFolders: ['Architecture & Design', 'Changelogs & Releases', 'Deployment Records', 'Environments & Configs'],
    dot: 'bg-info', active: 'bg-info/10 text-info border-info/20',
    types: [
      'Bug Fix', 'New Feature', 'Refactor / Cleanup', 'Deployment',
      'API Change', 'Database Migration', 'Config Change', 'Dependency Update',
    ],
  },
  'ai-ml': {
    num: '02', label: 'AI & ML', icon: Cpu,
    folder: '02_AI & ML',
    subFolders: ['Models & Versions', 'Pipelines', 'Research & Experiments'],
    dot: 'bg-accent', active: 'bg-accent/10 text-accent border-accent/20',
    types: [
      'Model Update', 'Training Run', 'Dataset Change',
      'Pipeline Change', 'Prompt Engineering', 'Integration',
    ],
  },
  'software-saas': {
    num: '03', label: 'Software & SaaS', icon: Package,
    folder: '03_Software & SaaS',
    subFolders: ['Contracts & Licenses', 'Integrations & APIs', 'SaaS Configuration'],
    dot: 'bg-brand', active: 'bg-brand/10 text-brand border-brand/20',
    types: [
      'License Update', 'Configuration', 'Vendor Change',
      'Integration', 'Version Upgrade', 'Subscription Change',
    ],
  },
  'infrastructure-hardware': {
    num: '04', label: 'Infrastructure', icon: Server,
    folder: '04_Infrastructure & Hardware',
    subFolders: ['Cloud Infrastructure', 'End-User Devices', 'Network & Telecom', 'Server & Storage'],
    dot: 'bg-warn', active: 'bg-warn/10 text-warn border-warn/20',
    types: [
      'Server Change', 'Network Config', 'Hardware Addition',
      'OS Update', 'Resource Scaling', 'DNS Change', 'SSL/TLS Update',
    ],
  },
  'security-governance': {
    num: '05', label: 'Security & Governance', icon: Shield,
    folder: '05_Security & Governance',
    subFolders: ['Access & Permissions', 'Audits & Compliance', 'Contracts', 'Incident Records', 'Policies & Procedures'],
    dot: 'bg-err', active: 'bg-err/10 text-err border-err/20',
    types: [
      'Policy Update', 'Access Change', 'Vulnerability Fix',
      'Security Audit', 'Certificate Renewal', 'Firewall Rule', 'Key Rotation',
    ],
  },
  'operations-continuity': {
    num: '06', label: 'Operations', icon: Activity,
    folder: '06_Operations & Continuity',
    subFolders: ['Backups & Recovery', 'Monitoring & Alerting', 'Vendor Management', 'Warehousing'],
    dot: 'bg-ok', active: 'bg-ok/10 text-ok border-ok/20',
    types: [
      'Process Change', 'Backup Config', 'Monitoring Update',
      'Incident Response', 'DR Test', 'Automation Update',
    ],
  },
  'projects-portfolios': {
    num: '07', label: 'Projects & Portfolios', icon: Layers,
    folder: '07_Projects & Portfolios',
    subFolders: ['Active', 'Archived', 'Completed'],
    dot: 'bg-surface-rule', active: 'bg-surface-card text-text border-surface-rule',
    types: [
      'Project Kickoff', 'Milestone Reached', 'Scope Change',
      'Resource Update', 'Status Update', 'Project Closure',
    ],
  },
} as const

type CatKey = keyof typeof CATEGORIES

// Map old sector values to new categories (backward compat)
const LEGACY_MAP: Record<string, CatKey> = {
  code:          'applications-code',
  system:        'infrastructure-hardware',
  documentation: 'projects-portfolios',
}

function getCat(sector: string) {
  const key = ((sector in CATEGORIES) ? sector : (LEGACY_MAP[sector] ?? 'applications-code')) as CatKey
  return { key, ...CATEGORIES[key] }
}

// ─── Environment ──────────────────────────────────────────────────────────────

const ENVS = {
  development: { label: 'Development', badge: 'bg-surface text-text-muted border-surface-rule' },
  staging:     { label: 'Staging',     badge: 'bg-info/10 text-info border-info/20' },
  production:  { label: 'Production',  badge: 'bg-err/10 text-err border-err/20' },
  all:         { label: 'All Envs',    badge: 'bg-warn/10 text-warn border-warn/20' },
} as const

type EnvKey = keyof typeof ENVS

// ─── Risk ─────────────────────────────────────────────────────────────────────

const RISK_BADGE: Record<string, string> = {
  low:      'bg-ok/10 text-ok border-ok/20',
  medium:   'bg-info/10 text-info border-info/20',
  high:     'bg-warn/10 text-warn border-warn/20',
  critical: 'bg-err/10 text-err border-err/20',
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChangeLog {
  id: string; project_id: string | null; sector: string; sub_folder: string | null
  change_type: string; description: string; reason: string
  risk_level: string; author_id: string; reviewer_id: string | null
  review_status: string; source: string; created_at: string
  is_locked: boolean; edit_deadline: string
  environment: string | null; affected_systems: string | null
  github_pr_number?: number | null
  github_pr_url?: string | null
  github_author?: string | null
  github_avatar_url?: string | null
  github_diff_stat?: { additions: number | null; deletions: number | null; changed_files: number | null } | null
}

interface Update {
  id: string; note: string; author_id: string; created_at: string
}

interface Project { id: string; name: string }

interface FormState {
  category:        CatKey
  subFolder:       string
  changeType:      string
  customType:      string
  environment:     EnvKey
  description:     string
  reason:          string
  risk:            'low' | 'medium' | 'high' | 'critical'
  affectedSystems: string
  projectId:       string
  reviewer:        string
}

const BLANK: FormState = {
  category: 'applications-code', subFolder: '', changeType: '', customType: '',
  environment: 'development', description: '', reason: '',
  risk: 'low', affectedSystems: '', projectId: '', reviewer: '',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(s: string) {
  return new Date(s).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
function minsLeft(d: string) {
  return Math.max(0, Math.floor((new Date(d).getTime() - Date.now()) / 60000))
}
function nowLabel() {
  return new Date().toLocaleString('en-ZA', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
function needsReviewer(env: string, risk: string) {
  return env === 'production' || risk === 'high' || risk === 'critical'
}

// ─── Log row ──────────────────────────────────────────────────────────────────

function LogRow({ log, projects }: { log: ChangeLog; projects: Project[] }) {
  const [open,    setOpen]    = useState(false)
  const [updates, setUpdates] = useState<Update[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const [note,    setNote]    = useState('')
  const [posting, setPosting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const cat     = getCat(log.sector)
  const Icon    = cat.icon
  const env     = ENVS[log.environment as EnvKey] ?? null
  const project = projects.find(p => p.id === log.project_id)
  const isGithub = log.source === 'github'
  const diff     = log.github_diff_stat

  // Load updates on first expand
  useEffect(() => {
    if (!open || updates !== null) return
    setFetching(true)
    fetch(`/api/axis/changelog/${log.id}/updates`)
      .then(r => r.json())
      .then(d => { setUpdates(Array.isArray(d) ? d : []); setFetching(false) })
      .catch(() => { setUpdates([]); setFetching(false) })
  }, [open, log.id, updates])

  // Focus input on open
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60)
  }, [open])

  async function postNote() {
    if (!note.trim() || posting) return
    setPosting(true)
    const res = await fetch(`/api/axis/changelog/${log.id}/updates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note.trim() }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      setPosting(false)
      return
    }
    const fresh = await fetch(`/api/axis/changelog/${log.id}/updates`)
    setUpdates(await fresh.json())
    setNote('')
    setPosting(false)
    setTimeout(() => inputRef.current?.focus(), 60)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postNote() }
  }

  return (
    <div className="card overflow-hidden">

      {/* ── Row header ── */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-raised transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {isGithub && log.github_avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={log.github_avatar_url} alt={log.github_author ?? 'GitHub'} className="w-5 h-5 rounded-full flex-shrink-0" />
        ) : (
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cat.dot}`} />
        )}
        {!isGithub && <Icon size={13} className="text-text-muted flex-shrink-0" />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            {isGithub ? (
              <a
                href={log.github_pr_url ?? '#'}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                className="font-mono text-[9px] px-1.5 py-0.5 rounded border bg-info/10 text-info border-info/20 flex items-center gap-1 hover:bg-info/20 transition-colors"
              >
                <GitMerge size={9} /> #{log.github_pr_number}
              </a>
            ) : (
              <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${cat.active}`}>
                {cat.num} {cat.label}
              </span>
            )}
            {log.sub_folder && (
              <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${cat.active} opacity-70`}>
                ↳ {log.sub_folder}
              </span>
            )}
            {!isGithub && <span className="font-mono text-[10px] text-text-muted">{log.change_type}</span>}
            {isGithub && log.github_author && (
              <span className="font-mono text-[10px] text-text-muted">by {log.github_author}</span>
            )}
            {env && (
              <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${env.badge}`}>
                {env.label.toLowerCase()}
              </span>
            )}
            {log.review_status === 'pending' && (
              <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border bg-warn/10 text-warn border-warn/20">
                needs review
              </span>
            )}
            {project && (
              <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border bg-surface text-text-muted border-surface-rule">
                ↳ {project.name}
              </span>
            )}
          </div>
          <p className="text-[12px] text-text line-clamp-1">{log.description}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {diff && (diff.additions !== null || diff.deletions !== null) && (
            <span className="font-mono text-[10px] flex items-center gap-1">
              <span className="text-ok">+{diff.additions ?? 0}</span>
              <span className="text-err">−{diff.deletions ?? 0}</span>
            </span>
          )}
          {updates && updates.length > 0 && (
            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-full bg-surface border border-surface-rule text-text-faint">
              {updates.length}
            </span>
          )}
          {!isGithub && (
            <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${RISK_BADGE[log.risk_level] ?? ''}`}>
              {log.risk_level}
            </span>
          )}
          <span className="font-mono text-[10px] text-text-faint hidden md:block">{fmt(log.created_at)}</span>
          {log.is_locked
            ? <Lock size={11} className="text-text-faint" />
            : log.edit_deadline
              ? <span className="font-mono text-[9px] text-warn">{minsLeft(log.edit_deadline)}m</span>
              : null
          }
          {open
            ? <ChevronUp  size={13} className="text-text-faint" />
            : <ChevronDown size={13} className="text-text-faint" />
          }
        </div>
      </div>

      {/* ── Expanded body ── */}
      {open && (
        <div className="border-t border-surface-rule">

          {/* Metadata grid */}
          <div className="px-4 pt-3 pb-3 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3">
            {log.reason && (
              <div className="sm:col-span-3">
                <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint mb-0.5">Why</p>
                <p className="text-[12px] text-text-muted">{log.reason}</p>
              </div>
            )}
            {log.affected_systems && (
              <div className="sm:col-span-2">
                <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint mb-0.5">Affected Systems</p>
                <p className="text-[12px] text-text-muted">{log.affected_systems}</p>
              </div>
            )}
            {isGithub ? (
              <div>
                <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint mb-0.5">GitHub PR</p>
                <a href={log.github_pr_url ?? '#'} target="_blank" rel="noreferrer"
                  className="font-mono text-[10px] text-info hover:underline">
                  {log.github_pr_url}
                </a>
              </div>
            ) : (
              <div>
                <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint mb-0.5">OneDrive folder</p>
                <p className="font-mono text-[10px] text-text-muted">
                  {cat.folder}{log.sub_folder ? ` / ${log.sub_folder}` : ''}
                </p>
              </div>
            )}
          </div>

          {/* Progress timeline */}
          {fetching ? (
            <div className="px-4 py-3 flex items-center gap-2 border-t border-surface-rule">
              <Loader2 size={11} className="animate-spin text-text-faint" />
              <span className="text-[11px] text-text-faint">Loading steps…</span>
            </div>
          ) : updates && updates.length > 0 ? (
            <div className="px-4 py-3 border-t border-surface-rule">
              <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint mb-3">
                Progress · {updates.length} step{updates.length !== 1 ? 's' : ''}
              </p>
              <div className="relative pl-4 space-y-3">
                <div className="absolute left-0 top-1 bottom-1 w-px bg-surface-rule" />
                {updates.map((u, i) => (
                  <div key={u.id} className="flex items-start gap-2.5">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[5px] -ml-[3px] ${
                      i === updates.length - 1 ? 'bg-brand' : 'bg-surface-rule border border-text-faint'
                    }`} />
                    <div className="flex-1 min-w-0 -mt-px">
                      <p className="text-[12px] text-text leading-snug">{u.note}</p>
                      <p className="font-mono text-[9px] text-text-faint mt-0.5">{fmt(u.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Quick-log input */}
          <div className="px-4 py-3 border-t border-surface-rule flex items-center gap-2">
            <CornerDownRight size={11} className="text-text-faint flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={handleKey}
              placeholder="What did you do? Press Enter to save."
              className="flex-1 px-3 py-2 rounded-lg border border-surface-rule bg-surface text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card"
            />
            <button
              onClick={postNote}
              disabled={!note.trim() || posting}
              className="px-3 py-2 rounded-lg bg-brand text-white text-[12px] font-semibold hover:bg-brand-hover disabled:opacity-40 flex items-center gap-1.5 flex-shrink-0"
            >
              {posting ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Log
            </button>
          </div>

          {/* Comments */}
          <div className="px-4 py-3 border-t border-surface-rule">
            <CommentThread entityType="change_log" entityId={log.id} variant="light" />
          </div>

        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChangelogPage() {
  const { isIT, loading: al } = useAuth()
  const router = useRouter()

  const [logs,     setLogs]     = useState<ChangeLog[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterCat,    setFilterCat]    = useState<CatKey | 'all'>('all')
  const [filterFolder, setFilterFolder] = useState<string>('all')
  const [filterEnv,    setFilterEnv]    = useState<EnvKey | 'all'>('all')

  const [form,    setForm]    = useState<FormState>(BLANK)
  const [saving,  setSaving]  = useState(false)
  const [nowStr,  setNowStr]  = useState('')

  useEffect(() => { if (!al && !isIT) router.replace('/dashboard') }, [isIT, al, router])

  // Reset sub-folder + change type when category changes
  useEffect(() => {
    const types = CATEGORIES[form.category].types as readonly string[]
    setForm(f => ({
      ...f,
      subFolder: '',
      ...(f.changeType && !(types as readonly string[]).includes(f.changeType)
        ? { changeType: '', customType: '' }
        : {}),
    }))
  }, [form.category]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live clock in form
  useEffect(() => {
    if (!showForm) return
    setNowStr(nowLabel())
    const t = setInterval(() => setNowStr(nowLabel()), 60_000)
    return () => clearInterval(t)
  }, [showForm])

  const load = useCallback(async () => {
    // Try the GitHub-backed feed first (it syncs new merged PRs into the same
    // table and returns the unified list). Falls back to the plain manual
    // list if GitHub isn't configured (503) — degrades gracefully either way.
    const [logsRes, projectsRes] = await Promise.all([
      fetch('/api/axis/changelog/github').then(r => r.ok ? r : fetch('/api/axis/changelog')),
      fetch('/api/axis/projects'),
    ])
    if (logsRes.ok) {
      const data = await logsRes.json()
      setLogs(Array.isArray(data) ? data : [])
    }
    if (projectsRes.ok) {
      const data = await projectsRes.json()
      setProjects(Array.isArray(data) ? data : [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { if (!al && isIT) load() }, [al, isIT, load])

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleSubmit() {
    const type = form.changeType === 'Other...'
      ? form.customType.trim()
      : form.changeType

    if (!type)              { alert('Select or enter a change type.'); return }
    if (!form.description.trim()) { alert('Enter a description.'); return }
    if (needsReviewer(form.environment, form.risk) && !form.reviewer.trim()) {
      alert('A reviewer is required for production or high-risk changes.')
      return
    }
    setSaving(true)
    const res = await fetch('/api/axis/changelog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sector:           form.category,
        sub_folder:       form.subFolder || null,
        change_type:      type,
        environment:      form.environment,
        description:      form.description.trim(),
        reason:           form.reason.trim(),
        risk_level:       form.risk,
        affected_systems: form.affectedSystems.trim() || null,
        project_id:       form.projectId || null,
        reviewer_id:      form.reviewer.trim() || null,
        review_status:    needsReviewer(form.environment, form.risk) ? 'pending' : 'not_required',
      }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      setSaving(false)
      return
    }
    setForm(BLANK)
    setShowForm(false)
    setSaving(false)
    await load()
  }

  if (al || loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 size={18} className="animate-spin text-text-faint" />
    </div>
  )

  const filtered = logs.filter(l => {
    if (filterCat !== 'all') {
      const key = (l.sector in CATEGORIES)
        ? l.sector
        : (LEGACY_MAP[l.sector] ?? 'applications-code')
      if (key !== filterCat) return false
    }
    if (filterFolder !== 'all' && (l.sub_folder ?? '') !== filterFolder) return false
    if (filterEnv !== 'all' && l.environment !== filterEnv) return false
    return true
  })

  // Group filtered logs by sub_folder (only meaningful when a category is selected)
  const grouped: { label: string | null; items: ChangeLog[] }[] = (() => {
    if (filterCat === 'all') return [{ label: null, items: filtered }]
    const subFolders = (CATEGORIES[filterCat as CatKey].subFolders as readonly string[])
    const groups: { label: string | null; items: ChangeLog[] }[] = subFolders
      .map(sf => ({ label: sf as string | null, items: filtered.filter(l => l.sub_folder === sf) }))
      .filter(g => g.items.length > 0)
    const ungrouped = filtered.filter(l => !l.sub_folder)
    if (ungrouped.length > 0) groups.push({ label: null, items: ungrouped })
    return groups
  })()

  const activeCat = CATEGORIES[form.category]

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Category filter */}
        <select
          value={filterCat}
          onChange={e => { setFilterCat(e.target.value as CatKey | 'all'); setFilterFolder('all') }}
          className="px-3 py-2 rounded-xl border border-surface-rule bg-surface text-[12px] text-text focus:outline-none focus:border-brand/40"
        >
          <option value="all">All categories</option>
          {(Object.entries(CATEGORIES) as [CatKey, typeof CATEGORIES[CatKey]][]).map(([k, c]) => (
            <option key={k} value={k}>{c.num} {c.label}</option>
          ))}
        </select>

        {/* Sub-folder filter — only shown when a category is selected */}
        {filterCat !== 'all' && (
          <select
            value={filterFolder}
            onChange={e => setFilterFolder(e.target.value)}
            className="px-3 py-2 rounded-xl border border-surface-rule bg-surface text-[12px] text-text focus:outline-none focus:border-brand/40"
          >
            <option value="all">All folders</option>
            {(CATEGORIES[filterCat as CatKey].subFolders as readonly string[]).map(sf => (
              <option key={sf} value={sf}>{sf}</option>
            ))}
          </select>
        )}

        {/* Environment filter */}
        <select
          value={filterEnv}
          onChange={e => setFilterEnv(e.target.value as EnvKey | 'all')}
          className="px-3 py-2 rounded-xl border border-surface-rule bg-surface text-[12px] text-text focus:outline-none focus:border-brand/40"
        >
          <option value="all">All environments</option>
          {(Object.entries(ENVS) as [EnvKey, typeof ENVS[EnvKey]][]).map(([k, e]) => (
            <option key={k} value={k}>{e.label}</option>
          ))}
        </select>

        <div className="flex-1" />

        <button
          onClick={() => { setForm(BLANK); setShowForm(s => !s) }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
            showForm
              ? 'border border-surface-rule text-text-muted hover:bg-surface-card bg-surface'
              : 'bg-brand text-white hover:bg-brand-hover'
          }`}
        >
          {showForm ? <><X size={13} /> Cancel</> : <><Plus size={13} /> Log change</>}
        </button>
      </div>

      {/* ── New entry form ── */}
      {showForm && (
        <div className="card p-5 space-y-5">

          {/* Form header */}
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted font-semibold">
              New change log
            </p>
            {nowStr && (
              <span className="font-mono text-[10px] text-text-faint flex items-center gap-1">
                <Clock size={10} /> {nowStr} — timestamp auto-saved
              </span>
            )}
          </div>

          {/* ① Category */}
          <div>
            <label className="block font-mono text-[9px] uppercase tracking-wide text-text-muted mb-2">
              What area does this change affect?
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(Object.entries(CATEGORIES) as [CatKey, typeof CATEGORIES[CatKey]][]).map(([k, c]) => {
                const Icon = c.icon
                const selected = form.category === k
                return (
                  <button
                    key={k}
                    onClick={() => set('category', k)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all ${
                      selected ? c.active : 'border-surface-rule text-text-muted hover:bg-surface-card bg-surface'
                    }`}
                  >
                    <Icon size={13} className="flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="font-mono text-[8px] text-current opacity-60 leading-none mb-0.5">{c.num}</p>
                      <p className="text-[11px] font-semibold leading-tight line-clamp-2">{c.label}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ② Sub-folder */}
          <div>
            <label className="block font-mono text-[9px] uppercase tracking-wide text-text-muted mb-2">
              Which folder does this log belong in?
            </label>
            <div className="flex flex-wrap gap-2">
              {(activeCat.subFolders as readonly string[]).map(sf => (
                <button
                  key={sf}
                  onClick={() => set('subFolder', sf)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[11px] font-semibold transition-all ${
                    form.subFolder === sf
                      ? activeCat.active
                      : 'border-surface-rule text-text-muted hover:bg-surface-card bg-surface'
                  }`}
                >
                  <FolderOpen size={11} className="flex-shrink-0" />
                  {sf}
                </button>
              ))}
            </div>
          </div>

          {/* ③ Change type + Environment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1.5">
                Type of change
              </label>
              <select
                value={form.changeType}
                onChange={e => set('changeType', e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-surface-rule bg-surface text-[12px] text-text focus:outline-none focus:border-brand/40"
              >
                <option value="">— Select —</option>
                {activeCat.types.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
                <option value="Other...">Other…</option>
              </select>
              {form.changeType === 'Other...' && (
                <input
                  type="text"
                  value={form.customType}
                  onChange={e => set('customType', e.target.value)}
                  placeholder="Describe the change type"
                  className="w-full mt-2 px-3 py-2.5 rounded-xl border border-surface-rule bg-surface text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card"
                />
              )}
            </div>
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1.5">
                Environment
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.entries(ENVS) as [EnvKey, typeof ENVS[EnvKey]][]).map(([k, e]) => (
                  <button
                    key={k}
                    onClick={() => set('environment', k)}
                    className={`py-2 rounded-xl text-[11px] font-semibold border transition-all ${
                      form.environment === k
                        ? e.badge
                        : 'border-surface-rule text-text-muted hover:bg-surface-card bg-surface'
                    }`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ④ Description */}
          <div>
            <label className="block font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1.5">
              What was changed?
            </label>
            <textarea
              rows={3}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Be specific — include file names, endpoints, services, or components involved."
              className="w-full px-3 py-2.5 rounded-xl border border-surface-rule bg-surface text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card resize-none"
            />
          </div>

          {/* ⑤ Reason + Affected systems */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1.5">
                Why was this change made?
              </label>
              <input
                type="text"
                value={form.reason}
                onChange={e => set('reason', e.target.value)}
                placeholder="Business or technical justification"
                className="w-full px-3 py-2.5 rounded-xl border border-surface-rule bg-surface text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card"
              />
            </div>
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1.5">
                What systems or services are affected?
              </label>
              <input
                type="text"
                value={form.affectedSystems}
                onChange={e => set('affectedSystems', e.target.value)}
                placeholder="e.g. API gateway, VPS, n8n workflows"
                className="w-full px-3 py-2.5 rounded-xl border border-surface-rule bg-surface text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card"
              />
            </div>
          </div>

          {/* ⑥ Risk */}
          <div>
            <label className="block font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1.5">
              Risk level
            </label>
            <div className="flex gap-2">
              {(['low', 'medium', 'high', 'critical'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => set('risk', r)}
                  className={`flex-1 py-2 rounded-xl text-[11px] font-semibold border transition-all capitalize ${
                    form.risk === r ? RISK_BADGE[r] : 'border-surface-rule text-text-muted hover:bg-surface-card bg-surface'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* ⑦ Project + Reviewer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1.5">
                Linked project <span className="normal-case text-text-faint">(optional)</span>
              </label>
              <select
                value={form.projectId}
                onChange={e => set('projectId', e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-surface-rule bg-surface text-[12px] text-text focus:outline-none focus:border-brand/40"
              >
                <option value="">None</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {needsReviewer(form.environment, form.risk) && (
              <div>
                <label className="block font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1.5">
                  Reviewer <span className="text-err">*</span>
                  <span className="normal-case text-text-faint ml-1">
                    — required for {form.environment === 'production' ? 'production' : 'high-risk'} changes
                  </span>
                </label>
                <input
                  type="text"
                  value={form.reviewer}
                  onChange={e => set('reviewer', e.target.value)}
                  placeholder="Name or email of reviewer"
                  className="w-full px-3 py-2.5 rounded-xl border border-surface-rule bg-surface text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card"
                />
              </div>
            )}
          </div>

          {/* ⑧ Documentation folder banner */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface border border-surface-rule">
            <FolderOpen size={13} className="text-text-faint flex-shrink-0" />
            <p className="text-[11px] text-text-muted">
              OneDrive path:{' '}
              <span className="font-mono text-[10px] text-text">
                {activeCat.folder}{form.subFolder ? ` / ${form.subFolder}` : ''}
              </span>
            </p>
          </div>

          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand text-white text-[12px] font-semibold hover:bg-brand-hover disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Create log entry
          </button>
        </div>
      )}

      {/* ── Log list (grouped by sub-folder when a category is active) ── */}
      {filtered.length === 0 ? (
        <div className="card p-12 flex flex-col items-center gap-3 text-center">
          <Layers size={26} className="text-text-faint" />
          <p className="font-semibold text-[14px] text-text-muted">
            {filterCat === 'all' && filterEnv === 'all'
              ? 'No changes logged yet'
              : 'No entries match the current filters'
            }
          </p>
          {filterCat === 'all' && filterEnv === 'all' && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-[12px] font-semibold hover:bg-brand-hover"
            >
              <Plus size={13} /> Log your first change
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <div className="flex items-center gap-2 mb-2 px-1">
                  <FolderOpen size={13} className="text-text-faint" />
                  <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">
                    {group.label}
                  </span>
                  <span className="font-mono text-[9px] text-text-faint">
                    {group.items.length} {group.items.length === 1 ? 'entry' : 'entries'}
                  </span>
                </div>
              )}
              <div className="space-y-1.5">
                {group.items.map(log => (
                  <LogRow key={log.id} log={log} projects={projects} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
