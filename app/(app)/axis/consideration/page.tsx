'use client'

// app/(app)/axis/consideration/page.tsx
// IT-only triage board — master-detail layout.
//   • Left pane: searchable / filterable / sortable list of requests
//   • Right pane: selected request — metadata + comment thread + decision actions
//   • Comments thread lives ON the request so IT and submitter can discuss before deciding

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { CommentThread } from '@/components/axis/CommentThread'
import {
  Loader2, CheckCircle2, XCircle, Inbox,
  GitBranch, Link2, Database, Bot, User, Shield,
  CheckSquare, Square, AlertTriangle, ExternalLink, Search,
  ChevronDown, Filter, Github,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectRequest {
  id: string; title: string; description: string
  business_justification: string; urgency: string
  requesting_dept: string; submitted_by: string
  status: string; rejection_reason: string | null; created_at: string
  reviewed_at?: string | null
  reviewed_by_name?: string | null
  resolution_note?: string | null
  github_pr_url?: string | null
  // Code contribution extras
  submission_type?: string
  onedrive_url?: string | null
  schema_proposal?: { schema_name?: string; tables_affected?: string } | null
  code_source?: string | null
  ai_tool_used?: string | null
  code_author?: string | null
  preflight_checklist?: Record<string, boolean> | null
}

interface ApprovalForm {
  priority: 'high' | 'mid' | 'low'
  term: 'short' | 'long' | 'ongoing'
  effort_size: 'S' | 'M' | 'L' | 'XL'
  target_start: string; target_end: string
  hard_deadline: boolean; deadline_reason: string
  tracks: string[]
  resolution_note: string
  github_pr_url: string
}

interface GithubPR {
  number: number; title: string; body: string | null
  state: string; merged: boolean; merged_at: string | null
  merged_by: string | null; head_ref: string | null; html_url: string
}

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all'
type SortBy       = 'newest' | 'oldest' | 'urgency'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_FORM: ApprovalForm = {
  priority: 'mid', term: 'short', effort_size: 'M',
  target_start: '', target_end: '', hard_deadline: false,
  deadline_reason: '', tracks: ['technology', 'documentation'],
  resolution_note: '', github_pr_url: '',
}

const ALL_TRACKS = [
  { key: 'process',        label: 'Process / Ops' },
  { key: 'technology',     label: 'Technology' },
  { key: 'compliance',     label: 'Compliance' },
  { key: 'documentation',  label: 'Docs' },
  { key: 'training',       label: 'Training' },
  { key: 'infrastructure', label: 'Infrastructure' },
]

const URGENCY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

const URGENCY_BADGE: Record<string, string> = {
  critical: 'bg-err/10 text-err border-err/20',
  high:     'bg-warn/10 text-warn border-warn/20',
  medium:   'bg-info/10 text-info border-info/20',
  low:      'bg-surface text-text-muted border-surface-rule',
}
const URGENCY_BAR: Record<string, string> = {
  critical: 'bg-err', high: 'bg-warn', medium: 'bg-info', low: 'bg-surface-rule',
}

const DEPT_BADGE: Record<string, string> = {
  IT:         'bg-purple-50 text-purple-700 border-purple-200',
  Quality:    'bg-blue-50 text-blue-700 border-blue-200',
  Production: 'bg-amber-50 text-amber-700 border-amber-200',
  Management: 'bg-stone-100 text-stone-600 border-stone-200',
  Sales:      'bg-green-50 text-green-700 border-green-200',
  Marketing:  'bg-pink-50 text-pink-700 border-pink-200',
}

const STATUS_BADGE: Record<string, string> = {
  pending:      'bg-warn/10 text-warn border-warn/20',
  under_review: 'bg-info/10 text-info border-info/20',
  approved:     'bg-ok/10 text-ok border-ok/20',
  rejected:     'bg-err/10 text-err border-err/20',
}

const IT_AUDIT_ITEMS = [
  { key: 'schema_verified',    label: 'Schema name verified — correct department schema, not public' },
  { key: 'no_public_writes',   label: 'No writes to the public schema found in any submitted code' },
  { key: 'encoding_verified',  label: 'File encoding verified as UTF-8 without BOM' },
  { key: 'no_credentials',     label: 'No hardcoded credentials, API keys, or secrets found' },
  { key: 'migration_reviewed', label: 'Database migration script is clean and reversible' },
  { key: 'OneDrive_reviewed',  label: 'OneDrive files downloaded and code logic reviewed' },
  { key: 'rls_defined',        label: 'RLS policies are defined for all new tables' },
  { key: 'staging_planned',    label: 'Staging deployment and test plan confirmed before production' },
]

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}
function timeAgo(s: string) {
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000)
  if (m < 60)   return `${m}m`
  if (m < 1440) return `${Math.floor(m / 60)}h`
  return `${Math.floor(m / 1440)}d`
}

