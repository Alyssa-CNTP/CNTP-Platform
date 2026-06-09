'use client'

// app/(app)/workspace/page.tsx — Alyssa's personal command board

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import {
  Plus, X, Check, Loader2, Circle, Clock, AlertCircle, CheckCircle2,
  StickyNote, Eye, EyeOff, ChevronDown, ChevronUp, Flame, Zap,
  Coffee, Ticket, AlignLeft, BookOpen, ArrowRight, MoreHorizontal,
  Grip, User, Calendar, Tag,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceItem {
  id: string
  zone: 'runway' | 'focus' | 'blocker' | 'followup'
  title: string
  project_label: string | null
  contact_name: string | null
  notes: string | null
  priority: string
  completed: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

interface PulseNote {
  id: string
  project_label: string
  content: string
  updated_at: string
}

interface TicketRow {
  id: string
  ticket_number: string
  title: string
  category: string
  ticket_type: string
  status: string
  priority: string
  assigned_name: string | null
  due_date: string | null
  auto_routed: boolean
  created_at: string
}

// ─── Color tokens ─────────────────────────────────────────────────────────────

const PINK   = { bg: '#FDF2F8', border: '#F9A8D4', accent: '#EC4899', light: '#FCE7F3' }
const ORANGE = { bg: '#FFF7ED', border: '#FDBA74', accent: '#F97316', light: '#FFEDD5' }
const PURPLE = { bg: '#FAF5FF', border: '#D8B4FE', accent: '#A855F7', light: '#F3E8FF' }

const PRIORITY_DOT: Record<string, string> = {
  critical: '#EC4899',
  high:     '#F97316',
  medium:   '#A855F7',
  low:      '#94A3B8',
}

const STATUS_STYLE: Record<string, string> = {
  open:        'bg-sky-50 text-sky-700 border-sky-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  blocked:     'bg-red-50 text-red-700 border-red-200',
  resolved:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed:      'bg-stone-100 text-stone-400 border-stone-200',
}

const CATEGORY_LABEL: Record<string, string> = {
  app: 'Apps', database: 'DB', infrastructure: 'Infra',
  security: 'Sec', ai_ml: 'AI/ML', general: 'General',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(s: string) {
  const diff = Date.now() - new Date(s).getTime()
  const d = Math.floor(diff / 86400000)
  const h = Math.floor(diff / 3600000)
  const m = Math.floor(diff / 60000)
  if (d > 0) return `${d}d`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function ageColor(createdAt: string): string {
  const days = (Date.now() - new Date(createdAt).getTime()) / 86400000
  if (days < 2)  return '#10B981'
  if (days < 5)  return '#F97316'
  return '#EF4444'
}

function greeting(name: string) {
  const h = new Date().getHours()
  if (h < 12) return `Good morning, ${name} ☀️`
  if (h < 17) return `Good afternoon, ${name}`
  return `Good evening, ${name} 🌙`
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

// ─── Inline add form ──────────────────────────────────────────────────────────

function InlineAdd({ placeholder, onAdd, color }: {
  placeholder: string
  onAdd: (title: string, extra?: Partial<WorkspaceItem>) => Promise<void>
  color: typeof PINK
}) {
  const [open,  setOpen]  = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) ref.current?.focus() }, [open])

  async function submit() {
    if (!title.trim()) return
    setSaving(true)
    await onAdd(title.trim())
    setTitle(''); setSaving(false); setOpen(false)
  }

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[12px] font-medium transition-colors group"
      style={{ color: color.accent, background: 'transparent' }}
      onMouseEnter={e => (e.currentTarget.style.background = color.light)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <Plus size={12} /> {placeholder}
    </button>
  )

  return (
    <div className="flex items-center gap-2 mt-1">
      <input
        ref={ref}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false) }}
        placeholder={placeholder}
        className="flex-1 px-3 py-2 rounded-lg border text-[12px] focus:outline-none"
        style={{ borderColor: color.border }}
      />
      <button onClick={submit} disabled={saving}
        className="p-2 rounded-lg text-white transition-colors"
        style={{ background: color.accent }}>
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      </button>
      <button onClick={() => setOpen(false)} className="p-2 rounded-lg hover:bg-stone-100">
        <X size={12} className="text-stone-400" />
      </button>
    </div>
  )
}

