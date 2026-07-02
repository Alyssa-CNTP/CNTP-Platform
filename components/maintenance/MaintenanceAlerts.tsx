'use client'

// components/maintenance/MaintenanceAlerts.tsx
// Live on-screen alerts for the maintenance module, mounted once in the
// maintenance layout so they surface across every /maintenance/* route while the
// app is open. There is no realtime/web-push infrastructure in the app, so this
// polls job_cards on a short interval and raises pop-ups:
//
//  • Technician — when a breakdown is auto-assigned to them (assigned_user_id ===
//    their user id) and not yet accepted, a blocking modal appears: Accept the
//    job card, or leave a first comment.
//  • Maintenance manager — a modal lists job cards awaiting allocation, and a
//    toast fires the moment a technician accepts a breakdown, so the manager can
//    track acceptance and manage urgent work.
//
// Closed-tab delivery still relies on the existing email / WhatsApp channels
// (notify()); this component covers "app open (even if idle on another tab)".

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, X } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { deriveMaintRole } from '@/lib/maintenance/roles'
import { useToast } from '@/components/ui/Toast'
import { fmtDT } from '@/lib/maintenance/helpers'
import type { JobCard } from '@/lib/maintenance/types'

const POLL_MS = 10_000

// Props are passed from the maintenance layout (which owns the shared data) so
// this component doesn't import the layout back — avoids a circular dependency.
export function MaintenanceAlerts({ actions, actor, reload }: {
  actions: { acceptJob: (j: JobCard) => Promise<void>; addLog: (cardId: number, kind: 'comment' | 'event', stage: string, author: string, body: string) => Promise<void> }
  actor: string
  reload: () => void
}) {
  const auth = useAuth()
  const userId = auth.userId
  const canManage = deriveMaintRole(auth).canManage
  const toast = useToast()
  const db = getDb()

  // Latest poll snapshot + what we've already seen (for transition detection).
  const [cards, setCards] = useState<JobCard[]>([])
  const seen = useRef<Map<number, { status: string; accepted: boolean }>>(new Map())
  const inited = useRef(false)

  // Per-session dismissals so we don't re-nag once acknowledged.
  const [techDismissed, setTechDismissed] = useState<number[]>([])
  const [allocDismissed, setAllocDismissed] = useState<number[]>([])

  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!userId) return
    let alive = true
    async function poll() {
      const { data, error } = await db.schema('maintenance').from('job_cards')
        .select('*').order('raised_at', { ascending: false }).limit(150)
      if (!alive || error || !data) return
      const rows = data as JobCard[]
      const firstRun = !inited.current
      let sawNew = false

      // Manager: toast when a technician accepts a breakdown (transition null→set).
      for (const c of rows) {
        const prev = seen.current.get(c.id)
        if (!prev) sawNew = true
        if (canManage && !firstRun && prev && !prev.accepted && !!c.accepted_at && c.assigned_to) {
          toast(`${c.assigned_to} accepted ${c.card_no} — ${c.area}`, 'success')
        }
      }

      const m = new Map<number, { status: string; accepted: boolean }>()
      for (const c of rows) m.set(c.id, { status: c.status, accepted: !!c.accepted_at })
      seen.current = m
      inited.current = true
      setCards(rows)
      // Pull the shared board/context up to date when something new landed.
      if (!firstRun && sawNew) reload()
    }
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [userId, canManage]) // eslint-disable-line react-hooks/exhaustive-deps

  // A job card allocated to me (breakdown or planned) that I have not yet
  // accepted — the pop-up follows the allocation, never the raiser.
  const myCard = userId
    ? cards.find(c => c.assigned_user_id === userId
        && c.status === 'assigned' && !c.accepted_at && !techDismissed.includes(c.id)) ?? null
    : null
  const myIsBd = myCard?.workflow === 'breakdown'

  // Manager: job cards awaiting allocation (freshly raised, undismissed).
  const pendingAlloc = canManage
    ? cards.filter(c => c.status === 'raised' && !allocDismissed.includes(c.id))
    : []

  async function acceptFromModal(card: JobCard) {
    setBusy(true)
    try {
      const note = comment.trim()
      if (note) await actions.addLog(card.id, 'comment', card.status, actor || card.assigned_to || 'Technician', note)
      await actions.acceptJob(card)
      setTechDismissed(d => [...d, card.id])
      setComment('')
    } finally { setBusy(false) }
  }

  async function commentFromModal(card: JobCard) {
    const note = comment.trim()
    if (!note) return
    setBusy(true)
    try {
      await actions.addLog(card.id, 'comment', card.status, actor || card.assigned_to || 'Technician', note)
      setTechDismissed(d => [...d, card.id])
      setComment('')
    } finally { setBusy(false) }
  }

  return (
    <>
      {/* ── Technician: job card allocated to me — accept or comment ── */}
      {myCard && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="card w-[460px] max-w-full overflow-hidden">
            <div className={`${myIsBd ? 'bg-err' : 'bg-brand'} text-white px-5 py-3 flex items-center gap-2`}>
              <AlertTriangle className={`w-5 h-5 shrink-0 ${myIsBd ? 'animate-pulse' : ''}`} />
              <div className="font-semibold text-sm">{myIsBd ? 'Breakdown' : 'Job card'} assigned to you — {myCard.card_no}</div>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-[13px] text-text">
                <span className="font-semibold">{myCard.area}</span>{myCard.machine ? ' · ' + myCard.machine : ''}
                <span className="text-text-faint"> · raised {fmtDT(myCard.raised_at)} by {myCard.raised_by}</span>
              </div>
              <div className="text-[13px] text-text-muted whitespace-pre-wrap">{myCard.description}</div>
              <div className={`rounded-lg px-3 py-2 text-[11px] ${myIsBd ? 'bg-err/5 border border-err/20 text-err' : 'bg-brand/5 border border-brand/20 text-brand'}`}>
                {myIsBd
                  ? 'The timer is already running (breakdowns time from when they are raised). Attend on-site, then accept or reply here.'
                  : 'You have been allocated this job card. Accept it here, or leave a first comment for the manager.'}
              </div>
              <textarea className="w-full rounded-lg border border-surface-rule bg-surface-card px-3 py-2 text-[13px] min-h-[60px]"
                placeholder="First comment (optional) — e.g. on my way, or a question for the manager…"
                value={comment} onChange={e => setComment(e.target.value)} />
              <div className="flex gap-2 flex-wrap">
                <button disabled={busy} onClick={() => acceptFromModal(myCard)}
                  className="flex-1 bg-brand text-white rounded-lg px-4 py-2.5 text-sm font-semibold min-h-[44px] hover:brightness-110 transition disabled:opacity-50">
                  {myIsBd ? 'Accept & attend' : 'Accept job card'}
                </button>
                <button disabled={busy || !comment.trim()} onClick={() => commentFromModal(myCard)}
                  className="border border-surface-rule bg-surface-card text-text rounded-lg px-4 py-2.5 text-sm font-semibold min-h-[44px] hover:border-text/30 transition disabled:opacity-40">
                  Reply first
                </button>
                <Link href={`/maintenance/job-cards/${myCard.id}`} onClick={() => setTechDismissed(d => [...d, myCard.id])}
                  className="inline-flex items-center justify-center border border-surface-rule bg-surface-card text-text-muted rounded-lg px-3 py-2.5 text-[12px] font-semibold min-h-[44px] hover:border-text/30 transition">
                  Open card
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Manager: job cards awaiting allocation ── */}
      {!myCard && pendingAlloc.length > 0 && (
        <div className="fixed bottom-5 right-5 z-[1000] w-[360px] max-w-[92vw]">
          <div className="card overflow-hidden shadow-menu border border-warn/30">
            <div className="bg-warn/10 text-text px-4 py-2.5 flex items-center gap-2">
              <span className="relative inline-flex items-center justify-center w-7 h-7 rounded-lg bg-warn/20 text-warn shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </span>
              <div className="flex-1 text-sm font-semibold">{pendingAlloc.length} job card{pendingAlloc.length > 1 ? 's' : ''} to allocate</div>
              <button onClick={() => setAllocDismissed(d => [...d, ...pendingAlloc.map(c => c.id)])}
                className="text-text-muted hover:text-text transition" title="Dismiss"><X size={16} /></button>
            </div>
            <div className="p-3 space-y-1.5 max-h-[180px] overflow-y-auto">
              {pendingAlloc.slice(0, 5).map(c => (
                <div key={c.id} className="text-[12px] text-text-muted">
                  <span className={`badge ${c.workflow === 'breakdown' ? 'badge-err' : 'badge-info'} mr-1`}>{c.workflow === 'breakdown' ? 'BD' : 'PL'}</span>
                  <strong className="text-text">{c.card_no}</strong> · {c.area} — {c.description}
                </div>
              ))}
              {pendingAlloc.length > 5 && <div className="text-[11px] text-text-faint">+{pendingAlloc.length - 5} more</div>}
            </div>
            <Link href="/maintenance/job-cards" onClick={() => setAllocDismissed(d => [...d, ...pendingAlloc.map(c => c.id)])}
              className="block bg-brand text-white text-center text-sm font-semibold py-2.5 hover:brightness-110 transition">
              Allocate now →
            </Link>
          </div>
        </div>
      )}
    </>
  )
}