// ─── GitHub PR card ───────────────────────────────────────────────────────────

function GithubPRCard({ url }: { url: string }) {
  const [pr,      setPR]      = useState<GithubPR | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setError(null); setPR(null)
    fetch(`/api/axis/github-pr?url=${encodeURIComponent(url)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setPR(d) })
      .catch(() => setError('Could not reach GitHub'))
      .finally(() => setLoading(false))
  }, [url])

  if (loading) return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-surface-rule text-text-faint text-[12px]">
      <Loader2 size={12} className="animate-spin" /> Fetching PR…
    </div>
  )
  if (error || !pr) return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2 px-4 py-3 rounded-xl border border-surface-rule text-[12px] text-brand hover:underline">
      <Github size={13} /> View PR on GitHub <ExternalLink size={11} />
    </a>
  )

  const isMerged = pr.merged
  const bodyPreview = pr.body ? (pr.body.length > 200 ? pr.body.slice(0, 197) + '…' : pr.body) : null

  return (
    <a href={pr.html_url} target="_blank" rel="noopener noreferrer"
      className="block px-4 py-3 rounded-xl border border-surface-rule hover:border-brand/30 hover:bg-surface-card transition-colors no-underline">
      <div className="flex items-start gap-3">
        <Github size={14} className={isMerged ? 'text-purple-600 flex-shrink-0 mt-0.5' : 'text-ok flex-shrink-0 mt-0.5'} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${
              isMerged ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-ok/10 text-ok border-ok/20'
            }`}>
              {isMerged ? 'merged' : pr.state}
            </span>
            <span className="font-mono text-[10px] text-text-faint">#{pr.number}</span>
            {pr.head_ref && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-muted border border-surface-rule flex items-center gap-1">
                <GitBranch size={9} /> {pr.head_ref}
              </span>
            )}
            {pr.merged_by && (
              <span className="font-mono text-[10px] text-text-faint ml-auto">by {pr.merged_by}</span>
            )}
          </div>
          <p className="text-[13px] font-semibold text-text leading-snug">{pr.title}</p>
          {bodyPreview && (
            <p className="text-[11px] text-text-muted mt-1 leading-snug whitespace-pre-line">{bodyPreview}</p>
          )}
        </div>
        <ExternalLink size={11} className="text-text-faint flex-shrink-0 mt-1" />
      </div>
    </a>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// List item (left pane row)
// ═════════════════════════════════════════════════════════════════════════════

function ListRow({ req, selected, onClick }: {
  req: ProjectRequest; selected: boolean; onClick: () => void
}) {
  const isCode = req.submission_type === 'code_contribution'
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-stretch gap-3 px-4 py-3 text-left transition-colors border-l-2 ${
        selected
          ? 'bg-surface-card border-l-brand'
          : 'border-l-transparent hover:bg-surface-raised'
      }`}
    >
      <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${URGENCY_BAR[req.urgency] ?? 'bg-surface-rule'}`}
        style={{ minHeight: 22 }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${URGENCY_BADGE[req.urgency] ?? ''}`}>
            {req.urgency}
          </span>
          <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${DEPT_BADGE[req.requesting_dept] ?? 'bg-surface text-text-faint border-surface-rule'}`}>
            {req.requesting_dept}
          </span>
          {isCode && (
            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200 flex items-center gap-1">
              <GitBranch size={9} /> Code
            </span>
          )}
          <span className="font-mono text-[10px] text-text-faint ml-auto">{timeAgo(req.created_at)}</span>
        </div>
        <p className={`text-[13px] leading-snug line-clamp-2 ${selected ? 'font-semibold text-text' : 'text-text font-medium'}`}>
          {req.title}
        </p>
      </div>
    </button>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Detail pane
