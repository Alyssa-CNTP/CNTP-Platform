'use client'

// Single-channel line chat — used in the operator capture screen (one section's
// channel) and reusable elsewhere. Shares the production.line_messages backend
// with the supervisor hub. Text-only, 15s polling, defensive if table absent.

import { useEffect, useRef, useState } from 'react'
import { Send, Loader2, MessageSquare, Trash2 } from 'lucide-react'
import { loadThread, sendMessage, deleteMessage, type LineMessage } from '@/lib/production/messages'

function timeAgo(s: string) {
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  return `${Math.floor(m / 1440)}d ago`
}

export function LineChat({ channel, meName, meId, meRole, title }: {
  channel: string
  meName: string
  meId: string | null
  meRole: string | null
  title?: string
}) {
  const [messages, setMessages] = useState<LineMessage[]>([])
  const [loading, setLoading]   = useState(true)
  const [draft, setDraft]       = useState('')
  const [posting, setPosting]   = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function refresh() {
    try { setMessages(await loadThread(channel)) } catch { setMessages([]) }
  }
  useEffect(() => {
    let alive = true
    setLoading(true)
    refresh().finally(() => { if (alive) setLoading(false) })
    const t = setInterval(refresh, 15_000)
    return () => { alive = false; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [messages.length])

  async function submit() {
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    try {
      const msg = await sendMessage({ channel, body, authorId: meId, authorName: meName || 'Operator', authorRole: meRole })
      if (msg) { setMessages(m => [...m, msg]); setDraft('') }
    } finally { setPosting(false) }
  }
  async function remove(id: string) {
    setMessages(m => m.filter(x => x.id !== id))
    try { await deleteMessage(id) } catch { /* ignore */ }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden flex flex-col h-[460px]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
        <MessageSquare size={14} className="text-text-muted" />
        <span className="font-semibold text-[13px] text-text">{title ?? 'Line messages'}</span>
        <span className="text-[11px] text-text-muted">· supervisors &amp; floor</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-full"><Loader2 size={18} className="animate-spin text-stone-300" /></div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare size={24} className="text-stone-200 mb-2" />
            <p className="text-[12px] text-stone-400">No messages on this line yet</p>
            <p className="text-[11px] text-stone-400 mt-0.5">Leave a note for your supervisor or the next shift.</p>
          </div>
        ) : messages.map(msg => {
          const mine = (msg.author_id && msg.author_id === meId) || msg.author_name === meName
          return (
            <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`group max-w-[80%] rounded-2xl px-3 py-2 ${mine ? 'bg-brand text-white rounded-br-sm' : 'bg-stone-50 text-text border border-stone-100 rounded-bl-sm'}`}>
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

      <div className="border-t border-stone-100 p-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          rows={1}
          placeholder="Message your supervisor…"
          className="flex-1 min-h-[44px] max-h-32 px-3 py-2.5 rounded-xl text-[13px] bg-surface border border-stone-200 text-text outline-none focus:border-brand resize-none"
        />
        <button onClick={submit} disabled={!draft.trim() || posting}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-brand text-white disabled:opacity-40">
          {posting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  )
}
