'use client'

// components/maintenance/JobCardChat.tsx
// WhatsApp-style job-card chat thread, forked from components/axis/CommentThread.tsx.
// Two-sided bubbles, @-mention autocomplete against the maintenance staff
// directory, and camera + gallery photo buttons. The chat backend is another
// workstream; for Phase 2 onAttach is optional/stubbed and posting can be wired
// to the existing comment log by the caller.

import { useEffect, useRef, useState } from 'react'
import { Send, AtSign, Camera, Image as ImageIcon, Loader2 } from 'lucide-react'
import { Avatar } from '@/components/axis/Avatar'
import { TECHS } from '@/lib/maintenance/constants'
import { downscalePhoto } from '@/lib/maintenance/helpers'
import type { ChatMessage } from '@/lib/maintenance/types'

interface Staff { id: string; name: string; initials: string }

interface Props {
  cardId: number
  messages: ChatMessage[]
  staff: Staff[]
  me: string
  onSend: (text: string, mentions: string[]) => Promise<void>
  onAttach?: (file: File) => Promise<{ path: string; url: string }>
}

function timeAgo(s: string) {
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  return `${Math.floor(m / 1440)}d ago`
}

// Fallback staff list from the hardcoded TECHS if the directory call fails.
function fallbackStaff(): Staff[] {
  return TECHS.map(name => ({
    id: name,
    name,
    initials: name.split(/[\s_-]/).map(n => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?',
  }))
}

export function JobCardChat({ cardId, messages, staff: staffProp, me, onSend, onAttach }: Props) {
  const [staff, setStaff] = useState<Staff[]>(staffProp.length ? staffProp : fallbackStaff())
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  // Mention autocomplete
  const [acOpen, setAcOpen] = useState(false)
  const [acQuery, setAcQuery] = useState('')
  const [acIndex, setAcIndex] = useState(0)
  const [acStart, setAcStart] = useState<number | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Pull the live staff directory; fall back to TECHS names on failure.
  useEffect(() => {
    if (staffProp.length) return
    let cancelled = false
    fetch('/api/maintenance/staff')
      .then(r => (r.ok ? r.json() : []))
      .then((rows: any[]) => {
        if (cancelled) return
        const mapped = Array.isArray(rows)
          ? rows.map(r => ({ id: r.id, name: r.name, initials: r.initials }))
          : []
        if (mapped.length) setStaff(mapped)
      })
      .catch(() => { /* keep fallback */ })
    return () => { cancelled = true }
  }, [staffProp.length])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length])

  const matched = acOpen
    ? staff.filter(s => s.name.toLowerCase().includes(acQuery.toLowerCase())).slice(0, 6)
    : []

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setDraft(value)
    const caret = e.target.selectionStart ?? value.length
    const before = value.slice(0, caret)
    const at = before.lastIndexOf('@')
    if (at < 0) { setAcOpen(false); return }
    const between = before.slice(at + 1)
    if (/\n/.test(between) || between.length > 24) { setAcOpen(false); return }
    setAcStart(at); setAcQuery(between); setAcIndex(0); setAcOpen(true)
  }

  function applyMention(s: Staff) {
    if (acStart === null) return
    const before = draft.slice(0, acStart)
    const after = draft.slice(acStart + 1 + acQuery.length)
    const next = `${before}@${s.name} ${after}`
    setDraft(next)
    setAcOpen(false); setAcStart(null); setAcQuery('')
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      const pos = before.length + 1 + s.name.length + 1
      inputRef.current?.setSelectionRange(pos, pos)
    })
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (acOpen && matched.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIndex(i => Math.min(matched.length - 1, i + 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAcIndex(i => Math.max(0, i - 1)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyMention(matched[acIndex]); return }
      if (e.key === 'Escape') { e.preventDefault(); setAcOpen(false); return }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() }
  }

  // Extract @mentions that match a known staff name.
  function extractMentions(text: string): string[] {
    return staff.filter(s => text.includes('@' + s.name)).map(s => s.id)
  }

  async function submit() {
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    try {
      await onSend(body, extractMentions(body))
      setDraft('')
      setPreview(null)
    } finally {
      setPosting(false)
    }
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const url = await downscalePhoto(f)
      setPreview(url)
    } catch { /* ignore */ }
    if (onAttach) { try { await onAttach(f) } catch { /* stubbed for Phase 2 */ } }
    e.target.value = ''
  }

  function renderBody(body: string) {
    if (!staff.length) return body
    const sorted = [...staff].sort((a, b) => b.name.length - a.name.length)
    const escaped = sorted.map(s => s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const re = new RegExp(`@(${escaped.join('|')})`, 'g')
    const parts: React.ReactNode[] = []
    let last = 0, k = 0, match: RegExpExecArray | null
    while ((match = re.exec(body)) !== null) {
      if (match.index > last) parts.push(body.slice(last, match.index))
      parts.push(<span key={k++} className="font-semibold text-accent">@{match[1]}</span>)
      last = match.index + match[0].length
    }
    if (last < body.length) parts.push(body.slice(last))
    return parts
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2">
        <AtSign size={12} className="text-text-muted" />
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] font-semibold text-text-muted">
          Job Card Chat {messages.length > 0 && <span className="opacity-50">· {messages.length}</span>}
        </p>
      </div>

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2 pr-1">
        {messages.length === 0 && (
          <p className="text-[12px] text-text-faint py-2">No messages yet. Type @ to tag a teammate.</p>
        )}
        {messages.map(m => {
          const mine = m.author_name === me
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
              {!mine && <Avatar initials={(m.author_name.split(/\s+/).map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2)) || '?'} userId={m.author_id ?? m.author_name} size={26} title={m.author_name} />}
              <div className={`max-w-[78%] rounded-2xl px-3 py-2 ${mine ? 'bg-brand text-white rounded-br-sm' : 'bg-surface-raised text-text border border-surface-rule rounded-bl-sm'}`}>
                {!mine && <div className="text-[11px] font-semibold text-accent mb-0.5">{m.author_name}</div>}
                <div className="text-[13px] whitespace-pre-wrap break-words leading-relaxed">{renderBody(m.body)}</div>
                {m.attachments?.map((a, i) => (
                  a.url ? <img key={i} src={a.url} className="mt-1.5 rounded-lg max-h-40" alt={a.name} /> : null
                ))}
                <div className={`text-[10px] mt-1 ${mine ? 'text-white/60' : 'text-text-faint'}`}>{timeAgo(m.created_at)}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Composer — pinned bottom, large tap targets */}
      <div className="relative mt-2 pt-2 border-t border-surface-rule safe-bottom">
        {preview && (
          <div className="mb-2 relative inline-block">
            <img src={preview} className="rounded-lg max-h-28" alt="preview" />
            <button onClick={() => setPreview(null)} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-err text-white text-xs font-bold">✕</button>
          </div>
        )}

        {acOpen && matched.length > 0 && (
          <div className="absolute bottom-full mb-1 w-64 rounded-xl shadow-lg overflow-hidden bg-surface-card border border-surface-rule z-10">
            <p className="px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-text-muted border-b border-surface-rule">Mention</p>
            {matched.map((s, i) => (
              <button key={s.id} type="button" onClick={() => applyMention(s)} onMouseEnter={() => setAcIndex(i)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left ${i === acIndex ? 'bg-surface-raised' : ''}`}>
                <Avatar initials={s.initials} userId={s.id} size={22} />
                <span className="text-[13px] text-text truncate">{s.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1.5">
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickPhoto} />
          <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
          <button onClick={() => cameraRef.current?.click()} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-surface-dim text-text-muted hover:bg-surface-rule" title="Camera">
            <Camera size={18} />
          </button>
          <button onClick={() => galleryRef.current?.click()} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-surface-dim text-text-muted hover:bg-surface-rule" title="Gallery">
            <ImageIcon size={18} />
          </button>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={onChange}
            onKeyDown={onKey}
            rows={1}
            placeholder="Message… type @ to mention"
            className="flex-1 min-h-[44px] px-3 py-2.5 rounded-xl text-[13px] bg-surface border border-surface-rule text-text outline-none focus:border-brand resize-none"
          />
          <button onClick={submit} disabled={!draft.trim() || posting}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-brand text-white disabled:opacity-40">
            {posting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  )
}
