'use client'

// app/(app)/axis/projects/[id]/page.tsx

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { CommentThread }    from '@/components/axis/CommentThread'
import SharePointFiles      from '@/components/axis/SharePointFiles'
import {
  Loader2, Plus, Lock, Clock, ChevronDown, ChevronUp,
  Pencil, Save, GitCommit, FileText,
  CheckCircle2, X, AlertTriangle, ArrowLeft,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string; name: string; description: string
  priority: string; term: string; effort_size: string
  status: string; target_start: string | null
  target_end: string | null; hard_deadline: boolean
  approved_at: string
}

interface TrackEvent {
  id: string; title: string; description: string
  event_type: string; created_at: string
  is_locked: boolean; edit_deadline: string
}

interface Track {
  id: string; track_type: string; custom_label: string | null
  progress_pct: number; current_milestone: string
  updated_at: string; events: TrackEvent[]
}

interface ChangeLog {
  id: string; sector: string; change_type: string
  description: string; risk_level: string
  created_at: string; is_locked: boolean
  review_status: string; source: string
}

// ─── Config ───────────────────────────────────────────────────────────────────

const TRACK_META: Record<string, { label: string; color: string }> = {
  process:        { label: 'Process / Operations', color: '#f59e0b' },
  technology:     { label: 'Technology / App',     color: '#3b82f6' },
  compliance:     { label: 'Compliance / ISO',      color: '#8b5cf6' },
  documentation:  { label: 'Documentation',         color: '#6b7280' },
  training:       { label: 'Training',              color: '#22c55e' },
  infrastructure: { label: 'Infrastructure',        color: '#f97316' },
}

const EVENT_META: Record<string, { icon: React.ElementType; color: string }> = {
  milestone:  { icon: CheckCircle2,  color: '#22c55e' },
  update:     { icon: GitCommit,     color: '#3b82f6' },
  blocker:    { icon: AlertTriangle, color: '#ef4444' },
  resolution: { icon: CheckCircle2,  color: '#22c55e' },
  note:       { icon: FileText,      color: '#6b7280' },
}

const SECTOR_COLOR: Record<string, string> = {
  'applications-code': '#1D4ED8',
  'ai-ml':             '#7E22CE',
  'software-saas':     '#0D9488',
  'infrastructure-hardware': '#C2410C',
  'security-governance':     '#B91C1C',
  'operations-continuity':   '#15803D',
  'projects-portfolios':     '#78716C',
  code: '#3b82f6', system: '#f97316', documentation: '#8b5cf6',
}

const PRIORITY_COLOR: Record<string, string> = {
  high: '#ef4444', mid: '#f97316', low: '#22c55e',
}

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-err/10 text-err border-err/20',
  mid:  'bg-warn/10 text-warn border-warn/20',
  low:  'bg-ok/10 text-ok border-ok/20',
}

const RISK_COLOR: Record<string, string> = {
  low: '#22c55e', medium: '#3b82f6', high: '#f97316', critical: '#ef4444',
}

