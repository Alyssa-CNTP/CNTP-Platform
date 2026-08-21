'use client'

import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Undo2, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { sectionMeta } from '@/lib/production/capture-config'

// "A supervisor asked to reopen this production order" — the decision queue.
// This used to live inline on /supervisor/productions, which was otherwise a
// duplicate of /production/orders; the list moved there and this decision panel
// moved to the Sign-off tab, where everything awaiting a signature now lives.
// Extracted as a component so the request side (a button on Production Orders)
// and the decide side (here) share one shape for the same record.

export interface ReopenReq {
  id: string; session_id: string; section_id: string; date: string; shift: string
  requested_by_name: string | null; reason: string; status: string; created_at: string
}

export function ReopenRequestsPanel({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const { p, isFullAdmin, displayName } = useAuth()
  const canDecide = isFullAdmin || p('can_approve_reopen_request')

  const [reqs, setReqs] = useState<ReopenReq[]>([])
  const [loading, setLoading] = useState(true)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    // Archiving a session auto-declines any pending request against it, but a
    // request created before that guard existed can still be sitting here
    // pointing at a record that's gone from every other queue — filter those
    // out defensively rather than trust the auto-decline alone.
    const { data } = await getDb().schema('production').from('po_reopen_requests')
      .select('id,session_id,section_id,date,shift,requested_by_name,reason,status,created_at,prod_sessions(deleted_at)')
      .eq('status', 'pending').order('created_at', { ascending: true })
    const rows = ((data as (ReopenReq & { prod_sessions: { deleted_at: string | null } | null })[]) ?? [])
      .filter(r => !r.prod_sessions?.deleted_at)
    setReqs(rows)
    onCountChange?.(rows.length)
    setLoading(false)
  }
  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(req: ReopenReq, decision: 'approved' | 'rejected') {
    setDecidingId(req.id); setError(null)
    try {
      const res = await fetch(`/api/production/orders/${req.session_id}/reopen-request`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: req.id, decision, decidedByName: displayName }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Error ${res.status}`)
      setReqs(rs => {
        const next = rs.filter(r => r.id !== req.id)
        onCountChange?.(next.length)
        return next
      })
    } catch (e: any) {
      setError(e.message)
    }
    setDecidingId(null)
  }

  // Only the deciding tier sees this queue at all — a supervisor requesting a
  // reopen has nothing to act on here.
  if (!canDecide || loading || reqs.length === 0) return null

  return (
    <div className="bg-warn/5 border border-warn/30 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-warn/20">
        <span className="w-6 h-6 rounded-full bg-warn text-white flex items-center justify-center font-display font-bold text-[12px] shrink-0">{reqs.length}</span>
        <Undo2 size={15} className="text-warn" />
        <span className="font-body font-semibold text-[14px] text-warn">Reopen requests awaiting your decision</span>
      </div>
      {error && <p className="px-4 pt-2 text-[12px] text-err flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
      <div className="divide-y divide-warn/15">
        {reqs.map(req => {
          const m = sectionMeta(req.section_id)
          const busy = decidingId === req.id
          return (
            <div key={req.id} className="flex items-start gap-3 px-4 py-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: m.colorHex }}>
                <span className="font-mono font-bold text-[9px] text-white">{m.code}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-text">
                  <span className="font-semibold">{req.requested_by_name || 'A supervisor'}</span> asked to reopen{' '}
                  <span className="font-semibold">{m.name}</span> · {format(parseISO(req.date + 'T12:00:00'), 'EEE d MMM')} · <span className="capitalize">{req.shift}</span>
                </div>
                <div className="text-[12px] text-text-muted mt-0.5">“{req.reason}”</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => decide(req, 'rejected')} disabled={busy}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-stone-200 text-[12px] text-stone-600 hover:border-err hover:text-err disabled:opacity-40 transition-colors">
                  <XCircle size={13} /> Decline
                </button>
                <button onClick={() => decide(req, 'approved')} disabled={busy}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-ok text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-40 transition-colors">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Approve
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
