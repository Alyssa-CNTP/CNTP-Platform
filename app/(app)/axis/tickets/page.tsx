'use client'

// app/(app)/axis/tickets/page.tsx — System-wide ticket queue

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import {
  Plus, Loader2, Ticket, ChevronDown, ChevronUp,
  X, CheckCircle2, AlertCircle, Clock, Circle,
  Search, Filter, Send,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TicketRow {
  id: string
  ticket_number: string
  title: string
  description: string | null
  category: string
  ticket_type: string
  status: string
  priority: string
  assigned_to: string | null
  assigned_name: string | null
  created_by: string
  created_by_name: string | null
  due_date: string | null
  auto_routed: boolean
  created_at: string
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  open:        'bg-sky-50 text-sky-700 border-sky-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  blocked:     'bg-red-50 text-red-700 border-red-200',
  resolved:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed:      'bg-stone-100 text-stone-500 border-stone-200',
}

const STATUS_ICON: Record<string, React.ElementType> = {
  open:        Circle,
  in_progress: Clock,
  blocked:     AlertCircle,
  resolved:    CheckCircle2,
  closed:      CheckCircle2,
}

const PRIORITY_STYLE: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high:     'bg-orange-50 text-orange-700 border-orange-200',
  medium:   'bg-amber-50 text-amber-700 border-amber-200',
  low:      'bg-green-50 text-green-700 border-green-200',
}

const CATEGORY_LABEL: Record<string, string> = {
  app:            'Apps & Code',
  database:       'Database',
  infrastructure: 'Infrastructure',
  security:       'Security',
  ai_ml:          'AI & ML',
  general:        'General',
}

const CATEGORY_COLOR: Record<string, string> = {
  app:            '#1D4ED8',
  database:       '#7E22CE',
  infrastructure: '#C2410C',
  security:       '#B91C1C',
  ai_ml:          '#0D1F0D',
  general:        '#78716C',
}

function timeAgo(s: string) {
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000)
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  return `${Math.floor(m / 1440)}d ago`
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: '2-digit' })
}

// ─── New ticket form ──────────────────────────────────────────────────────────

interface NewTicketFormProps {
  onClose: () => void
  onCreated: () => void
}

