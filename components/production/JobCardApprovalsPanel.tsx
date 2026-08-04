'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Layers, ThumbsUp, ThumbsDown } from 'lucide-react'
import clsx from 'clsx'
import { getDb } from '@/lib/supabase/db'
import { getMySignatureStatus, type MySignatureStatus } from '@/lib/production/employee-signature'

// Shared "cards waiting on your approval" widget — originally built inline on
// /job-cards/pasteuriser, now also embedded on the Supervisor Hub landing tab
// so a supervisor sees (and can act on) pending job cards before they even
// get to assigning sections. One component, one query, no divergence risk
// between the two places it renders.

interface RatioLine { componentItemId: string; label: string; pct: number }

interface PendingCard {
  id: string
  job_card_no: string | null; item_no: string | null; product_name: string | null
  batch_number: string | null; customer: string | null; blend_description: string | null
  blend_ratio_lines: RatioLine[] | null; final_ratio_lines: RatioLine[] | null
  sent_for_approval_at: string | null
}

function RatioTable({ lines }: { lines: RatioLine[] }) {
  const total = lines.reduce((s, l) => s + l.pct, 0)
  const outOfRange = Math.abs(total - 100) > 1
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-surface-rule">
          {lines.map(l => (
            <tr key={l.componentItemId}>
              <td className="py-2 text-[13px] text-text">
                <span className="font-mono text-[11px] text-text-muted mr-1.5">{l.componentItemId}</span>{l.label}
              </td>
              <td className="py-1.5 pl-2 text-right font-mono text-[13px] text-text w-20">{l.pct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={clsx('font-mono text-[10px] mt-1 text-right', outOfRange ? 'text-warn' : 'text-text-faint')}>Total: {total.toFixed(1)}%</p>
    </div>
  )
}

export function JobCardApprovalsPanel({
  table = 'job_cards_pasteuriser',
  decideUrl = (id: string) => `/api/production/job-cards/${id}/decide`,
  showFinalRatio = true,
}: {
  table?: string
  decideUrl?: (id: string) => string
  showFinalRatio?: boolean
} = {}) {
  const db = getDb()
  const [cards, setCards] = useState<PendingCard[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function reload() {
    const cols = ['id', 'job_card_no', 'item_no', 'product_name', 'batch_number', 'customer', 'blend_description',
      'blend_ratio_lines', showFinalRatio ? 'final_ratio_lines' : null, 'sent_for_approval_at'].filter(Boolean).join(', ')
    const { data } = await db.from(table)
      .select(cols)
      .eq('status', 'sent_for_approval').order('sent_for_approval_at', { ascending: true })
    setCards((data as PendingCard[]) ?? [])
    setLoading(false)
  }
  useEffect(() => { reload() }, [table])

  async function decide(id: string, decision: 'approved' | 'rejected', extra: { reason?: string }) {
    const res = await fetch(decideUrl(id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, ...extra }),
    })
    if (res.ok) { setCards(cs => cs.filter(c => c.id !== id)); setExpanded(null) }
    else { const body = await res.json().catch(() => ({})); alert(body.error || 'Could not save decision') }
  }

  if (loading || cards.length === 0) return null

  return (
    <div className="card p-4 space-y-2 border-2 border-brand/30">
      <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5" /> Pending your approval ({cards.length})
      </p>
      {cards.map(c => (
        <PendingCardRow key={c.id} c={c} expanded={expanded === c.id}
          onToggle={() => setExpanded(expanded === c.id ? null : c.id)} onDecide={decide} />
      ))}
    </div>
  )
}

function PendingCardRow({ c, expanded, onToggle, onDecide }: {
  c: PendingCard; expanded: boolean; onToggle: () => void
  onDecide: (id: string, decision: 'approved' | 'rejected', extra: { reason?: string }) => Promise<void>
}) {
  const [status, setStatus] = useState<MySignatureStatus | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { getMySignatureStatus().then(setStatus) }, [])

  return (
    <div className="rounded-xl border border-surface-rule overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-surface-dim/40">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-text truncate">{c.product_name || c.item_no || 'Job card'}</div>
          <div className="text-[11px] text-text-muted font-mono truncate">{c.item_no} · batch {c.batch_number || '—'} · {c.customer || 'no customer'}</div>
        </div>
        <span className="text-[10px] text-text-faint shrink-0">{expanded ? 'Hide' : 'Review'}</span>
      </button>
      {expanded && (
        <div className="border-t border-surface-rule bg-surface-dim/20 p-3 space-y-3">
          {c.blend_ratio_lines?.length ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">Blend ratio (before granules) — {c.blend_description}</p>
              <RatioTable lines={c.blend_ratio_lines} />
            </div>
          ) : null}
          {c.final_ratio_lines?.length ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">Final product ratio</p>
              <RatioTable lines={c.final_ratio_lines} />
            </div>
          ) : null}

          {status && !status.hasSignature ? (
            <p className="text-[11px] text-warn">
              No signature on file — {status.employeeId
                ? <Link href={`/production/staff/${status.employeeId}`} className="underline">set one up on your Staff Directory profile</Link>
                : 'ask IT to link your login to your Staff Directory profile'} before you can approve.
            </p>
          ) : (
            <button disabled={!status?.hasSignature || busy}
              onClick={async () => { setBusy(true); await onDecide(c.id, 'approved', {}); setBusy(false) }}
              className={clsx('w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-1.5',
                status?.hasSignature ? 'bg-brand text-white hover:opacity-90' : 'bg-surface-rule text-text-faint cursor-not-allowed')}>
              <ThumbsUp className="w-4 h-4" /> {busy ? 'Signing…' : `Verify & Sign as ${status?.employeeName ?? 'you'} to Approve`}
            </button>
          )}

          <div className="flex gap-2 items-center pt-1 border-t border-surface-rule/60">
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for rejection…"
              className="input flex-1 text-[12px]" />
            <button disabled={!reason.trim() || busy}
              onClick={async () => { setBusy(true); await onDecide(c.id, 'rejected', { reason }); setBusy(false) }}
              className="px-3 py-2 rounded-lg text-[13px] font-semibold border border-err text-err hover:bg-err/10 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0">
              <ThumbsDown className="w-3.5 h-3.5" /> Reject
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
