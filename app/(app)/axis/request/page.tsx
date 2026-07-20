'use client'

// app/(app)/axis/request/page.tsx
// Single entry point for everything users want to submit to AXIS. Four tabs:
//   • Changes to current/new feature — small asks about a specific page, routed to Tickets
//   • Major Project Request          — formal proposal, routed to the IT consideration board
//   • Code Contribution              — code submission for IT audit, routed to the consideration board
//   • Suggestion                     — anonymous idea/problem/question, routed to Tickets

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { NAV } from '@/components/layout/Sidebar'
import {
  CheckCircle2, Loader2, Send, Clock,
  Lightbulb, AlertTriangle, HelpCircle, MessageSquare,
  GitBranch, Link2, Database, Bot, User, CheckSquare, Square,
  Wrench, FolderKanban,
} from 'lucide-react'

// ─── Shared types ─────────────────────────────────────────────────────────────

interface MyRequest {
  id: string; title: string; status: string
  urgency: string; created_at: string
  rejection_reason: string | null
  submission_type?: string | null
  description?: string
}

// ─── Page/module picker — derived from the real Sidebar nav so it never drifts ─

const PAGE_MODULE_GROUPS: { group: string; items: { href: string; label: string }[] }[] = (() => {
  const groups: { group: string; items: { href: string; label: string }[] }[] = []
  for (const item of NAV) {
    if (item.group === 'Admin') continue
    let g = groups.find(g => g.group === item.group)
    if (!g) { g = { group: item.group, items: [] }; groups.push(g) }
    g.items.push({ href: item.href, label: item.label })
  }
  return groups
})()

const OTHER_PAGE_MODULE = '__other__'

// ─── Suggestion categories ────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'improvement', icon: Lightbulb,      label: 'Improvement Idea', desc: 'Something that could work better', activeBg: '#FEF3C7', activeBorder: '#F59E0B', color: '#92400E' },
  { value: 'problem',     icon: AlertTriangle,  label: 'Problem / Issue',  desc: 'Something that is not working',     activeBg: '#FEE2E2', activeBorder: '#EF4444', color: '#991B1B' },
  { value: 'question',    icon: HelpCircle,     label: 'Question',         desc: 'Something you need clarity on',     activeBg: '#DBEAFE', activeBorder: '#3B82F6', color: '#1E40AF' },
  { value: 'general',     icon: MessageSquare,  label: 'General Comment',  desc: 'Anything else on your mind',        activeBg: '#DCFCE7', activeBorder: '#22C55E', color: '#166534' },
] as const

type Category = typeof CATEGORIES[number]['value']

// ─── Status badges (project request style) ────────────────────────────────────

const REQUEST_STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  pending:      { label: 'Pending review', classes: 'bg-warn/10 text-warn border-warn/25' },
  under_review: { label: 'Under review',   classes: 'bg-info/10 text-info border-info/25' },
  approved:     { label: 'Approved',        classes: 'bg-ok/10 text-ok border-ok/25' },
  rejected:     { label: 'Not approved',    classes: 'bg-err/10 text-err border-err/25' },
}

// ─── Urgency picker (project requests) ────────────────────────────────────────

const URGENCY_CONFIG = [
  { value: 'low',      label: 'Low',      active: 'bg-ok/10 text-ok border-ok/30',       inactive: 'bg-surface text-text-muted border-surface-rule' },
  { value: 'medium',   label: 'Medium',   active: 'bg-info/10 text-info border-info/30',  inactive: 'bg-surface text-text-muted border-surface-rule' },
  { value: 'high',     label: 'High',     active: 'bg-warn/10 text-warn border-warn/30',  inactive: 'bg-surface text-text-muted border-surface-rule' },
  { value: 'critical', label: 'Critical', active: 'bg-err/10 text-err border-err/30',     inactive: 'bg-surface text-text-muted border-surface-rule' },
] as const

