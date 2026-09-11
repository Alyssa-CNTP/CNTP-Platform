'use client'

// components/layout/WorkRequestPopup.tsx
// A request for someone to go and DO something, put on the screen they are
// already working at and left there until they deal with it.
//
// The notification bell already toasts on arrival, but a toast clears itself
// after six seconds — fine for "your job card was signed off", useless for "a
// machine is waiting for your QC check". If nobody happened to be looking at
// the screen in those six seconds the request is gone, and the only trace is a
// number on a bell nobody has a reason to open.
//
// So this handles the small set of notification kinds that are WORK, not news:
//
//   • it loads unread ones on mount, not just live inserts, so a request raised
//     while the lab was away from the bench still appears when they come back;
//   • it stays up until the person opens it or explicitly defers it;
//   • deferring hides it for this browser session only and leaves it UNREAD, so
//     it cannot be quietly lost — it returns on the next visit and the bell
//     still counts it.
//
// Kinds not listed here are news and keep the bell's existing toast.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, X } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'

interface Note {
  id: string; kind: string | null; title: string; body: string | null
  url: string | null; urgent: boolean; read_at: string | null; created_at: string
}

/** Notification kinds that are a request to go and do something. */
export const WORK_REQUEST_KINDS = ['qc_check'] as const
const isWorkRequest = (kind: string | null) =>
  !!kind && (WORK_REQUEST_KINDS as readonly string[]).includes(kind)

/** Deferred for this browser session only — never persisted to the row. */
const DEFER_KEY = 'workRequest:deferred'
const readDeferred = (): string[] => {
  try { return JSON.parse(sessionStorage.getItem(DEFER_KEY) ?? '[]') } catch { return [] }
}
const defer = (id: string) => {
  try { sessionStorage.setItem(DEFER_KEY, JSON.stringify([...readDeferred(), id])) } catch { /* private mode */ }
}

export default function WorkRequestPopup() {
  const db = getDb()
  const router = useRouter()
  const { userId } = useAuth()

  const [queue, setQueue] = useState<Note[]>([])
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const add = useCallback((n: Note) => {
    if (!isWorkRequest(n.kind) || n.read_at) return
    if (readDeferred().includes(n.id)) return
    setQueue(prev => (prev.some(p => p.id === n.id) ? prev : [...prev, n]))
  }, [])

  // Anything still unread and unactioned when this screen loads.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      const { data } = await db.schema('shared').from('notifications')
        .select('id,kind,title,body,url,urgent,read_at,created_at')
        .eq('user_id', userId).is('read_at', null)
        .in('kind', WORK_REQUEST_KINDS as unknown as string[])
        .order('created_at', { ascending: true }).limit(10)
      if (!cancelled) ((data ?? []) as Note[]).forEach(n => add(n))
    })()
    return () => { cancelled = true }
  }, [db, userId, add])

  // And anything that arrives while they are standing at the screen.
  useEffect(() => {
    if (!userId) return
    const channel = db
      .channel(`work-requests:${userId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'shared', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload: any) => add(payload.new as Note))
      .subscribe()
    return () => { db.removeChannel(channel) }
  }, [db, userId, add])

  const current = queue[0]
  if (!mounted || !current) return null

  const dismiss = () => setQueue(q => q.slice(1))

  const open = async () => {
    // Opening it IS the acknowledgement — mark read so it stops asking.
    await db.schema('shared').from('notifications')
      .update({ read_at: new Date().toISOString() }).eq('id', current.id)
    window.dispatchEvent(new Event('notifications:refresh'))
    dismiss()
    if (current.url) router.push(current.url)
  }

  const later = () => { defer(current.id); dismiss() }

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-labelledby="work-request-title"
      className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/40"
    >
      <div className="w-full max-w-[420px] rounded-2xl bg-surface-card border border-surface-rule shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 p-4 border-b border-surface-rule">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-info/10 text-info shrink-0">
            <ClipboardCheck className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-text-muted">
              Waiting for you{queue.length > 1 ? ` · ${queue.length} requests` : ''}
            </div>
            <h2 id="work-request-title" className="text-[15px] font-semibold text-text mt-0.5 break-words">{current.title}</h2>
          </div>
          <button onClick={later} aria-label="Remind me later"
            className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-text-muted hover:bg-surface-dim hover:text-text transition">
            <X size={15} />
          </button>
        </div>

        {current.body && <p className="px-4 py-3 text-[13px] text-text-muted break-words">{current.body}</p>}

        <div className="flex gap-2 p-4 pt-1 flex-wrap">
          <button onClick={open}
            className="flex-1 min-w-[150px] bg-brand text-white rounded-lg px-4 py-2.5 text-sm font-semibold min-h-[44px] hover:brightness-110 transition">
            Open the job card
          </button>
          <button onClick={later}
            className="border border-surface-rule bg-surface-card text-text-muted rounded-lg px-4 py-2.5 text-sm font-semibold min-h-[44px] hover:border-text/25 transition">
            Not right now
          </button>
        </div>
        <p className="px-4 pb-3 -mt-1 text-[11px] text-text-faint">
          &ldquo;Not right now&rdquo; keeps it unread — it stays on the bell and comes back next time you open the app.
        </p>
      </div>
    </div>,
    document.body,
  )
}