// ═════════════════════════════════════════════════════════════════════════════

function RequestDetail({ req, onApprove, onReject }: {
  req: ProjectRequest
  onApprove: (id: string, form: ApprovalForm, auditChecklist?: Record<string, boolean>) => Promise<void>
  onReject:  (id: string, reason: string) => Promise<void>
}) {
  const [action,       setAction]       = useState<'approve' | 'reject' | null>(null)
  const [form,         setForm]         = useState<ApprovalForm>(DEFAULT_FORM)
  const [rejectReason, setRejectReason] = useState('')
  const [audit,        setAudit]        = useState<Record<string, boolean>>({})
  const [saving,       setSaving]       = useState(false)

  // Reset action state whenever the selected request changes
  useEffect(() => {
    setAction(null)
    setForm(DEFAULT_FORM)
    setRejectReason('')
    setAudit({})
  }, [req.id])

  const isCode       = req.submission_type === 'code_contribution'
  const isAiGen      = req.code_source === 'ai_generated'
  const allAuditDone = isCode ? IT_AUDIT_ITEMS.every(i => audit[i.key]) : true
  const isReviewed   = req.status === 'approved' || req.status === 'rejected'

  const preflightItems  = req.preflight_checklist ? Object.entries(req.preflight_checklist) : []
  const preflightPassed = preflightItems.length > 0 && preflightItems.every(([, v]) => v)

  function toggleTrack(key: string) {
    setForm(f => ({ ...f, tracks: f.tracks.includes(key) ? f.tracks.filter(t => t !== key) : [...f.tracks, key] }))
  }

  async function handleApprove() {
    if (!form.tracks.length) { alert('Select at least one project track.'); return }
    if (isCode && !allAuditDone) { alert('Complete the IT Audit Checklist before approving a Code Contribution.'); return }
    setSaving(true)
    await onApprove(req.id, form, isCode ? audit : undefined)
    setSaving(false)
  }

  async function handleReject() {
    if (!rejectReason.trim()) { alert('Provide a rejection reason.'); return }
    setSaving(true)
    await onReject(req.id, rejectReason.trim())
    setSaving(false)
  }

  return (
    <div className="flex flex-col h-full">

      {/* Code Contribution banner */}
      {isCode && (
        <div className="flex items-center gap-2 px-6 py-2.5 bg-amber-50 border-b border-amber-100 flex-shrink-0">
          <GitBranch size={12} className="text-amber-600" />
          <span className="font-mono text-[10px] font-bold text-amber-700 uppercase tracking-wide">
            Code Contribution — Full IT Audit Required
          </span>
          {isAiGen && (
            <span className="flex items-center gap-1 ml-auto font-mono text-[9px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
              <Bot size={9} /> AI-generated
            </span>
          )}
        </div>
      )}

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6 max-w-3xl">

          {/* Title + meta */}
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={`font-mono text-[10px] px-2 py-0.5 rounded border ${URGENCY_BADGE[req.urgency] ?? ''}`}>
                {req.urgency}
              </span>
              <span className={`font-mono text-[10px] px-2 py-0.5 rounded border ${DEPT_BADGE[req.requesting_dept] ?? ''}`}>
                {req.requesting_dept}
              </span>
              <span className={`font-mono text-[10px] px-2 py-0.5 rounded border ${STATUS_BADGE[req.status] ?? ''}`}>
                {req.status === 'under_review' ? 'in review' : req.status}
              </span>
              {isCode && preflightPassed && (
                <span className="font-mono text-[10px] px-2 py-0.5 rounded border bg-ok/10 text-ok border-ok/20 flex items-center gap-1">
                  <CheckCircle2 size={10} /> pre-flight passed
                </span>
              )}
              <span className="text-[11px] text-text-faint ml-auto">
                submitted {fmtDate(req.created_at)}
                {req.reviewed_at && ` · reviewed ${fmtDate(req.reviewed_at)}`}
              </span>
            </div>
            <h2 className="font-display font-bold text-[20px] text-text leading-tight">{req.title}</h2>
          </div>

          {/* Description */}
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint mb-1.5">Description</p>
            <p className="text-[13px] text-text leading-relaxed whitespace-pre-wrap">{req.description}</p>
          </div>

          {/* Business justification */}
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint mb-1.5">Business justification</p>
            <p className="text-[13px] text-text leading-relaxed whitespace-pre-wrap">{req.business_justification}</p>
          </div>

          {/* Rejection reason (if rejected) */}
          {req.status === 'rejected' && req.rejection_reason && (
            <div className="p-4 rounded-xl bg-err/5 border border-err/20">
              <p className="font-mono text-[9px] uppercase tracking-wide text-err mb-1.5">Rejected — reason sent to submitter</p>
              <p className="text-[13px] text-text">{req.rejection_reason}</p>
            </div>
          )}

          {/* ── Resolution summary (shown after approval/rejection) ── */}
          {isReviewed && (req.resolution_note || req.github_pr_url || req.reviewed_by_name) && (
            <div className={`p-4 rounded-xl border space-y-3 ${req.status === 'approved' ? 'bg-ok/4 border-ok/15' : 'bg-err/4 border-err/15'}`}>
              <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint">
                {req.status === 'approved' ? 'Resolution' : 'Rejection notes'}
              </p>
              {req.reviewed_by_name && (
                <div className="flex items-center gap-2 text-[12px] text-text-muted">
                  <User size={12} className="text-text-faint" />
                  <span className="font-semibold text-text">{req.reviewed_by_name}</span>
                  <span>· reviewed {fmtDate(req.reviewed_at)}</span>
                </div>
              )}
              {req.resolution_note && (
                <p className="text-[13px] text-text leading-relaxed whitespace-pre-wrap">{req.resolution_note}</p>
              )}
              {req.github_pr_url && (
                <div className="space-y-1.5">
                  <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint">GitHub PR</p>
                  <GithubPRCard url={req.github_pr_url} />
                </div>
              )}
            </div>
          )}

          {/* ── Code Contribution details ── */}
          {isCode && (
            <div className="space-y-3">
              <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint">Code Contribution details</p>

              {req.onedrive_url && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
                  <Link2 size={14} className="text-amber-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-wide text-amber-700 font-bold mb-0.5">OneDrive files</p>
                    <a href={req.onedrive_url} target="_blank" rel="noopener noreferrer"
                      className="text-[12px] text-amber-800 underline break-all hover:text-amber-900 flex items-center gap-1">
                      {req.onedrive_url.length > 60 ? req.onedrive_url.slice(0, 60) + '…' : req.onedrive_url}
                      <ExternalLink size={11} />
                    </a>
                  </div>
                </div>
              )}

              {req.schema_proposal && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="px-4 py-3 rounded-xl bg-surface border border-surface-rule">
                    <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint mb-1 flex items-center gap-1.5">
                      <Database size={10} /> Target schema
                    </p>
                    <p className="font-mono text-[13px] font-bold text-text">{req.schema_proposal.schema_name || '—'}</p>
                  </div>
                  <div className="px-4 py-3 rounded-xl bg-surface border border-surface-rule">
                    <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint mb-1">Tables affected</p>
                    <p className="font-mono text-[12px] text-text">{req.schema_proposal.tables_affected || '—'}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-surface-rule">
                  <User size={12} className="text-text-muted" />
                  <span className="text-[12px] text-text font-semibold">{req.code_author || 'Unknown'}</span>
                  <span className="text-[10px] text-text-faint">wrote the code</span>
                </div>
                {isAiGen ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
                    <Bot size={12} className="text-amber-600" />
                    <span className="text-[12px] text-amber-800 font-semibold">AI-generated</span>
                    {req.ai_tool_used && <span className="text-[10px] text-amber-700">via {req.ai_tool_used}</span>}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-ok/5 border border-ok/20">
                    <User size={12} className="text-ok" />
                    <span className="text-[12px] text-ok font-semibold">Written manually</span>
                  </div>
                )}
              </div>

              {preflightItems.length > 0 && (
                <div className="px-4 py-3 rounded-xl border border-surface-rule">
                  <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint mb-2">Submitter pre-flight declaration</p>
                  <div className="grid grid-cols-2 gap-1">
                    {preflightItems.map(([key, val]) => (
                      <div key={key} className={`flex items-center gap-1.5 text-[10px] ${val ? 'text-ok' : 'text-err'}`}>
                        {val ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                        <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Discussion ── */}
          <div className="pt-3 border-t border-surface-rule">
            <CommentThread entityType="project_request" entityId={req.id} variant="light" />
          </div>

          {/* ── Approval form (inline expansion) ── */}
          {action === 'approve' && !isReviewed && (
            <div className="space-y-4 p-4 rounded-xl bg-ok/4 border border-ok/15">
              <p className="font-mono text-[10px] uppercase tracking-wide text-ok/70 font-semibold">Classify project</p>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1.5">Priority</p>
                  <div className="flex gap-1">
                    {([
                      { v: 'high', cls: 'bg-err/10 text-err border-err/30' },
                      { v: 'mid',  cls: 'bg-warn/10 text-warn border-warn/30' },
                      { v: 'low',  cls: 'bg-ok/10 text-ok border-ok/30' },
                    ] as const).map(({ v, cls }) => (
                      <button key={v} onClick={() => setForm(f => ({ ...f, priority: v }))}
                        className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border transition-all capitalize ${
                          form.priority === v ? cls : 'border-surface-rule text-text-muted hover:bg-surface-card bg-surface'
                        }`}>{v}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1.5">Term</p>
                  <div className="flex gap-1">
                    {(['short', 'long', 'ongoing'] as const).map(v => (
                      <button key={v} onClick={() => setForm(f => ({ ...f, term: v }))}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold border transition-all capitalize ${
                          form.term === v ? 'bg-info/10 text-info border-info/30' : 'border-surface-rule text-text-muted hover:bg-surface-card bg-surface'
                        }`}>{v}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1.5">Effort</p>
                  <div className="flex gap-1">
                    {(['S', 'M', 'L', 'XL'] as const).map(v => (
                      <button key={v} onClick={() => setForm(f => ({ ...f, effort_size: v }))}
                        className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                          form.effort_size === v ? 'bg-brand/10 text-brand border-brand/25' : 'border-surface-rule text-text-muted hover:bg-surface-card bg-surface'
                        }`}>{v}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[['target_start', 'Target start'], ['target_end', 'Target end']].map(([f, l]) => (
                  <div key={f}>
                    <p className="font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1">{l}</p>
                    <input type="date" value={form[f as 'target_start' | 'target_end']}
                      onChange={e => setForm(frm => ({ ...frm, [f]: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl border border-surface-rule bg-surface text-[12px] text-text focus:outline-none focus:border-brand/40 focus:bg-surface-card" />
                  </div>
                ))}
              </div>

              <div>
                <p className="font-mono text-[9px] uppercase tracking-wide text-text-muted mb-2">Project tracks</p>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_TRACKS.map(t => (
                    <button key={t.key} onClick={() => toggleTrack(t.key)}
                      className={`px-3 py-1.5 rounded-xl text-[11px] font-medium border transition-all ${
                        form.tracks.includes(t.key)
                          ? 'bg-brand/8 text-brand border-brand/25'
                          : 'border-surface-rule text-text-muted hover:bg-surface-card bg-surface'
                      }`}>{t.label}</button>
                  ))}
                </div>
              </div>

              {/* IT Audit Checklist — Code Contributions only */}
              {isCode && (
                <div className="p-4 rounded-xl border-2 border-dashed border-purple-200 bg-purple-50/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[10px] uppercase tracking-wide text-purple-700 font-bold flex items-center gap-2">
                      <Shield size={12} /> IT Audit Checklist
                    </p>
                    <span className={`font-mono text-[9px] px-2 py-0.5 rounded-full font-bold ${
                      allAuditDone ? 'bg-ok/15 text-ok border border-ok/20' : 'bg-err/10 text-err border border-err/20'
                    }`}>
                      {IT_AUDIT_ITEMS.filter(i => audit[i.key]).length}/{IT_AUDIT_ITEMS.length} confirmed
                    </span>
                  </div>
                  {!allAuditDone && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
                      <AlertTriangle size={12} className="text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] text-amber-800">
                        All audit items must be confirmed before this Code Contribution can be approved.
                        This is your technical sign-off as the IT authority.
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    {IT_AUDIT_ITEMS.map(item => {
                      const checked = !!audit[item.key]
                      return (
                        <button key={item.key}
                          onClick={() => setAudit(a => ({ ...a, [item.key]: !a[item.key] }))}
                          className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                            checked ? 'border-ok/30 bg-ok/5' : 'border-surface-rule bg-white hover:bg-surface-card'
                          }`}>
                          <div className="flex-shrink-0 mt-0.5">
                            {checked
                              ? <CheckSquare size={14} className="text-ok" />
                              : <Square size={14} className="text-text-faint" />}
                          </div>
                          <p className={`text-[12px] leading-snug ${checked ? 'text-text font-medium' : 'text-text-muted'}`}>
                            {item.label}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Resolution note + GitHub PR */}
              <div className="space-y-3">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1.5">Resolution note <span className="text-text-faint normal-case">(optional — what was done or decided)</span></p>
                  <textarea
                    rows={2}
                    value={form.resolution_note}
                    onChange={e => setForm(f => ({ ...f, resolution_note: e.target.value }))}
                    placeholder="Brief summary of how this will be delivered or what decision was made…"
                    className="w-full px-3 py-2.5 rounded-xl border border-surface-rule bg-surface-card text-[12px] text-text focus:outline-none resize-none focus:border-brand/40"
                  />
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-wide text-text-muted mb-1.5">GitHub PR URL <span className="text-text-faint normal-case">(optional — paste when the PR is raised or merged)</span></p>
                  <input
                    type="url"
                    value={form.github_pr_url}
                    onChange={e => setForm(f => ({ ...f, github_pr_url: e.target.value }))}
                    placeholder="https://github.com/Alyssa-CNTP/CNTP-Platform/pull/…"
                    className="w-full px-3 py-2 rounded-xl border border-surface-rule bg-surface-card text-[12px] text-text focus:outline-none focus:border-brand/40"
                  />
                  {form.github_pr_url && form.github_pr_url.includes('/pull/') && (
                    <div className="mt-2">
                      <GithubPRCard url={form.github_pr_url} />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={handleApprove} disabled={saving || (isCode && !allAuditDone)}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-brand text-white text-[12px] font-semibold hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  {isCode && !allAuditDone ? 'Complete audit checklist first' : 'Confirm approval'}
                </button>
                <button onClick={() => setAction(null)}
                  className="px-4 py-2 rounded-xl border border-surface-rule text-[12px] text-text-muted hover:bg-surface-card">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {action === 'reject' && !isReviewed && (
            <div className="space-y-3 p-4 rounded-xl bg-err/4 border border-err/15">
              <p className="font-mono text-[10px] uppercase tracking-wide text-err/70 font-semibold">Rejection reason</p>
              <textarea rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                placeholder="Reason sent back to the submitter — be specific about what needs to change…"
                className="w-full px-3 py-2.5 rounded-xl border border-surface-rule bg-surface-card text-[13px] text-text focus:outline-none resize-none" />
              <div className="flex gap-3">
                <button onClick={handleReject} disabled={saving}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-err text-white text-[12px] font-semibold hover:bg-err/90 disabled:opacity-50">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />} Confirm rejection
                </button>
                <button onClick={() => setAction(null)}
                  className="px-4 py-2 rounded-xl border border-surface-rule text-[12px] text-text-muted hover:bg-surface-card">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky action bar — only for pending requests */}
      {!isReviewed && !action && (
        <div className="px-6 py-3 border-t border-surface-rule bg-surface-card flex-shrink-0 flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Decision</span>
          <div className="flex-1" />
          <button onClick={() => setAction('reject')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-err/30 bg-err/8 text-err text-[12px] font-semibold hover:bg-err/15 transition-colors">
            <XCircle size={13} /> Reject
          </button>
          <button onClick={() => setAction('approve')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white text-[12px] font-semibold hover:bg-brand-hover transition-colors">
            <CheckCircle2 size={13} /> Approve & classify
          </button>
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Main page
// ═════════════════════════════════════════════════════════════════════════════

export default function ConsiderationBoard() {
  const { isIT, loading: al } = useAuth()
  const router = useRouter()
  const [requests, setRequests] = useState<ProjectRequest[]>([])
  const [loading,  setLoading]  = useState(true)

  // List controls
  const [search,        setSearch]        = useState('')
  const [statusFilter,  setStatusFilter]  = useState<StatusFilter>('pending')
  const [deptFilter,    setDeptFilter]    = useState<string>('all')
  const [typeFilter,    setTypeFilter]    = useState<'all' | 'code' | 'feature'>('all')
  const [sortBy,        setSortBy]        = useState<SortBy>('newest')
  const [selectedId,    setSelectedId]    = useState<string | null>(null)
  const [filtersOpen,   setFiltersOpen]   = useState(false)

  useEffect(() => { if (!al && !isIT) router.replace('/dashboard') }, [isIT, al, router])

  const load = useCallback(async () => {
    const res = await fetch('/api/axis/requests')
    const data = res.ok ? await res.json() : []
    setRequests(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { if (!al && isIT) load() }, [al, isIT, load])

  async function handleApprove(id: string, form: ApprovalForm, auditChecklist?: Record<string, boolean>) {
    const res = await fetch(`/api/axis/requests/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, it_audit_checklist: auditChecklist }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      return
    }
    await load()
  }

  async function handleReject(id: string, reason: string) {
    const res = await fetch(`/api/axis/requests/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      return
    }
    await load()
  }

  // ─── Stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    return {
      pending:  requests.filter(r => r.status === 'pending' || r.status === 'under_review').length,
      approved: requests.filter(r => r.status === 'approved').length,
      rejected: requests.filter(r => r.status === 'rejected').length,
      code:     requests.filter(r => r.submission_type === 'code_contribution' &&
                                     (r.status === 'pending' || r.status === 'under_review')).length,
    }
  }, [requests])

  // ─── Filter + sort ───────────────────────────────────────────────────────
  const filteredSorted = useMemo(() => {
    let arr = requests

    // Status
    if (statusFilter === 'pending')        arr = arr.filter(r => r.status === 'pending' || r.status === 'under_review')
    else if (statusFilter === 'approved')  arr = arr.filter(r => r.status === 'approved')
    else if (statusFilter === 'rejected')  arr = arr.filter(r => r.status === 'rejected')

    // Type
    if (typeFilter === 'code')             arr = arr.filter(r => r.submission_type === 'code_contribution')
    else if (typeFilter === 'feature')     arr = arr.filter(r => r.submission_type !== 'code_contribution')

    // Department
    if (deptFilter !== 'all')              arr = arr.filter(r => r.requesting_dept === deptFilter)

    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      arr = arr.filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.requesting_dept.toLowerCase().includes(q)
      )
    }

    // Sort
    const copy = [...arr]
    if (sortBy === 'newest')         copy.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    else if (sortBy === 'oldest')    copy.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    else if (sortBy === 'urgency')   copy.sort((a, b) => (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0))
    return copy
  }, [requests, statusFilter, typeFilter, deptFilter, search, sortBy])

  // Auto-select first item when list changes and current selection isn't in it
  useEffect(() => {
    if (filteredSorted.length === 0) { setSelectedId(null); return }
    if (!selectedId || !filteredSorted.find(r => r.id === selectedId)) {
      setSelectedId(filteredSorted[0].id)
    }
  }, [filteredSorted, selectedId])

  const departments = useMemo(() => {
    return Array.from(new Set(requests.map(r => r.requesting_dept))).sort()
  }, [requests])

  const selected = selectedId ? filteredSorted.find(r => r.id === selectedId) ?? null : null

  if (al || loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 size={18} className="animate-spin text-text-faint" />
    </div>
  )

  return (
    <div className="h-full flex flex-col">

      {/* ── Header ── */}
      <div className="px-6 py-4 border-b border-surface-rule bg-surface-card flex-shrink-0">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">AXIS · Triage</p>
            <h1 className="font-display font-bold text-[22px] text-text leading-tight mt-0.5">Consideration board</h1>
          </div>
          <div className="flex items-center gap-2">
            <StatChip label="Pending"  value={stats.pending}  color="text-warn" />
            <StatChip label="Approved" value={stats.approved} color="text-ok" />
            <StatChip label="Rejected" value={stats.rejected} color="text-err" />
            {stats.code > 0 && (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 font-mono text-[10px] font-semibold">
                <GitBranch size={10} /> {stats.code} code awaiting audit
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Two-pane layout ── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[380px_1fr] min-h-0">

        {/* ── Left: list ── */}
        <div className="flex flex-col border-r border-surface-rule min-h-0">

          {/* Search + filter toggle */}
          <div className="p-3 border-b border-surface-rule bg-surface-raised flex-shrink-0 space-y-2">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search title, description, dept…"
                className="w-full pl-8 pr-3 py-2 text-[12px] bg-surface-card border border-surface-rule rounded-lg focus:outline-none focus:border-brand/40"
              />
            </div>

            {/* Status tabs */}
            <div className="flex gap-1 p-0.5 bg-surface rounded-lg border border-surface-rule">
              {(['pending', 'approved', 'rejected', 'all'] as const).map(s => {
                const count = s === 'all' ? requests.length : stats[s as 'pending' | 'approved' | 'rejected']
                return (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`flex-1 px-2 py-1 rounded-md text-[11px] font-semibold capitalize transition-colors ${
                      statusFilter === s ? 'bg-surface-card text-text shadow-sm' : 'text-text-muted hover:text-text'
                    }`}>
                    {s} {count > 0 && <span className="opacity-60 ml-0.5">{count}</span>}
                  </button>
                )
              })}
            </div>

            {/* Filter row toggle */}
            <button onClick={() => setFiltersOpen(o => !o)}
              className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text transition-colors">
              <Filter size={11} /> Filters · sort
              <ChevronDown size={11} className={`transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
            </button>

            {filtersOpen && (
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-1.5">
                  <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
                    className="px-2 py-1.5 text-[11px] bg-surface-card border border-surface-rule rounded-lg focus:outline-none focus:border-brand/40">
                    <option value="all">All departments</option>
                    {departments.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)}
                    className="px-2 py-1.5 text-[11px] bg-surface-card border border-surface-rule rounded-lg focus:outline-none focus:border-brand/40">
                    <option value="all">All types</option>
                    <option value="code">Code contributions</option>
                    <option value="feature">Feature requests</option>
                  </select>
                </div>
                <select value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}
                  className="w-full px-2 py-1.5 text-[11px] bg-surface-card border border-surface-rule rounded-lg focus:outline-none focus:border-brand/40">
                  <option value="newest">Sort: newest first</option>
                  <option value="oldest">Sort: oldest first</option>
                  <option value="urgency">Sort: urgency (high → low)</option>
                </select>
              </div>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {filteredSorted.length === 0 ? (
              <div className="p-8 flex flex-col items-center gap-2 text-center">
                <Inbox size={20} className="text-text-faint" />
                <p className="text-[12px] text-text-muted font-semibold">
                  {requests.length === 0 ? 'No requests yet' : 'Nothing matches your filters'}
                </p>
                {search && (
                  <button onClick={() => setSearch('')}
                    className="text-[11px] text-brand hover:underline">
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              filteredSorted.map(r => (
                <ListRow
                  key={r.id}
                  req={r}
                  selected={r.id === selectedId}
                  onClick={() => setSelectedId(r.id)}
                />
              ))
            )}
          </div>

          <div className="px-3 py-2 border-t border-surface-rule bg-surface-raised flex-shrink-0">
            <p className="font-mono text-[10px] text-text-faint text-center">
              showing {filteredSorted.length} of {requests.length}
            </p>
          </div>
        </div>

        {/* ── Right: detail ── */}
        <div className="min-h-0">
          {selected ? (
            <RequestDetail
              key={selected.id}
              req={selected}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-6">
              <Inbox size={28} className="text-text-faint" />
              <p className="font-semibold text-[14px] text-text">
                {requests.length === 0 ? 'Nothing to triage' : 'Select a request'}
              </p>
              <p className="text-[12px] text-text-muted max-w-xs">
                {requests.length === 0
                  ? 'When teams submit project requests, they\'ll appear here for IT review.'
                  : 'Pick a request from the list to see its details, discuss with the submitter, and decide.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-surface-rule bg-surface">
      <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
      <span className={`font-display font-bold text-[14px] leading-none ${color}`}>{value}</span>
    </div>
  )
}
