'use client'

import { useEffect, useState, useRef } from 'react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import {
  Plus, Send, ChevronDown, ChevronRight, X,
  MessageSquare, Pin, Bell, Loader2,
} from 'lucide-react'
import { ALL_DEPARTMENTS } from '@/lib/auth/permissions'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Announcement {
  id:                 string
  title:              string
  body:               string
  from_name:          string
  from_user_id:       string | null
  target_departments: string[]
  pinned:             boolean
  created_at:         string
}

interface Comment {
  id:         string
  user_name:  string
  department: string | null
  body:       string
  created_at: string
}

// ── Department chip ───────────────────────────────────────────────────────────
function DeptChip({ dept }: { dept: string }) {
  const colors: Record<string, string> = {
    IT:         'bg-purple-50 text-purple-700 border-purple-200',
    Quality:    'bg-ok/8 text-ok border-ok/20',
    Production: 'bg-warn/8 text-warn border-warn/20',
    Management: 'bg-blue-50 text-blue-700 border-blue-200',
    Sales:      'bg-brand/8 text-brand border-brand/20',
    Marketing:  'bg-pink-50 text-pink-700 border-pink-200',
  }
  return (
    <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${colors[dept] ?? 'bg-surface text-text-muted border-surface-rule'}`}>
      {dept}
    </span>
  )
}

// ── Compose form ──────────────────────────────────────────────────────────────
function ComposeForm({ onSubmit, onCancel }: {
  onSubmit: (title: string, body: string, depts: string[]) => Promise<void>
  onCancel: () => void
}) {
  const [title,  setTitle]  = useState('')
  const [body,   setBody]   = useState('')
  const [depts,  setDepts]  = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  function toggleDept(dept: string) {
    setDepts(d => d.includes(dept) ? d.filter(x => x !== dept) : [...d, dept])
  }

  async function handleSubmit() {
    if (!title.trim() || !body.trim() || !depts.length) return
    setSaving(true)
    await onSubmit(title.trim(), body.trim(), depts)
    setSaving(false)
  }

  return (
    <div className="border border-brand/30 rounded-2xl overflow-hidden bg-surface-card shadow-lg">
      <div className="flex items-center justify-between px-4 py-3 bg-brand/5 border-b border-brand/20">
        <span className="font-display font-bold text-[13px] text-brand">New Announcement</span>
        <button onClick={onCancel} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-brand/10 transition-colors">
          <X size={13} className="text-brand" />
        </button>
      </div>

      <div className="p-4 space-y-3">
        <input
          type="text"
          placeholder="Subject line"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="w-full px-3 py-2 bg-surface border border-surface-rule rounded-lg font-body text-[13px] text-text outline-none focus:border-brand"
        />
        <textarea
          placeholder="Write your announcement…"
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 bg-surface border border-surface-rule rounded-lg font-body text-[13px] text-text outline-none focus:border-brand resize-none"
        />

        {/* Department selector */}
        <div>
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-2">Send to departments</p>
          <div className="flex flex-wrap gap-2">
            {ALL_DEPARTMENTS.map(dept => (
              <button
                key={dept}
                onClick={() => toggleDept(dept)}
                className={`px-2.5 py-1 rounded-lg font-mono text-[11px] border transition-colors ${
                  depts.includes(dept)
                    ? 'bg-brand text-white border-brand'
                    : 'bg-surface text-text-muted border-surface-rule hover:border-brand/40'
                }`}
              >
                {dept}
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={saving || !title.trim() || !body.trim() || !depts.length}
            className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl font-semibold text-[13px] disabled:opacity-40 hover:bg-brand-hover transition-colors"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {saving ? 'Sending…' : 'Send Announcement'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Announcement card ─────────────────────────────────────────────────────────
function AnnouncementCard({ ann, userId, department, displayName, isRead, onMarkRead }: {
  ann:         Announcement
  userId:      string | null
  department:  string | null
  displayName: string
  isRead:      boolean
  onMarkRead:  (id: string) => void
}) {
  const db = getDb()
  const [open,     setOpen]     = useState(!isRead)
  const [comments, setComments] = useState<Comment[]>([])
  const [loaded,   setLoaded]   = useState(false)
  const [reply,    setReply]    = useState('')
  const [sending,  setSending]  = useState(false)

  async function loadComments() {
    if (loaded) return
    const { data } = await db
      .from('announcement_comments')
      .select('id,user_name,department,body,created_at')
      .eq('announcement_id', ann.id)
      .order('created_at', { ascending: true })
    setComments(data ?? [])
    setLoaded(true)
  }

  async function handleOpen() {
    const next = !open
    setOpen(next)
    if (next) {
      loadComments()
      if (!isRead) onMarkRead(ann.id)
    }
  }

  async function sendReply() {
    if (!reply.trim()) return
    setSending(true)
    const { data } = await db
      .from('announcement_comments')
      .insert({
        announcement_id: ann.id,
        user_id:   userId,
        user_name: displayName,
        department,
        body:      reply.trim(),
      })
      .select('id,user_name,department,body,created_at')
      .single()
    if (data) setComments(c => [...c, data as Comment])
    setReply('')
    setSending(false)
  }

  return (
    <div className={`rounded-2xl border overflow-hidden transition-colors ${
      isRead ? 'border-surface-rule bg-surface-card' : 'border-brand/30 bg-brand/3'
    }`}>
      {/* Header */}
      <div
        className="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-surface transition-colors"
        onClick={handleOpen}
      >
        {/* Unread dot */}
        <div className="mt-1 flex-shrink-0">
          {!isRead ? (
            <div className="w-2 h-2 rounded-full bg-brand" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-surface-rule" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {ann.pinned && <Pin size={10} className="text-warn flex-shrink-0" />}
            <span className="font-display font-semibold text-[13px] text-text">{ann.title}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="font-mono text-[10px] text-text-muted">{ann.from_name}</span>
            <span className="font-mono text-[10px] text-text-faint">
              {formatDistanceToNow(parseISO(ann.created_at), { addSuffix: true })}
            </span>
            <div className="flex gap-1 flex-wrap">
              {ann.target_departments.map(d => <DeptChip key={d} dept={d} />)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {comments.length > 0 && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-text-muted">
              <MessageSquare size={10} /> {comments.length}
            </span>
          )}
          {open ? <ChevronDown size={13} className="text-text-muted" /> : <ChevronRight size={13} className="text-text-muted" />}
        </div>
      </div>

      {/* Expanded */}
      {open && (
        <div className="border-t border-surface-rule">
          {/* Body */}
          <div className="px-4 py-4">
            <p className="font-body text-[13px] text-text leading-relaxed whitespace-pre-wrap">{ann.body}</p>
            <p className="font-mono text-[10px] text-text-faint mt-2">{format(parseISO(ann.created_at), 'd MMMM yyyy · HH:mm')}</p>
          </div>

          {/* Comments */}
          {loaded && comments.length > 0 && (
            <div className="border-t border-surface-rule divide-y divide-surface-rule">
              {comments.map(c => (
                <div key={c.id} className="flex gap-3 px-4 py-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0 mt-0.5"
                    style={{ background: '#1A3A0E' }}>
                    {c.user_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[12px] text-text">{c.user_name}</span>
                      {c.department && <DeptChip dept={c.department} />}
                      <span className="font-mono text-[10px] text-text-faint ml-auto">
                        {formatDistanceToNow(parseISO(c.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="font-body text-[12px] text-text-muted mt-0.5 leading-relaxed">{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Reply box */}
          <div className="border-t border-surface-rule px-4 py-3 flex gap-2">
            <input
              type="text"
              placeholder="Reply to this announcement…"
              value={reply}
              onChange={e => setReply(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
              className="flex-1 px-3 py-2 bg-surface border border-surface-rule rounded-lg font-body text-[12px] text-text outline-none focus:border-brand"
            />
            <button
              onClick={sendReply}
              disabled={sending || !reply.trim()}
              className="px-3 py-2 bg-brand text-white rounded-lg disabled:opacity-40 hover:bg-brand-hover transition-colors"
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENT BOARD — MAIN EXPORT
// ═════════════════════════════════════════════════════════════════════════════
export default function AnnouncementBoard() {
  const db = getDb()
  const { userId, displayName, department, isManagement, isIT } = useAuth()

  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [readIds,       setReadIds]       = useState<Set<string>>(new Set())
  const [loading,       setLoading]       = useState(true)
  const [composing,     setComposing]     = useState(false)

  const canCompose = isManagement || isIT

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: anns }, { data: reads }] = await Promise.all([
      db.from('management_announcements')
        .select('id,title,body,from_name,from_user_id,target_departments,pinned,created_at')
        .order('pinned',      { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50),
      userId
        ? db.from('announcement_reads').select('announcement_id').eq('user_id', userId)
        : { data: [] },
    ])
    setAnnouncements(anns ?? [])
    setReadIds(new Set((reads ?? []).map((r: any) => r.announcement_id)))
    setLoading(false)
  }

  async function markRead(annId: string) {
    if (!userId || readIds.has(annId)) return
    setReadIds(prev => new Set([...prev, annId]))
    await db.from('announcement_reads').upsert({ announcement_id: annId, user_id: userId })
  }

  async function handleCompose(title: string, body: string, depts: string[]) {
    await db.from('management_announcements').insert({
      title,
      body,
      from_user_id:       userId,
      from_name:          displayName,
      target_departments: depts,
      pinned:             false,
    })
    setComposing(false)
    load()
  }

  // Filter: show announcements targeted at the user's department (or all if Management/IT)
  const visible = announcements.filter(a =>
    isManagement || isIT || !a.target_departments.length || (department && a.target_departments.includes(department))
  )

  const unreadCount = visible.filter(a => !readIds.has(a.id)).length

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bell size={15} className="text-text-muted" />
          <span className="font-display font-bold text-[15px] text-text">Announcements</span>
          {unreadCount > 0 && (
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-brand text-white font-mono text-[10px] font-bold">
              {unreadCount}
            </span>
          )}
        </div>
        {canCompose && !composing && (
          <button
            onClick={() => setComposing(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand text-white rounded-xl font-semibold text-[12px] hover:bg-brand-hover transition-colors"
          >
            <Plus size={13} /> New
          </button>
        )}
      </div>

      {/* Compose form */}
      {composing && (
        <ComposeForm onSubmit={handleCompose} onCancel={() => setComposing(false)} />
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-10 font-mono text-[12px] text-text-muted animate-pulse">
          Loading announcements…
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <div className="w-10 h-10 rounded-full bg-surface-dim flex items-center justify-center">
            <Bell size={18} className="text-text-faint" />
          </div>
          <p className="font-mono text-[12px] text-text-muted text-center">No announcements yet.</p>
          {canCompose && (
            <button onClick={() => setComposing(true)} className="font-semibold text-[12px] text-brand hover:underline">
              Send the first one →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3 overflow-y-auto flex-1">
          {visible.map(a => (
            <AnnouncementCard
              key={a.id}
              ann={a}
              userId={userId}
              department={department}
              displayName={displayName}
              isRead={readIds.has(a.id)}
              onMarkRead={markRead}
            />
          ))}
        </div>
      )}
    </div>
  )
}
