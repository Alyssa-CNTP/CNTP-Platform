'use client'

// app/(app)/maintenance/job-cards/[cardId]/page.tsx
// Full job-card detail: the role-appropriate JobCardItem plus a WhatsApp-style
// JobCardChat wired to the real chat backend (card-messages API). Messages,
// @mentions and photo attachments all go through the server routes; the
// comment-log Activity panel inside JobCardItem stays separate.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useMaintenanceContext } from '../../layout'
import { deriveMaintRole } from '@/lib/maintenance/roles'
import { JobCardItem } from '@/components/maintenance/JobCardItem'
import { JobCardChat, type ChatAttachment } from '@/components/maintenance/JobCardChat'
import type { ChatMessage } from '@/lib/maintenance/types'

export default function JobCardDetailPage() {
  const params = useParams()
  const auth = useAuth()
  const role = deriveMaintRole(auth)
  const { loading, data, actor } = useMaintenanceContext()

  const cardId = Number(Array.isArray(params.cardId) ? params.cardId[0] : params.cardId)
  const card = data.jcs.find(j => j.id === cardId)
  const me = actor || auth.displayName

  const cardRoles = { canManage: role.canManage, isTech: role.isTech, isQc: role.isQc, isRaiser: role.isRaiser }

  // ── Real chat backend ──
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const loadMessages = useCallback(async () => {
    if (!cardId) return
    try {
      const r = await fetch(`/api/maintenance/card-messages?card_id=${cardId}`)
      if (!r.ok) return
      const j = await r.json()
      setMessages(Array.isArray(j.messages) ? j.messages : [])
    } catch { /* leave as-is */ }
  }, [cardId])

  useEffect(() => { loadMessages() }, [loadMessages])

  async function onSend(text: string, mentions: string[], attachments: ChatAttachment[]) {
    if (!cardId) return
    const r = await fetch('/api/maintenance/card-messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_id: cardId, body: text, mentions,
        attachments: attachments.map(a => ({ path: a.path, name: a.name, size: a.size, mime: a.mime })),
        author_name: me,
      }),
    })
    if (r.ok) await loadMessages()
  }

  async function onAttach(file: File): Promise<ChatAttachment | null> {
    if (!cardId) return null
    const fd = new FormData()
    fd.append('file', file)
    fd.append('card_id', String(cardId))
    const r = await fetch('/api/maintenance/card-messages/upload', { method: 'POST', body: fd })
    if (!r.ok) return null
    const j = await r.json()
    return { path: j.path, name: j.name, size: j.size, mime: j.mime, url: j.url }
  }

  if (loading) {
    return <div className="p-4 sm:p-6 max-w-[900px] mx-auto"><div className="card p-6 text-text-muted text-sm">Loading…</div></div>
  }

  if (!card) {
    return (
      <div className="p-4 sm:p-6 max-w-[900px] mx-auto">
        <Link href="/maintenance/job-cards" className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text mb-4"><ArrowLeft size={15} /> Back to job cards</Link>
        <div className="card p-6 text-center text-text-faint text-sm">Job card not found.</div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-[900px] mx-auto space-y-4">
      <div>
        <Link href="/maintenance/job-cards" className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text transition"><ArrowLeft size={15} /> Back to job cards</Link>
        <h1 className="text-2xl font-semibold text-text mt-2">{card.card_no}</h1>
        <p className="text-sm text-text-muted mt-0.5">{card.area}{card.machine ? ' · ' + card.machine : ''} — raised by {card.raised_by}</p>
      </div>

      <JobCardItem j={card} roles={cardRoles} />

      <div className="rounded-xl border border-surface-rule bg-surface-card shadow-sm p-4 h-[520px] flex flex-col">
        <JobCardChat
          cardId={card.id}
          messages={messages}
          staff={data.staff.map(s => ({ id: s.id, name: s.name, initials: s.initials }))}
          me={me}
          onSend={onSend}
          onAttach={onAttach}
        />
      </div>
    </div>
  )
}
