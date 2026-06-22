'use client'

// components/axis/CommentThread.tsx
// Threaded comment widget for AXIS entities (project | change_log | project_request).
//   • Single-level threading (replies under a top-level comment)
//   • @-mention autocomplete from /api/axis/users
//   • Edit & soft-delete on your own comments
//   • Reply button on any non-deleted comment
//   • ⌘/Ctrl + Enter submits

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Loader2, Send, AtSign, MessageSquare,
  Pencil, Trash2, CornerDownRight, X, Check,
} from 'lucide-react'
import { Avatar } from './Avatar'

interface User {
  id: string
  name: string
  initials: string
  department: string | null
}

interface Comment {
  id: string
  entity_type: 'project' | 'change_log' | 'project_request'
  entity_id: string
  parent_id: string | null
  author_id: string
  author_name: string
  author_initials: string
  author_department: string | null
  body: string
  mentions: string[]
  mention_users: { id: string; name: string; initials: string }[]
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  is_deleted: boolean
  is_own: boolean
  replies: Comment[]
}

interface Props {
  entityType: 'project' | 'change_log' | 'project_request'
  entityId: string
  variant?: 'light' | 'dark'
}

function timeAgo(s: string) {
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000)
  if (m < 1)    return 'just now'
  if (m < 60)   return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  return `${Math.floor(m / 1440)}d ago`
}

function renderBody(body: string, mentionUsers: { id: string; name: string }[]) {
  if (mentionUsers.length === 0) return body
  const sorted = [...mentionUsers].sort((a, b) => b.name.length - a.name.length)
  const escaped = sorted.map(u => u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`@(${escaped.join('|')})`, 'g')
  const parts: React.ReactNode[] = []
  let lastIdx = 0
  let match: RegExpExecArray | null
  let k = 0
  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIdx) parts.push(body.slice(lastIdx, match.index))
    parts.push(
      <span key={k++}
        className="font-semibold px-1 rounded"
        style={{ background: 'rgba(45,125,50,0.10)', color: 'var(--color-accent)' }}>
        @{match[1]}
      </span>
    )
    lastIdx = match.index + match[0].length
  }
  if (lastIdx < body.length) parts.push(body.slice(lastIdx))
  return parts
}

// ─── Composer (used for top-level + reply + edit) ─────────────────────────────

