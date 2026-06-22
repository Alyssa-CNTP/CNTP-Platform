'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, CheckCircle2, Loader2, PenLine, ShieldCheck } from 'lucide-react'
import type { McSession } from './MonthlyCountForm'

interface VarianceItem {
  inventory_code: string
  item_name:      string
  section_id:     string
  section_name:   string
  batch_number:   string | null
  sup_kg:         number
  adm_kg:         number
  variance_kg:    number
  variance_pct:   number
  reviewed:       boolean
  review_notes:   string | null
  reviewed_at:    string | null
}

interface ReviewRecord {
  inventory_code: string
  batch_number:   string | null
  notes:          string
  reviewed_at:    string
}

function VarianceCard({
  item, sessionId, onReviewed,
}: {
  item:       VarianceItem
  sessionId:  string
  onReviewed: () => void
}) {
  const { user } = useAuth()
  const db = getDb()
  const [open,       setOpen]       = useState(!item.reviewed)
  const [notes,      setNotes]      = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  async function submit() {
    if (!notes.trim()) { setError('A review note is required.'); return }
    setSubmitting(true); setError(null)
    const { error: dbErr } = await db.from('mc_reviews').insert({
      session_id:     sessionId,
      inventory_code: item.inventory_code,
      batch_number:   item.batch_number,
      section_id:     item.section_id,
      notes:          notes.trim(),
      reviewed_by:    user?.id ?? null,
    })
    if (dbErr) { setError(dbErr.message); setSubmitting(false); return }
    setSubmitting(false)
    onReviewed()
  }

  const severity = item.variance_pct > 15 ? 'high' : item.variance_pct > 5 ? 'medium' : 'low'

  return (
    <div className={`bg-surface-card border rounded-2xl overflow-hidden ${
      item.reviewed
        ? 'border-ok/30'
        : severity === 'high'   ? 'border-err/40'
        : severity === 'medium' ? 'border-warn/40'
        :                         'border-surface-rule'
    }`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-surface transition-colors"
      >
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          item.reviewed
            ? 'bg-ok'
            : severity === 'high' ? 'bg-err' : severity === 'medium' ? 'bg-warn' : 'bg-surface-rule'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-body font-semibold text-[13px] text-text">{item.item_name}</span>
            {item.reviewed && (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-ok/10 text-ok">Reviewed</span>
            )}
          </div>
          <div className="font-mono text-[10px] text-text-muted mt-0.5">
            {item.section_name}
            {item.batch_number && ` · ${item.batch_number}`}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className={`font-display font-bold text-[15px] ${
            severity === 'high' ? 'text-err' : severity === 'medium' ? 'text-warn' : 'text-text-muted'
          }`}>
            {item.variance_kg.toFixed(1)} kg
          </div>
          <div className="font-mono text-[10px] text-text-muted">
            {item.variance_pct.toFixed(1)}% variance
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-surface-rule px-5 pb-5 pt-4 space-y-4">
          {/* Count breakdown */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Warehouse', value: `${item.sup_kg.toFixed(3)} kg`, color: 'text-text' },
              { label: 'Stock',     value: `${item.adm_kg.toFixed(3)} kg`, color: 'text-text' },
              { label: 'Variance',   value: `${item.variance_kg.toFixed(3)} kg`, color: severity === 'high' ? 'text-err' : 'text-warn' },
            ].map(col => (
              <div key={col.label} className="bg-surface rounded-xl p-3 text-center">
                <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide">{col.label}</div>
                <div className={`font-display font-bold text-[15px] ${col.color} mt-1`}>{col.value}</div>
              </div>
            ))}
          </div>

          {/* Already reviewed */}
          {item.reviewed && item.review_notes && (
            <div className="bg-ok/5 border border-ok/20 rounded-xl px-4 py-3 space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={13} className="text-ok" />
                <span className="font-mono text-[10px] text-ok uppercase tracking-wide">Review Note</span>
                {item.reviewed_at && (
                  <span className="font-mono text-[10px] text-text-faint ml-auto">
                    {format(parseISO(item.reviewed_at), 'd MMM · HH:mm')}
                  </span>
                )}
              </div>
              <p className="font-body text-[13px] text-text">{item.review_notes}</p>
            </div>
          )}

          {/* Review form — only if not yet reviewed */}
          {!item.reviewed && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
                  Review Note *
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Explain the variance — e.g. recount confirmed supervisor figure. Admin count missed 2 bags at the back."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-surface-rule bg-surface font-body text-[13px] text-text outline-none focus:border-brand resize-none"
                />
              </div>
              {error && <p className="font-mono text-[12px] text-err">{error}</p>}
              <button
                onClick={submit}
                disabled={submitting || !notes.trim()}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-brand text-white font-display font-bold text-[14px] disabled:opacity-40"
              >
                {submitting
                  ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                  : <><PenLine size={14} /> Mark as Reviewed</>
                }
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sign-off panel ─────────────────────────────────────────────────────────────
function SignOffPanel({ session, onSignOff }: { session: McSession; onSignOff: () => void }) {
  const { user, displayName } = useAuth()
  const db = getDb()
  const [notes,      setNotes]      = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  async function handleSignOff() {
    setSubmitting(true); setError(null)
    const { error: dbErr } = await db
      .from('mc_sessions')
      .update({
        signed_off_by:   user?.id ?? null,
        signed_off_at:   new Date().toISOString(),
        sign_off_notes:  notes.trim() || null,
        updated_at:      new Date().toISOString(),
      })
      .eq('id', session.id)
    if (dbErr) { setError(dbErr.message); setSubmitting(false); return }
    setSubmitting(false)
    onSignOff()
  }

  if (session.signed_off_at) {
    return (
      <div className="bg-ok/8 border border-ok/30 rounded-2xl px-5 py-4 flex items-center gap-3">
        <ShieldCheck size={20} className="text-ok flex-shrink-0" />
        <div>
          <p className="font-body font-semibold text-[14px] text-ok">Monthly Count Signed Off</p>
          <p className="font-mono text-[11px] text-text-muted mt-0.5">
            {format(parseISO(session.signed_off_at), 'd MMM yyyy · HH:mm')}
            {session.sign_off_notes && ` · "${session.sign_off_notes}"`}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl px-5 py-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-text-muted" />
        <span className="font-display font-bold text-[14px] text-text">Management Sign-Off</span>
      </div>
      <p className="font-body text-[13px] text-text-muted">
        Once all variances have been reviewed, you can formally sign off this monthly count.
      </p>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Optional sign-off notes…"
        rows={2}
        className="w-full px-4 py-3 rounded-xl border border-surface-rule bg-surface font-body text-[13px] text-text outline-none focus:border-brand resize-none"
      />
      {error && <p className="font-mono text-[12px] text-err">{error}</p>}
      <button
        onClick={handleSignOff}
        disabled={submitting}
        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-ok text-white font-display font-bold text-[14px] disabled:opacity-40"
      >
        {submitting
          ? <><Loader2 size={14} className="animate-spin" /> Signing off…</>
          : <><ShieldCheck size={14} /> Sign Off Monthly Count</>
        }
      </button>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// MONTHLY VARIANCES
// ═════════════════════════════════════════════════════════════════════════════
export default function MonthlyVariances({
  session,
  onSessionUpdate,
}: {
  session:         McSession
  onSessionUpdate: (s: McSession) => void
}) {
  const db = getDb()
  const [loading,   setLoading]   = useState(true)
  const [variances, setVariances] = useState<VarianceItem[]>([])

  useEffect(() => { load() }, [session.id])

  async function load() {
    setLoading(true)

    // Get entries
    const { data: entries } = await db
      .from('mc_entries')
      .select('section_id,section_name,inventory_code,item_name,batch_number,role,kg')
      .eq('session_id', session.id)
      .eq('is_no_stock', false)

    // Get existing reviews
    const { data: reviews } = await db
      .from('mc_reviews')
      .select('inventory_code,batch_number,notes,reviewed_at')
      .eq('session_id', session.id)

    const reviewMap = new Map<string, ReviewRecord>()
    ;(reviews ?? []).forEach((r: any) => {
      const k = `${r.inventory_code}::${r.batch_number ?? ''}`
      reviewMap.set(k, r)
    })

    // Group entries by item + batch
    const map = new Map<string, VarianceItem>()
    ;(entries ?? []).forEach((e: any) => {
      const k = `${e.inventory_code}::${e.batch_number ?? ''}`
      if (!map.has(k)) {
        map.set(k, {
          inventory_code: e.inventory_code,
          item_name:      e.item_name ?? e.inventory_code,
          section_id:     e.section_id,
          section_name:   e.section_name ?? e.section_id,
          batch_number:   e.batch_number,
          sup_kg:         0,
          adm_kg:         0,
          variance_kg:    0,
          variance_pct:   0,
          reviewed:       false,
          review_notes:   null,
          reviewed_at:    null,
        })
      }
      const item = map.get(k)!
      if (e.role === 'supervisor') item.sup_kg += e.kg ?? 0
      else                         item.adm_kg += e.kg ?? 0
    })

    // Calculate variances and attach reviews
    const items = Array.from(map.values())
      .map(item => {
        const diff  = Math.abs(item.sup_kg - item.adm_kg)
        const maxKg = Math.max(item.sup_kg, item.adm_kg)
        const pct   = maxKg > 0 ? (diff / maxKg) * 100 : 0
        const k     = `${item.inventory_code}::${item.batch_number ?? ''}`
        const rev   = reviewMap.get(k)
        return {
          ...item,
          variance_kg:  diff,
          variance_pct: pct,
          reviewed:     !!rev,
          review_notes: rev?.notes ?? null,
          reviewed_at:  rev?.reviewed_at ?? null,
        }
      })
      // Only show items with meaningful variance (> 2%)
      .filter(item => item.variance_pct > 2)
      .sort((a, b) => b.variance_pct - a.variance_pct)

    setVariances(items)
    setLoading(false)
  }

  async function handleSignOff() {
    const { data } = await db
      .from('mc_sessions')
      .select('*')
      .eq('id', session.id)
      .single()
    if (data) onSessionUpdate(data as McSession)
  }

  const unreviewedCount = variances.filter(v => !v.reviewed).length

  if (loading) {
    return <div className="py-12 text-center font-mono text-[12px] text-text-muted animate-pulse">Loading variances…</div>
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="flex items-center gap-3 flex-wrap">
        {unreviewedCount > 0 ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-warn/10 border border-warn/30 rounded-xl">
            <AlertTriangle size={14} className="text-warn" />
            <span className="font-mono text-[11px] text-warn font-bold">
              {unreviewedCount} variance{unreviewedCount !== 1 ? 's' : ''} awaiting review
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 bg-ok/8 border border-ok/25 rounded-xl">
            <CheckCircle2 size={14} className="text-ok" />
            <span className="font-mono text-[11px] text-ok font-bold">All variances reviewed</span>
          </div>
        )}
      </div>

      {/* Variance cards */}
      {variances.length === 0 ? (
        <div className="py-12 text-center space-y-2">
          <CheckCircle2 size={28} className="text-ok mx-auto" />
          <p className="font-mono text-[12px] text-text-muted">No significant variances — supervisor and admin counts are within 2%</p>
        </div>
      ) : (
        <div className="space-y-3">
          {variances.map(v => (
            <VarianceCard
              key={`${v.inventory_code}::${v.batch_number}`}
              item={v}
              sessionId={session.id}
              onReviewed={load}
            />
          ))}
        </div>
      )}

      {/* Sign-off — only show if both roles have submitted */}
      {session.sup_confirmed_at && session.adm_confirmed_at && (
        <SignOffPanel session={session} onSignOff={handleSignOff} />
      )}
    </div>
  )
}