const RISK_BADGE: Record<string, string> = {
  low:      'bg-ok/10 text-ok border-ok/20',
  medium:   'bg-info/10 text-info border-info/20',
  high:     'bg-warn/10 text-warn border-warn/20',
  critical: 'bg-err/10 text-err border-err/20',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

function minsLeft(d: string) {
  return Math.max(0, Math.floor((new Date(d).getTime() - Date.now()) / 60000))
}

// ─── Track panel ─────────────────────────────────────────────────────────────

function TrackPanel({ track, onAddEvent, onUpdateProgress }: {
  track: Track
  onAddEvent: (trackId: string, data: { title: string; description: string; event_type: string }) => Promise<void>
  onUpdateProgress: (trackId: string, pct: number, milestone: string) => Promise<void>
}) {
  const [expanded,        setExpanded]        = useState(false)
  const [addingEvent,     setAddingEvent]     = useState(false)
  const [editingProgress, setEditingProgress] = useState(false)
  const [newTitle,        setNewTitle]        = useState('')
  const [newDesc,         setNewDesc]         = useState('')
  const [newType,         setNewType]         = useState('update')
  const [newPct,          setNewPct]          = useState(track.progress_pct)
  const [newMilestone,    setNewMilestone]    = useState(track.current_milestone)
  const [saving,          setSaving]          = useState(false)

  const meta  = TRACK_META[track.track_type] ?? { label: track.track_type, color: '#6b7280' }
  const label = track.custom_label ?? meta.label
  const color = meta.color

  async function submitEvent() {
    if (!newTitle.trim()) { alert('Enter a title.'); return }
    setSaving(true)
    await onAddEvent(track.id, { title: newTitle.trim(), description: newDesc.trim(), event_type: newType })
    setNewTitle(''); setNewDesc(''); setNewType('update')
    setAddingEvent(false); setSaving(false)
  }

  async function submitProgress() {
    setSaving(true)
    await onUpdateProgress(track.id, newPct, newMilestone)
    setEditingProgress(false); setSaving(false)
  }

  return (
    <div className="rounded-xl overflow-hidden border border-surface-rule bg-surface-card transition-all">

      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-surface-raised transition-colors"
        onClick={() => setExpanded(e => !e)}>
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ background: color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-medium text-text">{label}</p>
            <span className="font-mono text-[11px] font-semibold" style={{ color }}>{track.progress_pct}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-surface">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${track.progress_pct}%`, background: color }} />
          </div>
          <p className="text-[11px] mt-1.5 text-text-faint">{track.current_milestone}</p>
        </div>
        <div className="text-text-faint">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-surface-rule px-5 pb-5 pt-4 space-y-4 bg-surface-raised/30">

          {/* Update progress inline */}
          {!editingProgress ? (
            <button onClick={() => setEditingProgress(true)}
              className="flex items-center gap-1.5 text-[11px] text-text-faint hover:text-text-muted transition-colors">
              <Pencil size={11} /> Update progress
            </button>
          ) : (
            <div className="space-y-3 p-4 rounded-xl bg-surface border border-surface-rule">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] w-8 text-right flex-shrink-0 font-semibold" style={{ color }}>
                  {newPct}%
                </span>
                <input type="range" min={0} max={100} step={5} value={newPct}
                  onChange={e => setNewPct(Number(e.target.value))}
                  className="flex-1" style={{ accentColor: color }} />
              </div>
              <input type="text" placeholder="Current milestone…" value={newMilestone}
                onChange={e => setNewMilestone(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-[12px] bg-surface-card border border-surface-rule text-text placeholder:text-text-faint focus:outline-none focus:border-text-faint" />
              <div className="flex gap-2">
                <button onClick={submitProgress} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40 transition-all text-white"
                  style={{ background: color }}>
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
                </button>
                <button onClick={() => setEditingProgress(false)}
                  className="px-3 py-1.5 rounded-lg text-[11px] text-text-muted hover:text-text border border-surface-rule bg-surface-card transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Events timeline */}
          {track.events.length > 0 && (
            <div className="space-y-0">
              {track.events.map((ev, i) => {
                const em = EVENT_META[ev.event_type] ?? EVENT_META.update
                const Icon = em.icon
                return (
                  <div key={ev.id} className="flex gap-3">
                    <div className="flex flex-col items-center flex-shrink-0" style={{ width: 20 }}>
                      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-1"
                        style={{ background: `${em.color}15`, border: `1px solid ${em.color}30` }}>
                        <Icon size={10} style={{ color: em.color }} />
                      </div>
                      {i < track.events.length - 1 && (
                        <div className="w-px flex-1 mt-1 bg-surface-rule" />
                      )}
                    </div>
                    <div className="flex-1 pb-4 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[12px] font-medium text-text">{ev.title}</p>
                        {ev.is_locked
                          ? <Lock size={10} className="text-text-faint" />
                          : <span className="font-mono text-[9px] text-warn">
                              {minsLeft(ev.edit_deadline)}m left
                            </span>
                        }
                      </div>
                      {ev.description && (
                        <p className="text-[11px] mt-0.5 leading-relaxed text-text-muted">
                          {ev.description}
                        </p>
                      )}
                      <p className="font-mono text-[9px] mt-1 text-text-faint">
                        {fmt(ev.created_at)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Add event */}
          {!addingEvent ? (
            <button onClick={() => setAddingEvent(true)}
              className="flex items-center gap-1.5 text-[11px] text-text-faint hover:text-text-muted transition-colors">
              <Plus size={12} /> Log event
            </button>
          ) : (
            <div className="space-y-3 p-4 rounded-xl bg-surface border border-surface-rule">
              <div className="flex gap-1.5 flex-wrap">
                {(['update', 'milestone', 'blocker', 'resolution', 'note'] as const).map(t => {
                  const c = EVENT_META[t].color
                  return (
                    <button key={t} onClick={() => setNewType(t)}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all capitalize border"
                      style={{
                        background: newType === t ? `${c}15` : 'transparent',
                        borderColor: newType === t ? `${c}40` : '#E7E5E4',
                        color: newType === t ? c : '#A8A29E',
                      }}>
                      {t}
                    </button>
                  )
                })}
              </div>
              <input type="text" placeholder="Event title…" value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-[12px] bg-surface-card border border-surface-rule text-text placeholder:text-text-faint focus:outline-none" />
              <textarea rows={2} placeholder="Details (optional)…" value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-[12px] bg-surface-card border border-surface-rule text-text placeholder:text-text-faint focus:outline-none resize-none" />
              <div className="flex gap-2">
                <button onClick={submitEvent} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40 bg-brand text-white hover:bg-brand-hover transition-colors">
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Log
                </button>
                <button onClick={() => setAddingEvent(false)}
                  className="px-3 py-1.5 rounded-lg text-[11px] text-text-muted border border-surface-rule hover:bg-surface-raised transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { isIT, loading: al } = useAuth()
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [project, setProject] = useState<Project | null>(null)
  const [tracks,  setTracks]  = useState<Track[]>([])
  const [changes, setChanges] = useState<ChangeLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (!al && !isIT) router.replace('/dashboard') }, [isIT, al, router])

  const load = useCallback(async () => {
    if (!id) return
    const res = await fetch(`/api/axis/projects/${id}`)
    if (!res.ok) {
      setProject(null); setTracks([]); setChanges([]); setLoading(false); return
    }
    const data = await res.json()
    setProject(data.project ?? null)
    setTracks(data.tracks ?? [])
    setChanges(data.changes ?? [])
    setLoading(false)
  }, [id])

  useEffect(() => { if (!al && isIT) load() }, [al, isIT, load])

  async function handleAddEvent(trackId: string, data: { title: string; description: string; event_type: string }) {
    const res = await fetch(`/api/axis/projects/${id}/tracks/${trackId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      return
    }
    await load()
  }

  async function handleUpdateProgress(trackId: string, pct: number, milestone: string) {
    const res = await fetch(`/api/axis/projects/${id}/tracks/${trackId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress_pct: pct, current_milestone: milestone }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      return
    }
    await load()
  }

  if (al || loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 size={18} className="animate-spin text-text-faint" />
    </div>
  )

  if (!project) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <p className="text-[13px] text-text-muted">Project not found.</p>
    </div>
  )

  const pc = PRIORITY_COLOR[project.priority] ?? '#78716C'
  const overallProgress = tracks.length > 0
    ? Math.round(tracks.reduce((s, t) => s + t.progress_pct, 0) / tracks.length)
    : 0

  return (
    <div className="min-h-full">

      {/* ── Project hero ── */}
      <div className="border-b border-surface-rule bg-surface-card">
        <div className="px-6 md:px-8 py-7 max-w-[1400px] mx-auto">

          {/* Back */}
          <button onClick={() => router.push('/axis')}
            className="flex items-center gap-1.5 mb-5 text-[11px] text-text-faint hover:text-text-muted transition-colors">
            <ArrowLeft size={13} /> Back to AXIS
          </button>

          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="flex-1 min-w-0">
              {/* Badges */}
              <div className="flex items-center gap-2 flex-wrap mb-3">
                {(project as any).project_code && (
                  <span className="font-mono text-[11px] px-2.5 py-0.5 rounded font-bold bg-surface border border-surface-rule text-text-muted">
                    {(project as any).project_code}
                  </span>
                )}
                <span className={`font-mono text-[10px] px-2.5 py-0.5 rounded border uppercase tracking-wide ${PRIORITY_BADGE[project.priority] ?? 'bg-surface text-text-muted border-surface-rule'}`}>
                  {project.priority} priority
                </span>
                <span className="font-mono text-[10px] px-2.5 py-0.5 rounded border bg-surface border-surface-rule text-text-muted">
                  {project.effort_size}
                </span>
                <span className="font-mono text-[10px] px-2.5 py-0.5 rounded border bg-surface border-surface-rule text-text-muted capitalize">
                  {project.term}-term
                </span>
                {project.hard_deadline && (
                  <span className="font-mono text-[10px] px-2.5 py-0.5 rounded border bg-err/10 text-err border-err/20">
                    hard deadline
                  </span>
                )}
              </div>

              <h1 className="font-display font-bold text-[26px] text-text leading-tight">
                {project.name}
              </h1>
              {project.description && (
                <p className="text-[13px] mt-2 leading-relaxed text-text-muted max-w-2xl">
                  {project.description}
                </p>
              )}

              {/* Dates */}
              <div className="flex items-center gap-6 mt-4 flex-wrap">
                {[
                  { label: 'Start',      value: fmt(project.target_start) },
                  { label: 'Target end', value: fmt(project.target_end)   },
                  { label: 'Approved',   value: fmt(project.approved_at)  },
                ].map(d => (
                  <div key={d.label}>
                    <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint mb-0.5">{d.label}</p>
                    <p className="text-[12px] font-medium text-text-muted">{d.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Overall progress ring */}
            <div className="flex-shrink-0 flex flex-col items-center gap-2">
              <div className="relative w-20 h-20">
                <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                  <circle cx="40" cy="40" r="32" fill="none"
                    stroke="#E7E5E4" strokeWidth="6" />
                  <circle cx="40" cy="40" r="32" fill="none"
                    stroke={pc} strokeWidth="6"
                    strokeDasharray={`${2 * Math.PI * 32}`}
                    strokeDashoffset={`${2 * Math.PI * 32 * (1 - overallProgress / 100)}`}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 0.7s ease' }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-display font-bold text-[18px] text-text">{overallProgress}%</span>
                </div>
              </div>
              <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint">Overall</p>
            </div>
          </div>

          {/* Full-width progress bar */}
          <div className="mt-5 h-1.5 rounded-full overflow-hidden bg-surface">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${overallProgress}%`, background: pc }} />
          </div>

          {/* Download brief */}
          <div className="mt-4">
            <a href={`/api/axis/projects/${id}/brief`} download
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold bg-surface border border-surface-rule text-text-muted hover:text-text hover:bg-surface-raised transition-colors">
              <FileText size={13} />
              Download Project Brief (.docx)
            </a>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-6 md:px-8 py-6 max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Tracks */}
        <div className="space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-faint mb-4">
            Project tracks · {tracks.length}
          </p>
          {tracks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 rounded-xl border border-dashed border-surface-rule">
              <p className="text-[12px] text-text-faint">No tracks configured</p>
            </div>
          ) : (
            tracks.map(t => (
              <TrackPanel
                key={t.id} track={t}
                onAddEvent={handleAddEvent}
                onUpdateProgress={handleUpdateProgress}
              />
            ))
          )}
        </div>

        {/* Change logs */}
        <div className="space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-faint mb-4">
            Linked changes · {changes.length}
          </p>

          {changes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 rounded-xl border border-dashed border-surface-rule">
              <GitCommit size={20} className="text-text-faint" />
              <p className="text-[12px] text-text-faint">No changes linked yet</p>
              <p className="text-[11px] text-center px-6 text-text-faint">
                Log a change from the change log page and link it to this project
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {changes.map(c => {
                const sc = SECTOR_COLOR[c.sector] ?? '#78716C'
                return (
                  <div key={c.id} className="px-4 py-3 rounded-xl bg-surface-card border border-surface-rule">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: sc }} />
                      <span className="font-mono text-[10px] uppercase font-medium" style={{ color: sc }}>
                        {c.sector}
                      </span>
                      <span className="font-mono text-[10px] text-text-faint">·</span>
                      <span className="font-mono text-[10px] text-text-muted">{c.change_type}</span>
                      {c.review_status === 'pending' && (
                        <span className="font-mono text-[9px] px-1.5 py-px rounded border bg-warn/10 text-warn border-warn/20 ml-1">
                          needs review
                        </span>
                      )}
                      {c.source !== 'manual' && (
                        <span className="font-mono text-[9px] px-1.5 py-px rounded border bg-info/10 text-info border-info/20">
                          {c.source}
                        </span>
                      )}
                      <div className="ml-auto flex-shrink-0">
                        {c.is_locked
                          ? <Lock size={10} className="text-text-faint" />
                          : <Clock size={10} className="text-warn" />
                        }
                      </div>
                    </div>
                    <p className="text-[12px] line-clamp-2 text-text-muted">{c.description}</p>
                    <div className="flex items-center justify-between mt-2">
                      <p className="font-mono text-[9px] text-text-faint">{fmt(c.created_at)}</p>
                      <span className={`font-mono text-[9px] px-1.5 py-px rounded border ${RISK_BADGE[c.risk_level] ?? 'bg-surface text-text-muted border-surface-rule'}`}>
                        {c.risk_level}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── SharePoint Files ── */}
      <div className="px-6 md:px-8 pb-6 max-w-[1400px] mx-auto">
        <div className="rounded-xl bg-surface-card border border-surface-rule p-5">
          <SharePointFiles
            projectCode={(project as any).project_code ?? `PRJ-${project.id.slice(0,3).toUpperCase()}`}
            projectName={project.name}
          />
        </div>
      </div>

      {/* ── Comments ── */}
      <div className="px-6 md:px-8 pb-10 max-w-[1400px] mx-auto">
        <div className="rounded-xl bg-surface-card border border-surface-rule p-5">
          <CommentThread entityType="project" entityId={project.id} />
        </div>
      </div>
    </div>
  )
}