function Composer({
  users, initialValue = '', placeholder, submitLabel, submittingLabel,
  onSubmit, onCancel, variant, autoFocus, compact,
}: {
  users: User[]
  initialValue?: string
  placeholder: string
  submitLabel: string
  submittingLabel?: string
  onSubmit: (body: string) => Promise<void>
  onCancel?: () => void
  variant: 'light' | 'dark'
  autoFocus?: boolean
  compact?: boolean
}) {
  const isDark = variant === 'dark'
  const [draft,    setDraft]    = useState(initialValue)
  const [posting,  setPosting]  = useState(false)
  const [acOpen,   setAcOpen]   = useState(false)
  const [acQuery,  setAcQuery]  = useState('')
  const [acIndex,  setAcIndex]  = useState(0)
  const [acStart,  setAcStart]  = useState<number | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        const len = inputRef.current?.value.length ?? 0
        inputRef.current?.setSelectionRange(len, len)
      })
    }
  }, [autoFocus])

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setDraft(value)
    const caret = e.target.selectionStart ?? value.length
    const before = value.slice(0, caret)
    const at = before.lastIndexOf('@')
    if (at < 0) { setAcOpen(false); return }
    const between = before.slice(at + 1)
    if (/[\n]/.test(between) || between.length > 24) { setAcOpen(false); return }
    setAcStart(at); setAcQuery(between); setAcIndex(0); setAcOpen(true)
  }

  const matchedUsers = acOpen
    ? users.filter(u => u.name.toLowerCase().includes(acQuery.toLowerCase())).slice(0, 6)
    : []

  function applyMention(user: User) {
    if (acStart === null) return
    const before = draft.slice(0, acStart)
    const after  = draft.slice(acStart + 1 + acQuery.length)
    const next   = `${before}@${user.name} ${after}`
    setDraft(next)
    setAcOpen(false); setAcStart(null); setAcQuery('')
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      const pos = before.length + 1 + user.name.length + 1
      inputRef.current?.setSelectionRange(pos, pos)
    })
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (acOpen && matchedUsers.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIndex(i => Math.min(matchedUsers.length - 1, i + 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setAcIndex(i => Math.max(0, i - 1)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyMention(matchedUsers[acIndex]); return }
      if (e.key === 'Escape')    { e.preventDefault(); setAcOpen(false); return }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault(); submit()
    }
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel() }
  }

  async function submit() {
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    try { await onSubmit(body) }
    finally { setPosting(false) }
  }

  return (
    <div className="relative">
      <textarea
        ref={inputRef}
        value={draft}
        onChange={onChange}
        onKeyDown={onKey}
        placeholder={placeholder}
        rows={compact ? 2 : 2}
        className="w-full px-3 py-2 rounded-xl text-[12px] placeholder:opacity-50 focus:outline-none resize-none"
        style={isDark
          ? { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)' }
          : { background: 'var(--color-surface)', border: '1px solid var(--color-surface-rule)', color: 'var(--color-text)' }}
      />

      {acOpen && matchedUsers.length > 0 && (
        <div className="absolute z-10 mt-1 w-64 rounded-xl shadow-lg overflow-hidden"
          style={{
            background: isDark ? '#1f1f22' : '#fff',
            border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid var(--color-surface-rule)',
            top: '100%',
          }}>
          <p className="px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider"
            style={{
              color: isDark ? 'rgba(255,255,255,0.3)' : 'var(--color-text-muted)',
              borderBottom: isDark ? '1px solid rgba(255,255,255,0.05)' : '1px solid var(--color-surface-rule)',
            }}>
            Mention
          </p>
          {matchedUsers.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onClick={() => applyMention(u)}
              onMouseEnter={() => setAcIndex(i)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
              style={{
                background: i === acIndex
                  ? (isDark ? 'rgba(255,255,255,0.05)' : 'var(--color-surface-raised)')
                  : 'transparent',
              }}
            >
              <Avatar initials={u.initials} userId={u.id} size={22} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] truncate"
                  style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--color-text)' }}>
                  {u.name}
                </p>
                {u.department && (
                  <p className="font-mono text-[9px] uppercase tracking-wide"
                    style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'var(--color-text-faint)' }}>
                    {u.department}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-1.5">
        <span className="font-mono text-[10px]"
          style={{ color: isDark ? 'rgba(255,255,255,0.25)' : 'var(--color-text-faint)' }}>
          <AtSign size={9} className="inline -mt-px mr-0.5" /> mention with @
        </span>
        <div className="flex items-center gap-1.5">
          {onCancel && (
            <button onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
              style={{
                background: isDark ? 'rgba(255,255,255,0.04)' : 'var(--color-surface)',
                color: isDark ? 'rgba(255,255,255,0.6)' : 'var(--color-text-muted)',
                border: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid var(--color-surface-rule)',
              }}>
              Cancel
            </button>
          )}
          <button
            onClick={submit}
            disabled={!draft.trim() || posting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40 transition-colors text-white"
            style={{ background: 'var(--color-brand)' }}
          >
            {posting
              ? <><Loader2 size={11} className="animate-spin" /> {submittingLabel ?? submitLabel}</>
              : <><Send size={11} /> {submitLabel}</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Single comment row (recursive for replies) ───────────────────────────────

function CommentRow({
  comment, users, variant, depth,
  onReplyAdded, onEditAdded, onDeleted,
}: {
  comment: Comment
  users: User[]
  variant: 'light' | 'dark'
  depth: number
  onReplyAdded: () => void
  onEditAdded: () => void
  onDeleted: () => void
}) {
  const isDark = variant === 'dark'
  const [replyOpen, setReplyOpen] = useState(false)
  const [editOpen,  setEditOpen]  = useState(false)
  const [deleting,  setDeleting]  = useState(false)

  async function submitReply(body: string) {
    const res = await fetch('/api/axis/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_type: comment.entity_type ?? undefined, // not on comment shape; pass from parent
        entity_id:   comment.entity_id ?? undefined,
        parent_id:   comment.id,
        body,
      }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      return
    }
    setReplyOpen(false)
    onReplyAdded()
  }

  async function submitEdit(body: string) {
    const res = await fetch(`/api/axis/comments/${comment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      return
    }
    setEditOpen(false)
    onEditAdded()
  }

  async function handleDelete() {
    if (!confirm('Delete this comment?')) return
    setDeleting(true)
    const res = await fetch(`/api/axis/comments/${comment.id}`, { method: 'DELETE' })
    setDeleting(false)
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      return
    }
    onDeleted()
  }

  const bodyColor   = isDark ? 'rgba(255,255,255,0.75)' : 'var(--color-text)'
  const muteColor   = isDark ? 'rgba(255,255,255,0.35)' : 'var(--color-text-muted)'
  const faintColor  = isDark ? 'rgba(255,255,255,0.25)' : 'var(--color-text-faint)'
  const itemBg      = isDark ? 'rgba(255,255,255,0.02)' : 'var(--color-surface-raised)'
  const itemBorder  = isDark ? '1px solid rgba(255,255,255,0.06)' : 'none'

  return (
    <div className="space-y-2">
      <div className="flex gap-2.5 px-3 py-2.5 rounded-xl"
        style={{ background: itemBg, border: itemBorder }}>
        <Avatar
          initials={comment.author_initials}
          userId={comment.author_id}
          size={depth > 0 ? 22 : 28}
          title={comment.author_name}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-[12px] font-semibold"
              style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--color-text)' }}>
              {comment.author_name}
            </span>
            {comment.author_department && (
              <span className="font-mono text-[9px] uppercase tracking-wide" style={{ color: faintColor }}>
                {comment.author_department}
              </span>
            )}
            <span className="font-mono text-[10px]" style={{ color: faintColor }}>
              {timeAgo(comment.created_at)}
              {comment.edited_at && <span className="ml-1 opacity-70">· edited</span>}
            </span>
          </div>

          {/* Body or edit composer or deleted placeholder */}
          {comment.is_deleted ? (
            <p className="text-[12px] italic" style={{ color: faintColor }}>
              [comment deleted]
            </p>
          ) : editOpen ? (
            <Composer
              users={users}
              initialValue={comment.body}
              placeholder="Edit your comment…"
              submitLabel="Save"
              submittingLabel="Saving"
              onSubmit={submitEdit}
              onCancel={() => setEditOpen(false)}
              variant={variant}
              autoFocus
              compact
            />
          ) : (
            <p className="text-[12px] leading-relaxed whitespace-pre-wrap break-words"
              style={{ color: bodyColor }}>
              {renderBody(comment.body, comment.mention_users)}
            </p>
          )}

          {!editOpen && !comment.is_deleted && comment.mention_users.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5">
              <AtSign size={9} style={{ color: muteColor }} />
              <div className="flex -space-x-1">
                {comment.mention_users.map(u => (
                  <Avatar key={u.id} initials={u.initials} userId={u.id} size={16} title={u.name} />
                ))}
              </div>
            </div>
          )}

          {/* Action bar */}
          {!editOpen && (
            <div className="flex items-center gap-3 mt-1.5">
              {!comment.is_deleted && depth === 0 && (
                <button onClick={() => setReplyOpen(o => !o)}
                  className="flex items-center gap-1 text-[10px] font-medium transition-colors"
                  style={{ color: muteColor }}>
                  <CornerDownRight size={10} /> Reply
                </button>
              )}
              {!comment.is_deleted && comment.is_own && (
                <>
                  <button onClick={() => setEditOpen(true)}
                    className="flex items-center gap-1 text-[10px] font-medium transition-colors"
                    style={{ color: muteColor }}>
                    <Pencil size={10} /> Edit
                  </button>
                  <button onClick={handleDelete} disabled={deleting}
                    className="flex items-center gap-1 text-[10px] font-medium transition-colors disabled:opacity-50"
                    style={{ color: 'var(--color-err)' }}>
                    {deleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />} Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Reply composer */}
      {replyOpen && (
        <div className="ml-10">
          <Composer
            users={users}
            placeholder={`Reply to ${comment.author_name}… type @ to mention.`}
            submitLabel="Reply"
            onSubmit={submitReply}
            onCancel={() => setReplyOpen(false)}
            variant={variant}
            autoFocus
            compact
          />
        </div>
      )}

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="ml-10 space-y-2 border-l-2 pl-3"
          style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'var(--color-surface-rule)' }}>
          {comment.replies.map(r => (
            <CommentRow
              key={r.id}
              comment={r}
              users={users}
              variant={variant}
              depth={depth + 1}
              onReplyAdded={onReplyAdded}
              onEditAdded={onEditAdded}
              onDeleted={onDeleted}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main thread ─────────────────────────────────────────────────────────────

export function CommentThread({ entityType, entityId, variant = 'light' }: Props) {
  const [comments, setComments] = useState<Comment[]>([])
  const [users,    setUsers]    = useState<User[]>([])
  const [loading,  setLoading]  = useState(true)

  const isDark = variant === 'dark'

  const load = useCallback(async () => {
    const res = await fetch(`/api/axis/comments?entity_type=${entityType}&entity_id=${entityId}`)
    const data = res.ok ? await res.json() : []
    // Stamp entity_type/entity_id onto every node (server doesn't echo it in this list shape — actually it does, but we need it accessible for replies)
    const stamp = (c: any): Comment => ({
      ...c,
      entity_type: c.entity_type ?? entityType,
      entity_id:   c.entity_id ?? entityId,
      replies:     (c.replies ?? []).map(stamp),
    })
    setComments(Array.isArray(data) ? data.map(stamp) : [])
    setLoading(false)
  }, [entityType, entityId])

  useEffect(() => {
    if (!entityId) return
    setLoading(true)
    load()
    fetch('/api/axis/users')
      .then(r => r.ok ? r.json() : [])
      .catch(() => [])
      .then((u) => setUsers(Array.isArray(u) ? u : []))
  }, [entityId, load])

  async function submitTopLevel(body: string) {
    const res = await fetch('/api/axis/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: entityType, entity_id: entityId, body }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
      alert(`Error: ${error}`)
      return
    }
    await load()
  }

  // Visible count excludes soft-deleted ones (they still occupy a slot for thread continuity)
  const visibleCount = comments.reduce((sum, c) =>
    sum + (c.is_deleted ? 0 : 1) + c.replies.filter(r => !r.is_deleted).length, 0)

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <MessageSquare size={12}
          style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'var(--color-text-muted)' }} />
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] font-semibold"
          style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'var(--color-text-muted)' }}>
          Comments {visibleCount > 0 && <span className="opacity-50">· {visibleCount}</span>}
        </p>
      </div>

      {/* List */}
      {loading ? (
        <div className="py-4 flex justify-center">
          <Loader2 size={13} className="animate-spin"
            style={{ color: isDark ? 'rgba(255,255,255,0.2)' : 'var(--color-text-faint)' }} />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-[11px] py-2"
          style={{ color: isDark ? 'rgba(255,255,255,0.25)' : 'var(--color-text-faint)' }}>
          No comments yet. Start the conversation — type @ to tag a teammate.
        </p>
      ) : (
        <div className="space-y-2.5">
          {comments.map(c => (
            <CommentRow
              key={c.id}
              comment={c}
              users={users}
              variant={variant}
              depth={0}
              onReplyAdded={load}
              onEditAdded={load}
              onDeleted={load}
            />
          ))}
        </div>
      )}

      {/* Top-level composer */}
      <Composer
        users={users}
        placeholder="Add a comment… type @ to mention. ⌘/Ctrl+Enter to send."
        submitLabel="Comment"
        onSubmit={submitTopLevel}
        variant={variant}
      />
    </div>
  )
}
