'use client'

// ─── Admin session unlock ──────────────────────────────────────────────────
// Place this component on the /management page or /management/recounts.
// Allows admin to unlock an approved session back to 'submitted' so the
// supervisor must re-review and re-sign. Full audit trail kept.

import { useState } from 'react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { Unlock, Loader2, AlertTriangle } from 'lucide-react'

interface UnlockSessionProps {
  sessionId: string
  sectionName: string
  shift: string
  date: string
  currentStatus: string
  onUnlocked: () => void
}

export function UnlockSession({
  sessionId, sectionName, shift, date, currentStatus, onUnlocked
}: UnlockSessionProps) {
  const { user } = useAuth()
  const [open,    setOpen]    = useState(false)
  const [reason,  setReason]  = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  if (currentStatus !== 'approved') return null

  async function unlock() {
    if (!reason.trim()) { setError('A reason is required to unlock a session.'); return }
    setLoading(true); setError(null)
    const db = getDb()

    // Store the unlock event in session notes (audit trail)
    const { data: sess } = await db.from('prod_sessions')
      .select('notes').eq('id', sessionId).maybeSingle()

    const existingNotes = (sess as any)?.notes ? JSON.parse((sess as any).notes) : {}
    const audit = {
      ...existingNotes,
      _unlock_history: [
        ...(existingNotes._unlock_history ?? []),
        {
          unlocked_by: user?.id,
          unlocked_at: new Date().toISOString(),
          reason: reason.trim(),
        }
      ]
    }

    const { error: dbErr } = await db.from('prod_sessions').update({
      status: 'submitted',
      approved_at: null,
      approved_by: null,
      updated_at: new Date().toISOString(),
      notes: JSON.stringify(audit),
    } as any).eq('id', sessionId)

    if (dbErr) { setError(dbErr.message); setLoading(false); return }
    setLoading(false)
    setOpen(false)
    setReason('')
    onUnlocked()
  }

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-warn/30 text-warn font-mono text-[11px] hover:bg-warn/5 transition-colors"
        >
          <Unlock size={12} /> Unlock session
        </button>
      ) : (
        <div className="bg-warn/8 border border-warn/30 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-warn shrink-0" />
            <span className="font-body font-semibold text-[13px] text-warn">
              Unlock {sectionName} — {shift} shift {date}?
            </span>
          </div>
          <p className="font-mono text-[11px] text-text-muted">
            This will set the session back to "awaiting sign-off" and require the supervisor to re-review and re-sign. The unlock is recorded in the audit trail.
          </p>
          <div className="space-y-1">
            <label className="font-mono text-[10px] text-text-muted uppercase tracking-wide">Reason for unlock *</label>
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Operator entered wrong kg for Fine Leaf bag 3"
              className="w-full px-3 py-2.5 rounded-xl border border-surface-rule bg-surface font-body text-[13px] text-text outline-none focus:border-warn"
            />
          </div>
          {error && <p className="font-mono text-[11px] text-err">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setOpen(false); setReason('') }}
              className="flex-1 py-2.5 rounded-xl border border-surface-rule font-mono text-[12px] text-text-muted hover:text-text transition-colors">
              Cancel
            </button>
            <button onClick={unlock} disabled={loading || !reason.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-warn text-white font-display font-bold text-[13px] disabled:opacity-40">
              {loading ? <Loader2 size={13} className="animate-spin" /> : <Unlock size={13} />}
              {loading ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}