function fmt(s: string) {
  return new Date(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ═════════════════════════════════════════════════════════════════════════════
// Page wrapper (handles ?tab= query param)
// ═════════════════════════════════════════════════════════════════════════════

export default function AxisRequestPage() {
  return (
    <Suspense fallback={
      <div className="p-6 flex justify-center">
        <Loader2 size={18} className="animate-spin text-text-faint" />
      </div>
    }>
      <RequestPageBody />
    </Suspense>
  )
}

type TabKey = 'feature_change' | 'major_project' | 'code' | 'suggestion'

function RequestPageBody() {
  const { userId, department, loading: al } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const tabParam = searchParams.get('tab')
  const initialTab: TabKey =
    tabParam === 'major_project' ? 'major_project' :
    tabParam === 'code'          ? 'code' :
    tabParam === 'suggestion'    ? 'suggestion' :
                                   'feature_change'
  const [tab, setTab] = useState<TabKey>(initialTab)

  // Keep URL ?tab in sync (so deep-links work both ways)
  useEffect(() => {
    const current = searchParams.get('tab') ?? 'feature_change'
    if (current !== tab) {
      const params = new URLSearchParams(searchParams.toString())
      if (tab === 'feature_change') params.delete('tab')
      else                          params.set('tab', tab)
      const q = params.toString()
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const [myAll,        setMyAll]        = useState<MyRequest[]>([])
  const [loadingMine,  setLoadingMine]  = useState(true)

  async function loadMine() {
    if (!userId) return
    const res = await fetch('/api/axis/requests/mine')
    const data = res.ok ? await res.json() : []
    setMyAll(Array.isArray(data) ? data : [])
    setLoadingMine(false)
  }

  useEffect(() => { if (!al && userId) loadMine() }, [al, userId])

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">AXIS</p>
        <h1 className="font-display font-bold text-[24px] text-text leading-tight mt-0.5">
          Submit a request or suggestion
        </h1>
        <p className="text-[12px] text-text-muted mt-1.5">
          Feature changes and suggestions go to the ticket queue. Major projects and code contributions go to IT for formal review.
        </p>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 p-1 bg-surface rounded-xl border border-surface-rule w-fit flex-wrap">
        {([
          { key: 'feature_change', label: 'Feature Change',    icon: Wrench },
          { key: 'major_project',  label: 'Major Project',     icon: FolderKanban },
          { key: 'code',           label: 'Code Contribution', icon: GitBranch },
          { key: 'suggestion',     label: 'Suggestion',        icon: Lightbulb },
        ] as const).map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                active
                  ? 'bg-surface-card text-text shadow-sm border border-surface-rule'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              <Icon size={12} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* ── Active tab ── */}
      {tab === 'feature_change' && (
        <FeatureChangeTab
          userDept={department}
          requests={myAll.filter(r => r.submission_type === 'feature_change')}
          loadingMine={loadingMine}
          onSubmitted={loadMine}
        />
      )}
      {tab === 'major_project' && (
        <MajorProjectTab
          userDept={department}
          requests={myAll.filter(r => r.submission_type === 'major_project')}
          loadingMine={loadingMine}
          onSubmitted={loadMine}
        />
      )}
      {tab === 'code' && (
        <CodeContributionTab
          userDept={department}
          submissions={myAll.filter(r => r.submission_type === 'code_contribution')}
          loadingMine={loadingMine}
          onSubmitted={loadMine}
        />
      )}
      {tab === 'suggestion' && (
        <SuggestionTab userDept={department} />
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Tab 1 — Changes to current/new feature
// ═════════════════════════════════════════════════════════════════════════════

function FeatureChangeTab({
  userDept, requests, loadingMine, onSubmitted,
}: {
  userDept: string | null
  requests: MyRequest[]
  loadingMine: boolean
  onSubmitted: () => Promise<void>
}) {
  const [summary,       setSummary]       = useState('')
  const [pageModule,    setPageModule]    = useState('')
  const [otherModule,   setOtherModule]   = useState('')
  const [description,   setDescription]   = useState('')
  const [justification, setJustification] = useState('')
  const [urgency,       setUrgency]       = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [submitting,    setSubmitting]    = useState(false)
  const [submitted,     setSubmitted]     = useState(false)
  const [ticketNumber,  setTicketNumber]  = useState<string | null>(null)

  const resolvedModule = pageModule === OTHER_PAGE_MODULE ? otherModule.trim() : pageModule

  async function handleSubmit() {
    if (!summary.trim())       { alert('Summarise what needs to change.'); return }
    if (!resolvedModule)       { alert('Select which page/module this relates to.'); return }
    if (!description.trim())   { alert('Describe the change.'); return }
    if (!justification.trim()) { alert('Explain why this is necessary.'); return }
    setSubmitting(true)
    const res = await fetch('/api/axis/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:                  summary.trim(),
        description:            description.trim(),
        business_justification: justification.trim(),
        urgency,
        submission_type:        'feature_change',
        page_module:            resolvedModule,
      }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      setSubmitting(false)
      return
    }
    const json = await res.json()
    setTicketNumber(json.ticket_number ?? null)
    setSubmitted(true)
    setSummary(''); setPageModule(''); setOtherModule(''); setDescription(''); setJustification(''); setUrgency('medium')
    setSubmitting(false)
    await onSubmitted()
    setTimeout(() => { setSubmitted(false); setTicketNumber(null) }, 8000)
  }

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        <div className="px-6 py-5 border-b border-surface-rule"
          style={{ background: 'linear-gradient(135deg, #f5f5f4 0%, #fafaf9 100%)' }}>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-1.5 rounded-full bg-brand" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              Change to a current or new feature
            </span>
          </div>
          <h2 className="font-display font-bold text-[18px] text-text">Something on a specific page needs to change</h2>
          <p className="text-[12px] text-text-muted mt-1">
            Goes straight to the ticket queue.
            {userDept && <> Your department <span className="font-semibold text-text">({userDept})</span> is attached automatically.</>}
          </p>
        </div>

        <div className="p-6 space-y-5">
          {submitted && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-ok/8 border border-ok/20">
              <CheckCircle2 size={15} className="text-ok flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[13px] font-semibold text-ok">Submitted — a ticket has been raised.</p>
                {ticketNumber && (
                  <p className="text-[11px] text-ok/80 mt-0.5">
                    Ticket <span className="font-mono font-bold">{ticketNumber}</span> created.
                  </p>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              What needs to change? <span className="text-err">*</span>
            </label>
            <input type="text" value={summary} onChange={e => setSummary(e.target.value)}
              placeholder="e.g. Sieving capture — add a spec-override warning"
              className="w-full px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Which page/module? <span className="text-err">*</span>
            </label>
            <select value={pageModule} onChange={e => setPageModule(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors">
              <option value="">Select a page…</option>
              {PAGE_MODULE_GROUPS.map(g => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map(item => (
                    <option key={item.href} value={`${g.group} — ${item.label}`}>{item.label}</option>
                  ))}
                </optgroup>
              ))}
              <option value={OTHER_PAGE_MODULE}>Other / not listed</option>
            </select>
            {pageModule === OTHER_PAGE_MODULE && (
              <input type="text" value={otherModule} onChange={e => setOtherModule(e.target.value)}
                placeholder="Describe which page or area this relates to"
                className="w-full mt-2 px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors"
              />
            )}
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Description of the change <span className="text-err">*</span>
            </label>
            <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
              placeholder="What should change, and how should it behave?"
              className="w-full px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Why is this necessary? <span className="text-err">*</span>
            </label>
            <textarea rows={2} value={justification} onChange={e => setJustification(e.target.value)}
              placeholder="What problem does this solve, or what does it unlock?"
              className="w-full px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Priority
            </label>
            <div className="grid grid-cols-4 gap-2">
              {URGENCY_CONFIG.map(u => (
                <button key={u.value} onClick={() => setUrgency(u.value)}
                  className={`py-2.5 rounded-xl text-[12px] font-semibold border transition-all ${urgency === u.value ? u.active : u.inactive}`}>
                  {u.label}
                </button>
              ))}
            </div>
          </div>

          <button onClick={handleSubmit} disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white text-[13px] font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50">
            {submitting
              ? <><Loader2 size={15} className="animate-spin" /> Submitting…</>
              : <><Send size={14} /> Submit</>}
          </button>
        </div>
      </div>

      <MyRequestsList
        items={requests}
        loading={loadingMine}
        emptyText="Your submitted change requests will appear here"
      />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Tab 2 — Major Project Request
// ═════════════════════════════════════════════════════════════════════════════

function MajorProjectTab({
  userDept, requests, loadingMine, onSubmitted,
}: {
  userDept: string | null
  requests: MyRequest[]
  loadingMine: boolean
  onSubmitted: () => Promise<void>
}) {
  const [title,         setTitle]         = useState('')
  const [description,   setDescription]   = useState('')
  const [justification, setJustification] = useState('')
  const [urgency,       setUrgency]       = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [submitting,    setSubmitting]    = useState(false)
  const [submitted,     setSubmitted]     = useState(false)

  async function handleSubmit() {
    if (!title.trim())         { alert('Enter a project title.'); return }
    if (!description.trim())   { alert('Describe the project.'); return }
    if (!justification.trim()) { alert('Add a business justification.'); return }
    setSubmitting(true)
    const res = await fetch('/api/axis/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:                  title.trim(),
        description:            description.trim(),
        business_justification: justification.trim(),
        urgency,
        submission_type:        'major_project',
      }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      setSubmitting(false)
      return
    }
    setSubmitted(true)
    setTitle(''); setDescription(''); setJustification(''); setUrgency('medium')
    setSubmitting(false)
    await onSubmitted()
    setTimeout(() => setSubmitted(false), 8000)
  }

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        <div className="px-6 py-5 border-b border-surface-rule"
          style={{ background: 'linear-gradient(135deg, #f5f5f4 0%, #fafaf9 100%)' }}>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-1.5 rounded-full bg-brand" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              Major project request
            </span>
          </div>
          <h2 className="font-display font-bold text-[18px] text-text">For something IT will build from scratch</h2>
          <p className="text-[12px] text-text-muted mt-1">
            Goes to the Consideration board for formal IT review.
            {userDept && <> Your department <span className="font-semibold text-text">({userDept})</span> is attached automatically.</>}
          </p>
        </div>

        <div className="p-6 space-y-5">
          {submitted && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-ok/8 border border-ok/20">
              <CheckCircle2 size={15} className="text-ok flex-shrink-0 mt-0.5" />
              <p className="text-[13px] font-semibold text-ok">Submitted — IT has been notified.</p>
            </div>
          )}

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Project title <span className="text-err">*</span>
            </label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. RFID implementation for warehouse"
              className="w-full px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Description <span className="text-err">*</span>
            </label>
            <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
              placeholder="What needs to be built? What problem does it solve?"
              className="w-full px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Business justification <span className="text-err">*</span>
            </label>
            <textarea rows={3} value={justification} onChange={e => setJustification(e.target.value)}
              placeholder="Why is this important? What is the impact if it's not done?"
              className="w-full px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Urgency
            </label>
            <div className="grid grid-cols-4 gap-2">
              {URGENCY_CONFIG.map(u => (
                <button key={u.value} onClick={() => setUrgency(u.value)}
                  className={`py-2.5 rounded-xl text-[12px] font-semibold border transition-all ${urgency === u.value ? u.active : u.inactive}`}>
                  {u.label}
                </button>
              ))}
            </div>
          </div>

          <button onClick={handleSubmit} disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white text-[13px] font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50">
            {submitting
              ? <><Loader2 size={15} className="animate-spin" /> Submitting…</>
              : <><Send size={14} /> Submit to IT</>}
          </button>
        </div>
      </div>

      <MyRequestsList
        items={requests}
        loading={loadingMine}
        emptyText="Your submitted requests will appear here"
      />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Tab 3 — Code Contribution Protocol
//   Submitter declares pre-flight, IT performs an audit checklist on approval.
//   Fields persisted: submission_type='code_contribution', onedrive_url,
//   schema_proposal{schema_name,tables_affected}, code_source, ai_tool_used,
//   code_author, preflight_checklist.
// ═════════════════════════════════════════════════════════════════════════════

const PREFLIGHT_ITEMS = [
  { key: 'code_runs_locally',       label: 'I tested the code locally / in a dev environment and it runs' },
  { key: 'no_credentials_in_code',  label: 'No hardcoded credentials, API keys, or secrets in any file' },
  { key: 'correct_schema',          label: 'All DB writes target the correct department schema (not public)' },
  { key: 'migration_included',      label: 'A migration script is included if new tables / columns are needed' },
  { key: 'rls_drafted',             label: 'RLS policies are drafted for any new tables' },
  { key: 'onedrive_accessible',     label: 'OneDrive folder is shared and accessible to IT' },
  { key: 'docs_included',           label: 'README / notes are in the OneDrive folder explaining what the code does' },
  { key: 'utf8_no_bom',             label: 'All TSX/TS files are UTF-8 without BOM (no PowerShell-corrupted files)' },
] as const

function CodeContributionTab({
  userDept, submissions, loadingMine, onSubmitted,
}: {
  userDept: string | null
  submissions: MyRequest[]
  loadingMine: boolean
  onSubmitted: () => Promise<void>
}) {
  const [title,         setTitle]         = useState('')
  const [description,   setDescription]   = useState('')
  const [justification, setJustification] = useState('')
  const [urgency,       setUrgency]       = useState<'low' | 'medium' | 'high' | 'critical'>('medium')

  const [onedriveUrl,   setOnedriveUrl]   = useState('')
  const [schemaName,    setSchemaName]    = useState('')
  const [tablesAffected,setTablesAffected]= useState('')
  const [codeSource,    setCodeSource]    = useState<'manual' | 'ai_generated'>('manual')
  const [aiTool,        setAiTool]        = useState('')
  const [codeAuthor,    setCodeAuthor]    = useState('')
  const [preflight,     setPreflight]     = useState<Record<string, boolean>>({})

  const [submitting,    setSubmitting]    = useState(false)
  const [submitted,     setSubmitted]     = useState(false)

  const allPreflightDone = PREFLIGHT_ITEMS.every(i => preflight[i.key])

  async function handleSubmit() {
    if (!title.trim())           { alert('Enter a title.'); return }
    if (!description.trim())     { alert('Describe what the code does.'); return }
    if (!justification.trim())   { alert('Add a business justification.'); return }
    if (!onedriveUrl.trim())     { alert('Paste the OneDrive folder URL.'); return }
    if (!codeAuthor.trim())      { alert('Enter the code author.'); return }
    if (codeSource === 'ai_generated' && !aiTool.trim()) {
      alert('Specify which AI tool was used.'); return
    }
    if (!allPreflightDone) {
      alert('Complete every pre-flight item before submitting — these are your declarations to IT.')
      return
    }

    setSubmitting(true)
    const res = await fetch('/api/axis/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:                  title.trim(),
        description:            description.trim(),
        business_justification: justification.trim(),
        urgency,
        submission_type:        'code_contribution',
        onedrive_url:           onedriveUrl.trim(),
        schema_proposal:        { schema_name: schemaName.trim(), tables_affected: tablesAffected.trim() },
        code_source:            codeSource,
        ai_tool_used:           codeSource === 'ai_generated' ? aiTool.trim() : null,
        code_author:            codeAuthor.trim(),
        preflight_checklist:    preflight,
      }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      setSubmitting(false)
      return
    }
    setSubmitted(true)
    setTitle(''); setDescription(''); setJustification(''); setUrgency('medium')
    setOnedriveUrl(''); setSchemaName(''); setTablesAffected('')
    setCodeSource('manual'); setAiTool(''); setCodeAuthor(''); setPreflight({})
    setSubmitting(false)
    await onSubmitted()
    setTimeout(() => setSubmitted(false), 5000)
  }

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden ring-1 ring-amber-200">

        {/* Header strip */}
        <div className="flex items-center gap-2 px-5 py-2.5 bg-amber-50 border-b border-amber-100">
          <GitBranch size={12} className="text-amber-600" />
          <span className="font-mono text-[10px] font-bold text-amber-700 uppercase tracking-wide">
            Code Contribution Protocol
          </span>
        </div>

        <div className="px-6 py-5 border-b border-surface-rule"
          style={{ background: 'linear-gradient(135deg, #fffbeb 0%, #fefdf8 100%)' }}>
          <h2 className="font-display font-bold text-[18px] text-text">Submit code for IT audit</h2>
          <p className="text-[12px] text-text-muted mt-1">
            Use this when you (or an AI agent) have written code that needs to land in the platform.
            Goes to the Consideration board — IT will perform a full audit before merging.
            {userDept && <> Your department <span className="font-semibold text-text">({userDept})</span> is attached automatically.</>}
          </p>
        </div>

        <div className="p-6 space-y-5">

          {submitted && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-ok/8 border border-ok/20">
              <CheckCircle2 size={15} className="text-ok flex-shrink-0" />
              <p className="text-[13px] font-semibold text-ok">Submitted — IT will start the audit.</p>
            </div>
          )}

          {/* Title + description + justification + urgency */}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Title <span className="text-err">*</span>
            </label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Add bag-tag rotation export endpoint"
              className="w-full px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              What does the code do? <span className="text-err">*</span>
            </label>
            <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
              placeholder="One paragraph: what the code does, which files it adds or changes, which endpoints it touches."
              className="w-full px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Business justification <span className="text-err">*</span>
            </label>
            <textarea rows={2} value={justification} onChange={e => setJustification(e.target.value)}
              placeholder="Why is this worth merging? What does it unlock?"
              className="w-full px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Urgency
            </label>
            <div className="grid grid-cols-4 gap-2">
              {URGENCY_CONFIG.map(u => (
                <button key={u.value} onClick={() => setUrgency(u.value)}
                  className={`py-2.5 rounded-xl text-[12px] font-semibold border transition-all ${urgency === u.value ? u.active : u.inactive}`}>
                  {u.label}
                </button>
              ))}
            </div>
          </div>

          {/* OneDrive link */}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              OneDrive folder URL <span className="text-err">*</span>
            </label>
            <div className="relative">
              <Link2 size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-600" />
              <input type="url" value={onedriveUrl} onChange={e => setOnedriveUrl(e.target.value)}
                placeholder="https://capenaturaltea-my.sharepoint.com/…"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50/30 text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-amber-400 focus:bg-amber-50/50 transition-colors"
              />
            </div>
            <p className="text-[10px] text-text-faint mt-1.5">
              Share the folder with IT before submitting. IT downloads files from here for the audit.
            </p>
          </div>

          {/* Schema proposal */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
                <Database size={10} className="inline -mt-px mr-1" />
                Target schema
              </label>
              <input type="text" value={schemaName} onChange={e => setSchemaName(e.target.value)}
                placeholder="e.g. quality, sales, axis"
                className="w-full px-3 py-2.5 rounded-xl border border-surface-rule bg-surface text-[12px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
                Tables affected
              </label>
              <input type="text" value={tablesAffected} onChange={e => setTablesAffected(e.target.value)}
                placeholder="e.g. samples, batch_results"
                className="w-full px-3 py-2.5 rounded-xl border border-surface-rule bg-surface text-[12px] font-mono text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors"
              />
            </div>
          </div>

          {/* Authorship */}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Who wrote the code? <span className="text-err">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button onClick={() => setCodeSource('manual')}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all ${
                  codeSource === 'manual'
                    ? 'border-ok/30 bg-ok/5'
                    : 'border-surface-rule bg-surface hover:bg-surface-card'
                }`}>
                <User size={13} className={codeSource === 'manual' ? 'text-ok' : 'text-text-muted'} />
                <div>
                  <p className={`text-[12px] font-semibold ${codeSource === 'manual' ? 'text-ok' : 'text-text-muted'}`}>
                    Written manually
                  </p>
                  <p className="text-[10px] text-text-faint">A human wrote every line</p>
                </div>
              </button>
              <button onClick={() => setCodeSource('ai_generated')}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all ${
                  codeSource === 'ai_generated'
                    ? 'border-amber-300 bg-amber-50'
                    : 'border-surface-rule bg-surface hover:bg-surface-card'
                }`}>
                <Bot size={13} className={codeSource === 'ai_generated' ? 'text-amber-600' : 'text-text-muted'} />
                <div>
                  <p className={`text-[12px] font-semibold ${codeSource === 'ai_generated' ? 'text-amber-800' : 'text-text-muted'}`}>
                    AI-generated
                  </p>
                  <p className="text-[10px] text-text-faint">An AI tool wrote some or all of it</p>
                </div>
              </button>
            </div>

            {codeSource === 'ai_generated' && (
              <input type="text" value={aiTool} onChange={e => setAiTool(e.target.value)}
                placeholder="Which AI tool? e.g. Claude Code, Cursor, ChatGPT"
                className="w-full px-3 py-2.5 rounded-xl border border-amber-200 bg-amber-50/30 text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-amber-400 transition-colors"
              />
            )}
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Code author <span className="text-err">*</span>
            </label>
            <input type="text" value={codeAuthor} onChange={e => setCodeAuthor(e.target.value)}
              placeholder="Your name (the human accountable for this submission)"
              className="w-full px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors"
            />
          </div>

          {/* Pre-flight checklist */}
          <div className="p-4 rounded-xl border-2 border-dashed border-purple-200 bg-purple-50/30 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-wide text-purple-700 font-bold">
                Pre-flight declaration <span className="text-err">*</span>
              </p>
              <span className={`font-mono text-[9px] px-2 py-0.5 rounded-full font-bold ${
                allPreflightDone
                  ? 'bg-ok/15 text-ok border border-ok/20'
                  : 'bg-err/10 text-err border border-err/20'
              }`}>
                {PREFLIGHT_ITEMS.filter(i => preflight[i.key]).length}/{PREFLIGHT_ITEMS.length} confirmed
              </span>
            </div>
            <p className="text-[11px] text-text-muted">
              Every item below is your declaration to IT. If any is untrue, IT will reject the submission.
            </p>
            <div className="space-y-2">
              {PREFLIGHT_ITEMS.map(item => {
                const checked = !!preflight[item.key]
                return (
                  <button key={item.key}
                    onClick={() => setPreflight(p => ({ ...p, [item.key]: !p[item.key] }))}
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

          <button onClick={handleSubmit} disabled={submitting || !allPreflightDone}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white text-[13px] font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting
              ? <><Loader2 size={15} className="animate-spin" /> Submitting…</>
              : !allPreflightDone
                ? <>Complete the pre-flight first</>
                : <><GitBranch size={14} /> Submit for IT audit</>
            }
          </button>
        </div>
      </div>

      <MyRequestsList
        items={submissions}
        loading={loadingMine}
        emptyText="Your code submissions will appear here"
      />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Tab 4 — Suggestion (anonymous)
// ═════════════════════════════════════════════════════════════════════════════

function SuggestionTab({ userDept }: { userDept: string | null }) {
  const [category,     setCategory]     = useState<Category>('improvement')
  const [subject,      setSubject]      = useState('')
  const [description,  setDescription]  = useState('')
  const [submitting,   setSubmitting]   = useState(false)
  const [submitted,    setSubmitted]    = useState(false)

  const selectedCat = CATEGORIES.find(c => c.value === category)!

  async function handleSubmit() {
    if (!subject.trim())     { alert('Please add a subject.'); return }
    if (!description.trim()) { alert('Please describe your suggestion.'); return }
    setSubmitting(true)

    const res = await fetch('/api/axis/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:            subject.trim(),
        description:      description.trim(),
        submission_type:  'suggestion',
        category,
      }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      setSubmitting(false)
      return
    }
    setSubmitted(true)
    setSubject(''); setDescription(''); setCategory('improvement')
    setSubmitting(false)
    setTimeout(() => setSubmitted(false), 6000)
  }

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">

        {submitted && (
          <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-rule bg-ok/5">
            <CheckCircle2 size={16} className="text-ok flex-shrink-0" />
            <div>
              <p className="font-semibold text-[13px] text-ok">Thanks — we&apos;ve received your suggestion.</p>
              <p className="text-[11px] text-text-muted mt-0.5">It&apos;s been raised as a ticket, anonymously.</p>
            </div>
          </div>
        )}

        <div className="px-6 py-5 border-b border-surface-rule"
          style={{ background: 'linear-gradient(135deg, #fffbf0 0%, #fefdf8 100%)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Lightbulb size={11} className="text-amber-600" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-700">Anonymous · share your thoughts</span>
          </div>
          <h2 className="font-display font-bold text-[18px] text-text">Got an idea, problem, or question?</h2>
          <p className="text-[12px] text-text-muted mt-1">
            Your name is never attached — not even IT can see who submitted this.
            {userDept && <> Your department <span className="font-semibold text-text">({userDept})</span> is attached for context only.</>}
          </p>
        </div>

        <div className="p-6 space-y-5">

          {/* Category picker */}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2.5">
              What kind of submission is this?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map(cat => {
                const Icon = cat.icon
                const isSelected = category === cat.value
                return (
                  <button
                    key={cat.value}
                    onClick={() => setCategory(cat.value)}
                    className="flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all"
                    style={{
                      borderColor: isSelected ? cat.activeBorder : '#E5E7EB',
                      background:  isSelected ? cat.activeBg    : '#FAFAFA',
                    }}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: isSelected ? '#FFFFFF' : '#F3F4F6' }}>
                      <Icon size={15} style={{ color: isSelected ? cat.color : '#9CA3AF' }} />
                    </div>
                    <div>
                      <p className="font-semibold text-[12px]"
                        style={{ color: isSelected ? cat.color : '#374151' }}>
                        {cat.label}
                      </p>
                      <p className="text-[10px] text-text-faint mt-0.5">{cat.desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Subject <span className="text-err">*</span>
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder={
                category === 'improvement' ? 'e.g. The bagging scale in Section B could be improved' :
                category === 'problem'     ? 'e.g. The printer in the packing area keeps jamming' :
                category === 'question'    ? 'e.g. Who do I contact when my shift changes?' :
                                             'e.g. General feedback about the morning briefing'
              }
              className="w-full px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted mb-2">
              Tell us more <span className="text-err">*</span>
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={
                category === 'improvement' ? 'Describe your idea. How would it help? What would it look like?' :
                category === 'problem'     ? 'What is happening? When did it start? How often does it occur?' :
                category === 'question'    ? 'What would you like to know? Add as much detail as you can.' :
                                             'Share whatever is on your mind.'
              }
              className="w-full px-4 py-2.5 rounded-xl border border-surface-rule bg-surface text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-brand/40 focus:bg-surface-card transition-colors resize-none"
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || !subject.trim() || !description.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white text-[13px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: selectedCat.color }}
          >
            {submitting
              ? <><Loader2 size={15} className="animate-spin" /> Submitting…</>
              : <><selectedCat.icon size={14} /> Submit anonymously</>}
          </button>

          <p className="text-[11px] text-text-faint text-center">
            Anonymous submissions aren&apos;t tracked in a &quot;my submissions&quot; list, since nothing links them back to you.
          </p>
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Shared "My submissions" list (project / feature-change / code variants)
// ═════════════════════════════════════════════════════════════════════════════

function MyRequestsList({
  items, loading, emptyText,
}: {
  items: MyRequest[]
  loading: boolean
  emptyText: string
}) {
  if (loading) {
    return (
      <div className="card p-8 flex justify-center">
        <Loader2 size={16} className="animate-spin text-text-faint" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="card p-10 flex flex-col items-center gap-2 text-center">
        <Clock size={22} className="text-text-faint" />
        <p className="text-[13px] font-medium text-text-muted">Nothing here yet</p>
        <p className="text-[12px] text-text-faint">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold text-[15px] text-text">My submissions</h3>
        <span className="font-mono text-[10px] text-text-faint">{items.length} total</span>
      </div>

      {items.map(r => {
        const s = REQUEST_STATUS_CONFIG[r.status] ?? REQUEST_STATUS_CONFIG.pending
        return (
          <div key={r.id} className="card px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-[13px] text-text">{r.title}</p>
                <p className="text-[11px] text-text-faint mt-0.5">{fmt(r.created_at)}</p>
                {r.rejection_reason && (
                  <p className="text-[11px] text-err mt-2 leading-relaxed">
                    <span className="font-semibold">Reason: </span>{r.rejection_reason}
                  </p>
                )}
              </div>
              <span className={`font-mono text-[10px] px-2 py-0.5 rounded border flex-shrink-0 ${s.classes}`}>
                {s.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
