'use client'

// app/(app)/maintenance/job-cards/[cardId]/page.tsx
// Full job-card detail: the role-appropriate JobCardItem plus a WhatsApp-style
// JobCardChat. The chat backend is another workstream — for Phase 2 posting is
// wired to the existing job_card_logs comment flow (via addLog), and messages
// are derived from the card's comment log. Photo attachments are stubbed.

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useMaintenanceContext } from '../../layout'
import { deriveMaintRole } from '@/lib/maintenance/roles'
import { JobCardItem } from '@/components/maintenance/JobCardItem'
import { JobCardChat } from '@/components/maintenance/JobCardChat'
import type { ChatMessage } from '@/lib/maintenance/types'

export default function JobCardDetailPage() {
  const params = useParams()
  const auth = useAuth()
  const role = deriveMaintRole(auth)
  const { loading, data, derived, actions, actor } = useMaintenanceContext()

  const cardId = Number(Array.isArray(params.cardId) ? params.cardId[0] : params.cardId)
  const card = data.jcs.find(j => j.id === cardId)

  const cardRoles = { canManage: role.canManage, isTech: role.isTech, isQc: role.isQc, isRaiser: role.isRaiser }

  // Derive chat messages from the card's comment log (placeholder backend).
  const messages: ChatMessage[] = derived.cardLogs(cardId)
    .filter(l => l.kind === 'comment')
    .map(l => ({
      id: l.id,
      card_id: l.card_id,
      author_id: null,
      author_name: l.author,
      body: l.body,
      mentions: [],
      attachments: [],
      created_at: l.created_at,
    }))

  async function onSend(text: string) {
    if (!card) return
    await actions.addLog(card.id, 'comment', card.status, actor || 'Unknown', text)
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
    <div className="p-4 sm:p-6 max-w-[900px] mx-auto">
      <Link href="/maintenance/job-cards" className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text mb-4"><ArrowLeft size={15} /> Back to job cards</Link>

      <JobCardItem j={card} roles={cardRoles} />

      <div className="card p-4 mt-4 h-[520px] flex flex-col">
        <JobCardChat
          cardId={card.id}
          messages={messages}
          staff={[]}
          me={actor}
          onSend={onSend}
        />
      </div>
    </div>
  )
}
