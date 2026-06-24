'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Send, Loader2, MessageSquare, Hash, Trash2, ChevronLeft, Megaphone,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { sectionMeta, SECTION_ORDER } from '@/lib/production/capture-config'
import { HubHeader } from '@/components/supervisor/HubTabs'
import {
  GENERAL, loadThread, loadLatestPerChannel, sendMessage, deleteMessage,
  getSeen, markSeen, type LineMessage, type ChannelLatest,
} from '@/lib/production/messages'

const CHANNELS = [{ key: GENERAL, label: 'All lines' }, ...SECTION_ORDER.map(s => ({ key: s, label: sectionMeta(s).name }))]

function timeAgo(s: string) {
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  return `${Math.floor(m / 1440)}d ago`
}

export default function SupervisorMessages() {
  const { user, displayName, role, department } = useAuth()
  const myRole = role ? role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : (department ?? null)

  const [channel, setChannel]   = useState<string>(GENERAL)
  const [messages, setMessages] = useState<LineMessage[]>([])
  const [latest, setLatest]     = useState<Map<string, ChannelLatest>>(new Map())
  const [seen, setSeen]         = useState<Record<string, string>>({})
  const [loading, setLoading]   = useState(true)
  const [draft, setDraft]       = useState('')
  const [posting, setPosting]   = useState(false)
  const [showThreadMobile, setShowThreadMobile] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)

  // Seed last-seen for every channel once.
  useEffect(() => {
    const s: Record<string, string> = {}
    CHANNELS.forEach(c => { s[c.key] = getSeen(c.key) })
    setSeen(s)
  }, [])

  async function refreshLatest() {
    try { setLatest(await loadLatestPerChannel()) } catch { /* table may not exist yet */ }
  }

  async function refreshThread(ch: string) {
    try {
      const msgs = await loadThread(ch)
      setMessages(msgs)
      const newest = msgs[msgs.length - 1]?.created_at
      if (newest) { markSeen(ch, newest); setSeen(s => ({ ...s, [ch]: newest })) }
    } catch { setMessages([]) }
  }

  // Initial + on channel change.
  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([refreshThread(channel), refreshLatest()]).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])

  // Poll every 15s.
  useEffect(() => {
    const t = setInterval(() => { refreshThread(channel); refreshLatest() }, 15_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])

  // Keep scrolled to newest.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [messages.length])

  async function submit() {
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    try {
      const msg = await sendMessage({ channel, body, authorId: user?.id ?? null, authorName: displayName || 'Unknown', authorRole: myRole })
      if (msg) { setMessages(m => [...m, msg]); setDraft(''); refreshLatest() }
    } finally { setPosting(false) }
  }

  async function remove(id: string) {
    setMessages(m => m.filter(x => x.id !== id))
    try { await deleteMessage(id) } catch { /* ignore */ }
    refreshLatest()
  }

  const unread = useMemo(() => {
    const u: Record<string, boolean> = {}
    CHANNELS.forEach(c => { const l = latest.get(c.key); u[c.key] = !!(l && l.created_at > (seen[c.key] ?? '')) })
    return u
  }, [latest, seen])

  function openChannel(k: string) { setChannel(k); setShowThreadMobile(true) }

  return (
    <div className="px-4 py-6 max-w-[1100px] mx-auto space-y-5">
      <HubHeader subtitle="Per-line messages between supervisors and the floor" />

      <div className="flex gap-4 h-[calc(100vh-280px)] min-h-[440px]">
        {/* Channel list */}
        <div className={`${showThreadMobile ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-64 shrink-0 bg-surface-card border border-surface-rule rounded-2xl overflow-hidden`}>
          <div className="px-4 py-3 border-b border-surface-rule font-mono text-[10px] text-text-muted uppercase tracking-wide">Channels</div>
          <div className="flex-1 overflow-y-auto">
            {CHANNELS.map(c => {
              const active = c.key === channel
              const l = latest.get(c.key)
              const m = c.key === GENERAL ? null : sectionMeta(c.key)
              return (
                <button key={c.key} onClick={() => openChannel(c.key)}
                  className={`w-full flex items-center gap-2.5 px-4 py-3 text-left border-l-2 transition-colors ${active ? 'border-brand bg-brand/5' : 'border-transparent hover:bg-surface'}`}>
                  {m ? (
                    <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
                      <span className="font-mono font-bold text-[8px] text-white">{m.code}</span>
                    </span>
                  ) : (
                    <span className="w-6 h-6 rounded-md bg-stone-700 flex items-center justify-center shrink-0"><Megaphone size={12} className="text-white" /></span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] font-medium truncate ${active ? 'text-brand' : 'text-text'}`}>{c.label}</div>
                    {l && <div className="text-[11px] text-text-muted truncate">{l.author_name.split(' ')[0]}: {l.body}</div>}
                  </div>
                  {unread[c.key] && !active && <span className="w-2 h-2 rounded-full bg-brand shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>

        {/* Thread */}
        <div className={`${showThreadMobile ? 'flex' : 'hidden'} md:flex flex-col flex-1 bg-surface-card border border-surface-rule rounded-2xl overflow-hidden`}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-rule">
            <button onClick={() => setShowThreadMobile(false)} className="md:hidden text-stone-400 hover:text-text"><ChevronLeft size={16} /></button>
            <Hash size={14} className="text-text-muted" />
            <span className="font-display font-semibold text-[14px] text-text">{CHANNELS.find(c => c.key === channel)?.label}</span>
            <span className="text-[11px] text-text-muted">· {messages.length} message{messages.length !== 1 ? 's' : ''}</span>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center h-full"><Loader2 size={20} className="animate-spin text-stone-300" /></div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <MessageSquare size={26} className="text-stone-200 mb-2" />
                <p className="text-[12px] text-stone-400">No messages yet on this line</p>
                <p className="text-[11px] text-stone-400 mt-0.5">Leave a note or update for the next shift.</p>
              </div>
            ) : messages.map(msg => {
              const mine = (msg.author_id && msg.author_id === user?.id) || msg.author_name === displayName
              return (
                <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`group max-w-[78%] rounded-2xl px-3 py-2 ${mine ? 'bg-brand text-white rounded-br-sm' : 'bg-surface-raised text-text border border-surface-rule rounded-bl-sm'}`}>
                    {!mine && (
                      <div className="text-[11px] font-semibold text-brand mb-0.5">
                        {msg.author_name}{msg.author_role && <span className="font-normal text-text-muted"> · {msg.author_role}</span>}
                      </div>
                    )}
                    <div className="text-[13px] whitespace-pre-wrap break-words leading-relaxed">{msg.body}</div>
                    <div className={`flex items-center gap-2 text-[10px] mt-1 ${mine ? 'text-white/60 justify-end' : 'text-text-faint'}`}>
                      {timeAgo(msg.created_at)}
                      {mine && (
                        <button onClick={() => remove(msg.id)} className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-white" title="Delete">
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Composer */}
          <div className="border-t border-surface-rule p-3 flex items-end gap-2">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              rows={1}
              placeholder={`Message ${CHANNELS.find(c => c.key === channel)?.label}…`}
              className="flex-1 min-h-[44px] max-h-32 px-3 py-2.5 rounded-xl text-[13px] bg-surface border border-surface-rule text-text outline-none focus:border-brand resize-none"
            />
            <button onClick={submit} disabled={!draft.trim() || posting}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-brand text-white disabled:opacity-40">
              {posting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