function NewTicketForm({ onClose, onCreated }: NewTicketFormProps) {
  const { displayName } = useAuth()
  const [title,       setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [category,    setCategory]    = useState('app')
  const [ticketType,  setTicketType]  = useState('task')
  const [priority,    setPriority]    = useState('medium')
  const [dueDate,     setDueDate]     = useState('')
  const [saving,      setSaving]      = useState(false)
  const [err,         setErr]         = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setErr('Title is required'); return }
    setSaving(true); setErr('')
    const res = await fetch('/api/axis/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, description, category, ticket_type: ticketType,
        priority, due_date: dueDate || null, created_by_name: displayName,
      }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setErr(json.error ?? 'Failed to create ticket'); return }
    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-stone-400">New Ticket</p>
            <h2 className="font-semibold text-stone-800 mt-0.5">Create ticket</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors">
            <X size={16} className="text-stone-500" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-stone-400 mb-1.5">Title *</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-[13px] focus:outline-none focus:border-stone-400 focus:ring-1 focus:ring-stone-200"
            />
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-stone-400 mb-1.5">Description</label>
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Additional context, steps to reproduce, acceptance criteria…"
              className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-[13px] focus:outline-none focus:border-stone-400 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-stone-400 mb-1.5">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-[13px] focus:outline-none focus:border-stone-400 bg-white">
                <option value="app">Apps & Code</option>
                <option value="database">Database</option>
                <option value="infrastructure">Infrastructure</option>
                <option value="security">Security</option>
                <option value="ai_ml">AI & ML</option>
                <option value="general">General</option>
              </select>
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-stone-400 mb-1.5">Type</label>
              <select value={ticketType} onChange={e => setTicketType(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-[13px] focus:outline-none focus:border-stone-400 bg-white">
                <option value="task">Task</option>
                <option value="bug">Bug</option>
                <option value="feature">Feature</option>
                <option value="maintenance">Maintenance</option>
                <option value="incident">Incident</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-stone-400 mb-1.5">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-[13px] focus:outline-none focus:border-stone-400 bg-white">
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-stone-400 mb-1.5">Due date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-[13px] focus:outline-none focus:border-stone-400"
              />
            </div>
          </div>


          {err && <p className="text-[12px] text-red-600">{err}</p>}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-[13px] font-medium text-stone-500 hover:text-stone-700 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-stone-800 text-white text-[13px] font-semibold hover:bg-stone-700 transition-colors disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Create ticket
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Ticket detail panel ──────────────────────────────────────────────────────

function TicketDetail({ ticket, onClose, onUpdate }: {
  ticket: TicketRow
  onClose: () => void
  onUpdate: () => void
}) {
  const { isIT, p } = useAuth()
  const [status, setStatus] = useState(ticket.status)
  const [saving, setSaving] = useState(false)

  async function updateStatus(s: string) {
    setSaving(true)
    await fetch(`/api/axis/tickets/${ticket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: s }),
    })
    setStatus(s)
    setSaving(false)
    onUpdate()
  }

  const StatusIcon = STATUS_ICON[status] ?? Circle

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative h-full w-full max-w-lg bg-white shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-stone-100 px-6 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[11px] font-bold text-stone-400">{ticket.ticket_number}</span>
              <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${PRIORITY_STYLE[ticket.priority]}`}>
                {ticket.priority}
              </span>
            </div>
            <h2 className="font-semibold text-stone-800 text-[15px] leading-snug">{ticket.title}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-100 flex-shrink-0">
            <X size={15} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Status */}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-stone-400 mb-2">Status</p>
            <div className="flex flex-wrap gap-2">
              {(['open','in_progress','blocked','resolved','closed'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => (isIT || p('can_assign_tickets')) && updateStatus(s)}
                  disabled={saving}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${
                    status === s
                      ? STATUS_STYLE[s] + ' ring-1 ring-current'
                      : 'bg-stone-50 text-stone-500 border-stone-200 hover:bg-stone-100'
                  } ${(!isIT && !p('can_assign_tickets')) ? 'cursor-default' : 'cursor-pointer'}`}
                >
                  {s.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-4 text-[12px]">
            {[
              { label: 'Category',    value: CATEGORY_LABEL[ticket.category] ?? ticket.category },
              { label: 'Type',        value: ticket.ticket_type },
              { label: 'Assigned to', value: ticket.assigned_name ?? 'Unassigned' },
              { label: 'Created by',  value: ticket.created_by_name ?? '—' },
              { label: 'Due date',    value: fmtDate(ticket.due_date) },
              { label: 'Logged',      value: timeAgo(ticket.created_at) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="font-mono text-[10px] uppercase tracking-wider text-stone-400 mb-0.5">{label}</p>
                <p className="text-stone-700 font-medium">{value}</p>
              </div>
            ))}
          </div>

          {/* Description */}
          {ticket.description && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-stone-400 mb-2">Description</p>
              <p className="text-[13px] text-stone-600 leading-relaxed whitespace-pre-wrap">{ticket.description}</p>
            </div>
          )}

          {ticket.auto_routed && (
            <div className="px-3 py-2 rounded-lg bg-sky-50 border border-sky-200">
              <p className="text-[11px] text-sky-600">Auto-routed based on category</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════════════

export default function TicketsPage() {
  const { isIT, p, loading: al } = useAuth()
  const router = useRouter()
  const [tickets,   setTickets]   = useState<TicketRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [showForm,  setShowForm]  = useState(false)
  const [detail,    setDetail]    = useState<TicketRow | null>(null)
  const [search,    setSearch]    = useState('')
  const [statusTab, setStatusTab] = useState('all')
  const [sortKey,   setSortKey]   = useState<'created_at' | 'priority' | 'due_date'>('created_at')
  const [sortDir,   setSortDir]   = useState<'asc' | 'desc'>('desc')

  const canManage = isIT || p('can_assign_tickets')

  useEffect(() => {
    if (!al && !isIT && !p('can_assign_tickets')) router.replace('/dashboard')
  }, [isIT, al, p, router])

  useEffect(() => {
    if (al) return
    load()
  }, [al])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/axis/tickets')
    if (res.ok) setTickets(await res.json())
    setLoading(false)
  }

  const STATUS_TABS = ['all', 'open', 'in_progress', 'blocked', 'resolved', 'closed']

  const prioRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

  const filtered = useMemo(() => {
    let arr = [...tickets]
    if (statusTab !== 'all') arr = arr.filter(t => t.status === statusTab)
    if (search.trim()) {
      const q = search.toLowerCase()
      arr = arr.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.ticket_number.toLowerCase().includes(q) ||
        t.assigned_name?.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      )
    }
    arr.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'created_at') cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      else if (sortKey === 'priority') cmp = (prioRank[a.priority] ?? 0) - (prioRank[b.priority] ?? 0)
      else if (sortKey === 'due_date') {
        const da = a.due_date ? new Date(a.due_date).getTime() : Infinity
        const db = b.due_date ? new Date(b.due_date).getTime() : Infinity
        cmp = da - db
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
    return arr
  }, [tickets, statusTab, search, sortKey, sortDir])

  function toggleSort(k: typeof sortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('desc') }
  }

  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of tickets) m[t.status] = (m[t.status] ?? 0) + 1
    return m
  }, [tickets])

  if (al || loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 size={18} className="animate-spin text-stone-400" />
    </div>
  )

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">

      {showForm && (
        <NewTicketForm
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load() }}
        />
      )}

      {detail && (
        <TicketDetail
          ticket={detail}
          onClose={() => setDetail(null)}
          onUpdate={load}
        />
      )}

      {/* ── Header ── */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">AXIS · Ticketing</p>
          <h1 className="font-display font-bold text-[24px] text-stone-800 leading-tight mt-0.5">Tickets</h1>
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-stone-800 text-white text-[13px] font-semibold hover:bg-stone-700 transition-colors"
          >
            <Plus size={14} /> New ticket
          </button>
        )}
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total',       value: tickets.length,            color: 'text-stone-700' },
          { label: 'Open',        value: counts.open        ?? 0,   color: 'text-sky-600' },
          { label: 'In Progress', value: counts.in_progress ?? 0,   color: 'text-amber-600' },
          { label: 'Blocked',     value: counts.blocked     ?? 0,   color: 'text-red-600' },
          { label: 'Resolved',    value: counts.resolved    ?? 0,   color: 'text-emerald-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white border border-stone-200 rounded-xl p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-stone-400 mb-1">{label}</p>
            <p className={`font-bold text-[26px] leading-none ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-stone-200 rounded-lg flex-1 min-w-[220px]">
          <Search size={13} className="text-stone-400 flex-shrink-0" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search tickets…"
            className="flex-1 text-[13px] outline-none bg-transparent"
          />
        </div>
        <div className="flex items-center gap-1 bg-white border border-stone-200 rounded-lg p-1 overflow-x-auto">
          {STATUS_TABS.map(s => (
            <button
              key={s}
              onClick={() => setStatusTab(s)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                statusTab === s
                  ? 'bg-stone-800 text-white'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              {s === 'all' ? 'All' : s.replace('_', ' ')}
              {s !== 'all' && counts[s] ? (
                <span className="ml-1 opacity-60">{counts[s]}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-3">
            <Ticket size={24} className="text-stone-300" />
            <p className="text-[13px] text-stone-400">No tickets found</p>
            {canManage && (
              <button onClick={() => setShowForm(true)}
                className="text-[12px] text-stone-600 underline underline-offset-2">
                Create the first ticket →
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr>
                  <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-stone-400 w-32">Ticket #</th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-stone-400">Title</th>
                  <th className="px-4 py-3 text-center font-mono text-[10px] uppercase tracking-wider text-stone-400">Category</th>
                  <th
                    className="px-4 py-3 text-center font-mono text-[10px] uppercase tracking-wider text-stone-400 cursor-pointer hover:text-stone-600 select-none"
                    onClick={() => toggleSort('priority')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Priority
                      {sortKey === 'priority' && (sortDir === 'asc' ? <ChevronUp size={10}/> : <ChevronDown size={10}/>)}
                    </span>
                  </th>
                  <th className="px-4 py-3 text-center font-mono text-[10px] uppercase tracking-wider text-stone-400">Status</th>
                  <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-stone-400">Assigned</th>
                  <th
                    className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-wider text-stone-400 cursor-pointer hover:text-stone-600 select-none"
                    onClick={() => toggleSort('due_date')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Due
                      {sortKey === 'due_date' && (sortDir === 'asc' ? <ChevronUp size={10}/> : <ChevronDown size={10}/>)}
                    </span>
                  </th>
                  <th
                    className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-wider text-stone-400 cursor-pointer hover:text-stone-600 select-none"
                    onClick={() => toggleSort('created_at')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Logged
                      {sortKey === 'created_at' && (sortDir === 'asc' ? <ChevronUp size={10}/> : <ChevronDown size={10}/>)}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const StatusIcon = STATUS_ICON[t.status] ?? Circle
                  const due = t.due_date ? new Date(t.due_date) : null
                  const dueMs = due ? due.getTime() - Date.now() : null
                  const dueColor = dueMs === null ? 'text-stone-400'
                    : dueMs < 0 ? 'text-red-600 font-semibold'
                    : dueMs < 86400000 * 3 ? 'text-orange-600 font-semibold'
                    : 'text-stone-500'
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setDetail(t)}
                      className="border-b border-stone-100 last:border-0 hover:bg-stone-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-[11px] font-bold text-stone-500">{t.ticket_number}</span>
                      </td>
                      <td className="px-4 py-3 max-w-[320px]">
                        <p className="font-medium text-stone-800 truncate">{t.title}</p>
                        <p className="text-[10px] text-stone-400 mt-0.5 capitalize">{t.ticket_type}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className="font-mono text-[10px] px-2 py-1 rounded-full text-white"
                          style={{ background: CATEGORY_COLOR[t.category] ?? '#78716C' }}
                        >
                          {CATEGORY_LABEL[t.category] ?? t.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_STYLE[t.priority] ?? ''}`}>
                          {t.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 font-mono text-[10px] px-2 py-1 rounded-lg border ${STATUS_STYLE[t.status] ?? ''}`}>
                          <StatusIcon size={9} />
                          {t.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-stone-600">
                        {t.assigned_name ?? <span className="text-stone-300 italic">Unassigned</span>}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-[11px] ${dueColor}`}>
                        {fmtDate(t.due_date)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[11px] text-stone-400">
                        {timeAgo(t.created_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