// ─── Item card ────────────────────────────────────────────────────────────────

function ItemCard({ item, onToggle, onDelete, onMoveToFocus, color, showMoveToFocus }: {
  item: WorkspaceItem
  onToggle: (id: string, completed: boolean) => void
  onDelete: (id: string) => void
  onMoveToFocus: (id: string) => void
  color: typeof PINK
  showMoveToFocus: boolean
}) {
  const [hover, setHover] = useState(false)

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group flex items-start gap-2.5 px-3 py-2.5 rounded-xl transition-all"
      style={{
        background: item.completed ? '#F9FAFB' : hover ? color.light : 'white',
        border: `1px solid ${item.completed ? '#E5E7EB' : color.border}`,
        opacity: item.completed ? 0.65 : 1,
      }}
    >
      {/* Priority dot */}
      <div className="flex-shrink-0 mt-0.5 w-2 h-2 rounded-full"
        style={{ background: item.completed ? '#CBD5E1' : PRIORITY_DOT[item.priority] ?? '#CBD5E1', marginTop: 6 }} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-[12px] font-medium leading-snug ${item.completed ? 'line-through text-stone-400' : 'text-stone-800'}`}>
          {item.title}
        </p>
        {item.notes && !item.completed && (
          <p className="text-[10px] text-stone-400 mt-0.5 truncate">{item.notes}</p>
        )}
        {item.contact_name && (
          <div className="flex items-center gap-1 mt-1">
            <User size={9} className="text-stone-400" />
            <span className="text-[10px] text-stone-500">{item.contact_name}</span>
            <span className="text-[10px] font-semibold ml-1" style={{ color: ageColor(item.created_at) }}>
              · {timeAgo(item.created_at)}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className={`flex items-center gap-1 flex-shrink-0 transition-opacity ${hover ? 'opacity-100' : 'opacity-0'}`}>
        {showMoveToFocus && !item.completed && (
          <button
            title="Move to Focus Today"
            onClick={() => onMoveToFocus(item.id)}
            className="p-1 rounded-md hover:bg-pink-100 transition-colors"
          >
            <Zap size={11} style={{ color: PINK.accent }} />
          </button>
        )}
        <button onClick={() => onToggle(item.id, item.completed)}
          className="p-1 rounded-md transition-colors"
          style={{ color: item.completed ? '#10B981' : color.accent }}
          title={item.completed ? 'Reopen' : 'Mark done'}
        >
          {item.completed ? <CheckCircle2 size={13} /> : <Circle size={13} />}
        </button>
        <button onClick={() => onDelete(item.id)}
          className="p-1 rounded-md hover:bg-red-50 transition-colors text-stone-300 hover:text-red-400">
          <X size={11} />
        </button>
      </div>
    </div>
  )
}

// ─── Pulse note ───────────────────────────────────────────────────────────────

function PulseNoteWidget({ projectLabel, note, onChange }: {
  projectLabel: string
  note: string
  onChange: (label: string, content: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(note)
  const [open, setOpen] = useState(false)

  function save() {
    onChange(projectLabel, val)
    setEditing(false)
  }

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-lg transition-colors"
        style={{ color: PURPLE.accent, background: open ? PURPLE.light : 'transparent' }}
      >
        <StickyNote size={10} /> Pulse note
        {open ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
      </button>

      {open && (
        <div className="mt-2 rounded-xl p-3" style={{ background: PURPLE.bg, border: `1px solid ${PURPLE.border}` }}>
          {editing ? (
            <>
              <textarea
                autoFocus
                value={val}
                onChange={e => setVal(e.target.value)}
                rows={3}
                className="w-full text-[11px] bg-white rounded-lg p-2 border resize-none focus:outline-none"
                style={{ borderColor: PURPLE.border }}
                placeholder="Quick thoughts, reminders, thread not to lose…"
              />
              <div className="flex gap-2 mt-1.5">
                <button onClick={save} className="text-[10px] font-semibold px-2.5 py-1 rounded-lg text-white"
                  style={{ background: PURPLE.accent }}>Save</button>
                <button onClick={() => { setVal(note); setEditing(false) }}
                  className="text-[10px] text-stone-400 px-2 py-1 rounded-lg hover:bg-white transition-colors">Cancel</button>
              </div>
            </>
          ) : (
            <div onClick={() => setEditing(true)} className="cursor-text min-h-[40px]">
              {val ? (
                <p className="text-[11px] text-stone-600 leading-relaxed whitespace-pre-wrap">{val}</p>
              ) : (
                <p className="text-[11px] italic" style={{ color: PURPLE.accent }}>
                  Tap to add a pulse note…
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Weekly digest banner ─────────────────────────────────────────────────────

function WeeklyDigest({ items, tickets }: { items: WorkspaceItem[]; tickets: TicketRow[] }) {
  const [open, setOpen] = useState(false)

  const completed   = items.filter(i => i.completed).length
  const total       = items.length
  const blockers    = items.filter(i => i.zone === 'blocker' && !i.completed).length
  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length
  const resolved    = tickets.filter(t => t.status === 'resolved').length

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #FDF2F8 0%, #FAF5FF 50%, #FFF7ED 100%)', border: `1px solid ${PINK.border}` }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[14px]"
            style={{ background: 'linear-gradient(135deg, #EC4899, #A855F7)' }}>
            <BookOpen size={14} />
          </div>
          <div>
            <p className="font-semibold text-[13px] text-stone-700">Weekly Digest</p>
            <p className="text-[11px] text-stone-400">
              {completed}/{total} items done · {openTickets} ticket{openTickets !== 1 ? 's' : ''} active
            </p>
          </div>
        </div>
        {open ? <ChevronUp size={15} className="text-stone-400" /> : <ChevronDown size={15} className="text-stone-400" />}
      </button>

      {open && (
        <div className="px-5 pb-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Items completed',   value: completed,    color: '#10B981' },
            { label: 'Still open',        value: total - completed, color: PINK.accent },
            { label: 'Active blockers',   value: blockers,     color: '#F97316' },
            { label: 'Tickets resolved',  value: resolved,     color: PURPLE.accent },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white/70 rounded-xl px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-stone-400 mb-1">{label}</p>
              <p className="font-bold text-[22px] leading-none" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════════════

type MobileTab = 'runway' | 'focus' | 'blockers' | 'tickets'

export default function WorkspacePage() {
  const { displayName, isIT, p, loading: al, userId } = useAuth()
  const router = useRouter()

  const [items,      setItems]      = useState<WorkspaceItem[]>([])
  const [pulseNotes, setPulseNotes] = useState<PulseNote[]>([])
  const [tickets,    setTickets]    = useState<TicketRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [quietMode,  setQuietMode]  = useState(false)
  const [mobileTab,  setMobileTab]  = useState<MobileTab>('focus')
  const [ticketFilter, setTicketFilter] = useState('all')
  const [newProject, setNewProject] = useState('')
  const [addProjectOpen, setAddProjectOpen] = useState(false)

  const canAccess = isIT || p('can_access_workspace')

  useEffect(() => {
    if (!al && !canAccess) router.replace('/dashboard')
  }, [al, canAccess, router])

  useEffect(() => {
    if (al) return
    Promise.all([
      fetch('/api/workspace/items').then(r => r.ok ? r.json() : []),
      fetch('/api/workspace/pulse').then(r => r.ok ? r.json() : []),
      fetch('/api/axis/tickets').then(r => r.ok ? r.json() : []),
    ]).then(([i, p, t]) => {
      setItems(i)
      setPulseNotes(p)
      setTickets(t)
      setLoading(false)
    })
  }, [al])

  // ─── Derived ──────────────────────────────────────────────────────────────

  const runwayItems  = useMemo(() => items.filter(i => i.zone === 'runway'),  [items])
  const focusItems   = useMemo(() => items.filter(i => i.zone === 'focus'),   [items])
  const blockers     = useMemo(() => items.filter(i => i.zone === 'blocker'), [items])
  const followups    = useMemo(() => items.filter(i => i.zone === 'followup'), [items])

  const projects = useMemo(() => {
    const labels = new Set<string>()
    for (const i of runwayItems) if (i.project_label) labels.add(i.project_label)
    return Array.from(labels).sort()
  }, [runwayItems])

  function getPulse(label: string) {
    return pulseNotes.find(p => p.project_label === label)?.content ?? ''
  }

  const myTickets = useMemo(() => {
    const filtered = ticketFilter === 'all' ? tickets
      : tickets.filter(t => t.status === ticketFilter)
    return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [tickets, ticketFilter])

  // ─── API helpers ──────────────────────────────────────────────────────────

  async function addItem(zone: WorkspaceItem['zone'], title: string, extra?: Partial<WorkspaceItem>) {
    const res = await fetch('/api/workspace/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone, title, ...extra }),
    })
    if (res.ok) {
      const item = await res.json()
      setItems(prev => [...prev, item])
    }
  }

  async function toggleItem(id: string, completed: boolean) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, completed: !completed } : i))
    await fetch('/api/workspace/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, completed: !completed }),
    })
  }

  async function deleteItem(id: string) {
    setItems(prev => prev.filter(i => i.id !== id))
    await fetch(`/api/workspace/items?id=${id}`, { method: 'DELETE' })
  }

  async function moveToFocus(id: string) {
    if (focusItems.filter(i => !i.completed).length >= 5) {
      alert("Focus Today is at capacity (max 5). Complete or remove an item first.")
      return
    }
    setItems(prev => prev.map(i => i.id === id ? { ...i, zone: 'focus' } : i))
    await fetch('/api/workspace/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, zone: 'focus' }),
    })
  }

  async function savePulse(label: string, content: string) {
    setPulseNotes(prev => {
      const exists = prev.find(p => p.project_label === label)
      if (exists) return prev.map(p => p.project_label === label ? { ...p, content } : p)
      return [...prev, { id: '', project_label: label, content, updated_at: new Date().toISOString() }]
    })
    await fetch('/api/workspace/pulse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_label: label, content }),
    })
  }

  async function addProject() {
    if (!newProject.trim()) return
    await addItem('runway', `First task`, { project_label: newProject.trim() })
    setNewProject(''); setAddProjectOpen(false)
  }

  // ─── Sections ─────────────────────────────────────────────────────────────

  const focusCount    = focusItems.filter(i => !i.completed).length
  const focusProgress = focusCount / 5

  // ─── Render helpers ───────────────────────────────────────────────────────

  function RunwayZone() {
    return (
      <div className={`transition-all duration-300 ${quietMode ? 'opacity-20 pointer-events-none' : ''}`}>
        <ZoneHeader
          title="Runway"
          subtitle="All your work, by project"
          icon={<AlignLeft size={14} />}
          color={ORANGE}
        />
        <div className="space-y-4 mt-4">
          {projects.length === 0 && (
            <div className="text-center py-8 rounded-2xl" style={{ background: ORANGE.bg, border: `1px dashed ${ORANGE.border}` }}>
              <p className="text-[12px]" style={{ color: ORANGE.accent }}>No projects yet</p>
              <p className="text-[11px] text-stone-400 mt-1">Add a project to get started</p>
            </div>
          )}
          {projects.map(proj => (
            <div key={proj} className="rounded-2xl p-4 space-y-2"
              style={{ background: ORANGE.bg, border: `1px solid ${ORANGE.border}` }}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-[13px] text-stone-700">{proj}</h3>
                <span className="font-mono text-[10px] text-stone-400">
                  {runwayItems.filter(i => i.project_label === proj && !i.completed).length} open
                </span>
              </div>
              <div className="space-y-1.5">
                {runwayItems
                  .filter(i => i.project_label === proj)
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map(item => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggle={toggleItem}
                      onDelete={deleteItem}
                      onMoveToFocus={moveToFocus}
                      color={ORANGE}
                      showMoveToFocus={true}
                    />
                  ))}
              </div>
              <InlineAdd
                placeholder="Add task…"
                color={ORANGE}
                onAdd={(title) => addItem('runway', title, { project_label: proj })}
              />
              <PulseNoteWidget
                projectLabel={proj}
                note={getPulse(proj)}
                onChange={savePulse}
              />
            </div>
          ))}
        </div>

        {/* Add project */}
        <div className="mt-3">
          {addProjectOpen ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newProject}
                onChange={e => setNewProject(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addProject(); if (e.key === 'Escape') setAddProjectOpen(false) }}
                placeholder="Project name…"
                className="flex-1 px-3 py-2 rounded-xl border text-[12px] focus:outline-none"
                style={{ borderColor: ORANGE.border }}
              />
              <button onClick={addProject} className="px-3 py-2 rounded-xl text-white text-[12px] font-semibold"
                style={{ background: ORANGE.accent }}>Add</button>
              <button onClick={() => setAddProjectOpen(false)} className="p-2 rounded-xl hover:bg-stone-100">
                <X size={12} className="text-stone-400" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddProjectOpen(true)}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-[12px] font-medium transition-colors text-stone-400 hover:text-stone-600 border border-dashed border-stone-200 hover:border-stone-400"
            >
              <Plus size={12} /> New project
            </button>
          )}
        </div>
      </div>
    )
  }

  function FocusTodayZone() {
    const activeFocus = focusItems.filter(i => !i.completed)
    const doneFocus   = focusItems.filter(i => i.completed)

    return (
      <div className="transition-all duration-300" style={quietMode ? { outline: `3px solid ${PINK.accent}`, borderRadius: 16 } : {}}>
        <ZoneHeader
          title="Focus Today"
          subtitle={`Your contract with today · ${activeFocus.length}/5`}
          icon={<Flame size={14} />}
          color={PINK}
          right={
            <div className="flex items-center gap-1">
              <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: PINK.light }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${(activeFocus.length / 5) * 100}%`, background: PINK.accent }}
                />
              </div>
            </div>
          }
        />

        <div className="mt-4 rounded-2xl p-4 space-y-2 min-h-[200px] transition-all duration-300"
          style={{
            background: `linear-gradient(145deg, ${PINK.bg}, white)`,
            border: `1px solid ${PINK.border}`,
            ...(quietMode ? { boxShadow: `0 0 0 3px ${PINK.accent}` } : {}),
          }}>
          {activeFocus.length === 0 && doneFocus.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
                style={{ background: PINK.light }}>
                <Zap size={20} style={{ color: PINK.accent }} />
              </div>
              <p className="text-[13px] font-medium text-stone-500">Nothing here yet</p>
              <p className="text-[11px] text-stone-400 mt-1">Hit ⚡ on any Runway item to pull it in</p>
            </div>
          )}
          {activeFocus.map(item => (
            <ItemCard
              key={item.id}
              item={item}
              onToggle={toggleItem}
              onDelete={deleteItem}
              onMoveToFocus={() => {}}
              color={PINK}
              showMoveToFocus={false}
            />
          ))}
          {activeFocus.length < 5 && (
            <InlineAdd
              placeholder="Add focus item…"
              color={PINK}
              onAdd={(title) => addItem('focus', title)}
            />
          )}
          {activeFocus.length >= 5 && (
            <p className="text-center text-[11px] py-1" style={{ color: PINK.accent }}>
              Max 5 items — complete one to add more
            </p>
          )}
          {doneFocus.length > 0 && (
            <div className="pt-2 border-t mt-2" style={{ borderColor: PINK.border }}>
              <p className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: PINK.accent }}>
                Done today
              </p>
              {doneFocus.map(item => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onToggle={toggleItem}
                  onDelete={deleteItem}
                  onMoveToFocus={() => {}}
                  color={PINK}
                  showMoveToFocus={false}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  function BlockersZone() {
    return (
      <div className={`transition-all duration-300 ${quietMode ? 'opacity-20 pointer-events-none' : ''}`}>
        <ZoneHeader
          title="Blockers & Follow-ups"
          subtitle="What's stuck, what needs chasing"
          icon={<AlertCircle size={14} />}
          color={PURPLE}
        />
        <div className="mt-4 space-y-3">
          {/* Blockers */}
          <div className="rounded-2xl p-4" style={{ background: PURPLE.bg, border: `1px solid ${PURPLE.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-3.5 rounded-full" style={{ background: PURPLE.accent }} />
              <span className="font-mono text-[10px] uppercase tracking-wider font-semibold" style={{ color: PURPLE.accent }}>
                Waiting on
              </span>
              {blockers.filter(i => !i.completed).length > 0 && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full text-white"
                  style={{ background: PURPLE.accent }}>
                  {blockers.filter(i => !i.completed).length}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {blockers.filter(i => !i.completed).length === 0 && (
                <p className="text-[11px] italic text-stone-400 py-1">Nothing blocking you right now ✓</p>
              )}
              {blockers
                .filter(i => !i.completed)
                .map(item => (
                  <ItemCard key={item.id} item={item}
                    onToggle={toggleItem} onDelete={deleteItem}
                    onMoveToFocus={() => {}} color={PURPLE} showMoveToFocus={false} />
                ))}
            </div>
            <InlineAdd
              placeholder="Add blocker…"
              color={PURPLE}
              onAdd={(title) => addItem('blocker', title)}
            />
          </div>

          {/* Follow-ups */}
          <div className="rounded-2xl p-4" style={{ background: PINK.bg, border: `1px solid ${PINK.border}` }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-3.5 rounded-full" style={{ background: PINK.accent }} />
              <span className="font-mono text-[10px] uppercase tracking-wider font-semibold" style={{ color: PINK.accent }}>
                Follow up
              </span>
              {followups.filter(i => !i.completed).length > 0 && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full text-white"
                  style={{ background: PINK.accent }}>
                  {followups.filter(i => !i.completed).length}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {followups.filter(i => !i.completed).length === 0 && (
                <p className="text-[11px] italic text-stone-400 py-1">All follow-ups chased ✓</p>
              )}
              {followups
                .filter(i => !i.completed)
                .map(item => (
                  <ItemCard key={item.id} item={item}
                    onToggle={toggleItem} onDelete={deleteItem}
                    onMoveToFocus={() => {}} color={PINK} showMoveToFocus={false} />
                ))}
            </div>
            <InlineAdd
              placeholder="Add follow-up…"
              color={PINK}
              onAdd={(title) => addItem('followup', title)}
            />
          </div>
        </div>
      </div>
    )
  }

  function TicketsZone() {
    const STATUS_TABS = ['all', 'open', 'in_progress', 'blocked', 'resolved']
    const ticketCounts = useMemo(() => {
      const m: Record<string, number> = {}
      for (const t of tickets) m[t.status] = (m[t.status] ?? 0) + 1
      return m
    }, [])

    return (
      <div className={`transition-all duration-300 ${quietMode ? 'opacity-20 pointer-events-none' : ''}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl flex items-center justify-center text-white"
              style={{ background: 'linear-gradient(135deg, #EC4899, #A855F7)' }}>
              <Ticket size={13} />
            </div>
            <div>
              <h2 className="font-semibold text-[14px] text-stone-800">My Tickets</h2>
              <p className="text-[10px] text-stone-400">{tickets.length} total assigned</p>
            </div>
          </div>
          <button
            onClick={() => router.push('/axis/tickets')}
            className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: PINK.accent, background: PINK.light }}
          >
            All tickets <ArrowRight size={11} />
          </button>
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto">
          {STATUS_TABS.map(s => (
            <button
              key={s}
              onClick={() => setTicketFilter(s)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all flex-shrink-0"
              style={ticketFilter === s
                ? { background: 'linear-gradient(135deg, #EC4899, #A855F7)', color: 'white' }
                : { background: '#F9FAFB', color: '#78716C' }
              }
            >
              {s === 'all' ? 'All' : s.replace('_', ' ')}
              {s !== 'all' && ticketCounts[s] ? ` (${ticketCounts[s]})` : ''}
            </button>
          ))}
        </div>

        {/* Ticket list */}
        <div className="space-y-2">
          {myTickets.length === 0 && (
            <div className="py-10 text-center rounded-2xl"
              style={{ background: PINK.bg, border: `1px dashed ${PINK.border}` }}>
              <Ticket size={20} className="mx-auto mb-2" style={{ color: PINK.accent }} />
              <p className="text-[12px] text-stone-500">No tickets in this view</p>
            </div>
          )}
          {myTickets.map(t => {
            const due = t.due_date ? new Date(t.due_date) : null
            const dueMs = due ? due.getTime() - Date.now() : null
            const dueColor = dueMs === null ? '#94A3B8'
              : dueMs < 0 ? '#EF4444'
              : dueMs < 259200000 ? '#F97316'
              : '#94A3B8'

            return (
              <div
                key={t.id}
                onClick={() => router.push('/axis/tickets')}
                className="rounded-xl p-4 cursor-pointer transition-all hover:-translate-y-0.5"
                style={{
                  background: 'white',
                  border: `1px solid ${PINK.border}`,
                  boxShadow: '0 1px 4px rgba(236,72,153,0.06)',
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded text-white"
                      style={{ background: 'linear-gradient(135deg, #EC4899, #A855F7)' }}>
                      {t.ticket_number}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-stone-800 leading-snug">{t.title}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${STATUS_STYLE[t.status]}`}>
                        {t.status.replace('_', ' ')}
                      </span>
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border bg-stone-50 text-stone-500 border-stone-200 capitalize">
                        {t.ticket_type}
                      </span>
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded" style={{ background: PURPLE.light, color: PURPLE.accent }}>
                        {CATEGORY_LABEL[t.category] ?? t.category}
                      </span>
                      {t.due_date && (
                        <span className="flex items-center gap-1 font-mono text-[9px]" style={{ color: dueColor }}>
                          <Calendar size={9} /> {fmtDate(t.due_date)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 font-mono text-[10px] text-stone-400">
                    {timeAgo(t.created_at)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (al || loading) return (
    <div className="flex items-center justify-center min-h-screen"
      style={{ background: 'linear-gradient(135deg, #FDF2F8 0%, #FAF5FF 50%, #FFF7ED 100%)' }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-full animate-pulse"
          style={{ background: 'linear-gradient(135deg, #EC4899, #A855F7)' }} />
        <p className="text-[12px] text-stone-400">Loading workspace…</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen pb-24 md:pb-0" style={{
      background: 'linear-gradient(160deg, #FFF5FA 0%, #FAF5FF 40%, #FFF7ED 100%)',
    }}>
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 pt-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">
              {new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="font-display font-bold text-[26px] leading-tight mt-0.5"
              style={{ background: 'linear-gradient(135deg, #EC4899, #A855F7, #F97316)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {greeting(displayName.split(' ')[0])}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Quiet mode toggle */}
            <button
              onClick={() => setQuietMode(q => !q)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-semibold transition-all"
              style={quietMode
                ? { background: 'linear-gradient(135deg, #EC4899, #A855F7)', color: 'white' }
                : { background: PINK.light, color: PINK.accent, border: `1px solid ${PINK.border}` }
              }
            >
              {quietMode ? <EyeOff size={13} /> : <Eye size={13} />}
              {quietMode ? 'Quiet mode on' : 'Quiet mode'}
            </button>
          </div>
        </div>

        {/* ── Weekly digest ── */}
        <div className="mb-6">
          <WeeklyDigest items={items} tickets={tickets} />
        </div>

        {/* ── Desktop: 3-column + tickets ── */}
        <div className="hidden md:grid md:grid-cols-3 gap-5 mb-6">
          <RunwayZone />
          <FocusTodayZone />
          <BlockersZone />
        </div>
        <div className="hidden md:block mb-8">
          <TicketsZone />
        </div>

        {/* ── Mobile: tab content ── */}
        <div className="md:hidden mb-4">
          {mobileTab === 'runway'  && <RunwayZone />}
          {mobileTab === 'focus'   && <FocusTodayZone />}
          {mobileTab === 'blockers'&& <BlockersZone />}
          {mobileTab === 'tickets' && <TicketsZone />}
        </div>

      </div>

      {/* ── Mobile tab bar ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t"
        style={{ background: 'white', borderColor: PINK.border }}>
        <div className="flex items-stretch">
          {([
            { key: 'runway',   label: 'Runway',   icon: AlignLeft    },
            { key: 'focus',    label: 'Focus',    icon: Flame        },
            { key: 'blockers', label: 'Blockers', icon: AlertCircle  },
            { key: 'tickets',  label: 'Tickets',  icon: Ticket       },
          ] as { key: MobileTab; label: string; icon: React.ElementType }[]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setMobileTab(key)}
              className="flex-1 flex flex-col items-center gap-1 py-3 transition-all"
              style={mobileTab === key
                ? { color: PINK.accent, borderTop: `2px solid ${PINK.accent}` }
                : { color: '#94A3B8', borderTop: '2px solid transparent' }
              }
            >
              <Icon size={18} />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Zone header ──────────────────────────────────────────────────────────────

function ZoneHeader({ title, subtitle, icon, color, right }: {
  title: string
  subtitle: string
  icon: React.ReactNode
  color: typeof PINK
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white flex-shrink-0"
          style={{ background: color.accent }}>
          {icon}
        </div>
        <div>
          <h2 className="font-semibold text-[14px] text-stone-800">{title}</h2>
          <p className="text-[10px] text-stone-400 mt-0.5">{subtitle}</p>
        </div>
      </div>
      {right}
    </div>
  )
}
