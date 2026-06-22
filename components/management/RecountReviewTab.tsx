'use client'

import { useState, useEffect } from 'react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { format, parseISO } from 'date-fns'
import {
  CheckCircle2, XCircle, AlertTriangle,
  Camera, Eye, EyeOff, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface RecountRequest {
  id:             string
  session_id:     string
  inventory_code: string
  item_name:      string
  section_name:   string
  sup_kg:         number
  adm_kg:         number
  variance_kg:    number
  recount_kg:     number
  notes:          string
  photo_base64:   string | null
  photo_mime:     string | null
  status:         string
  submitted_by:   string | null
  submitted_at:   string
  reviewed_at:    string | null
  reviewed_by:    string | null
  admin_notes:    string | null
  count_date?:    string
}

function statusBadge(status: string) {
  if (status === 'accepted') return (
    <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-ok/10 text-ok font-bold">Accepted</span>
  )
  if (status === 'rejected') return (
    <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-err/10 text-err font-bold">Rejected</span>
  )
  return (
    <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-warn/10 text-warn font-bold">Pending</span>
  )
}

function RecountReviewCard({ req, onReviewed }: { req: RecountRequest; onReviewed: () => void }) {
  const { user }  = useAuth()
  const [open,       setOpen]    = useState(req.status === 'pending')
  const [adminNotes, setNotes]   = useState(req.admin_notes ?? '')
  const [showPhoto,  setPhoto]   = useState(false)
  const [submitting, setSub]     = useState(false)
  const [error,      setError]   = useState<string | null>(null)

  const hasPhoto = !!req.photo_base64

  async function review(action: 'accepted' | 'rejected') {
    if (action === 'rejected' && !adminNotes.trim()) {
      setError('Please add a note explaining why the recount is rejected.')
      return
    }
    setSub(true); setError(null)
    const db = getDb()
    const update: any = {
      status:      action,
      reviewed_by: user?.id ?? null,
      reviewed_at: new Date().toISOString(),
      admin_notes: adminNotes.trim() || null,
    }
    if (action === 'accepted') { update.photo_base64 = null; update.photo_mime = null }
    const { error: dbErr } = await db.from('recount_requests').update(update).eq('id', req.id)
    if (dbErr) { setError(dbErr.message); setSub(false); return }
    setSub(false)
    onReviewed()
  }

  return (
    <div className={`bg-surface-card border rounded-2xl overflow-hidden ${
      req.status === 'accepted' ? 'border-ok/30' :
      req.status === 'rejected' ? 'border-err/30' :
      'border-warn/40'
    }`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-surface transition-colors"
      >
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-body font-semibold text-[14px] text-text">{req.item_name}</span>
            {statusBadge(req.status)}
            {hasPhoto && req.status === 'pending' && (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-info/10 text-info flex items-center gap-1">
                <Camera size={9}/> Photo attached
              </span>
            )}
          </div>
          <div className="font-mono text-[11px] text-text-muted">
            {req.section_name} · {req.count_date ? format(parseISO(req.count_date), 'd MMM') : ''} · Submitted {format(parseISO(req.submitted_at), 'HH:mm')}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-[11px] text-text-muted">
            Var: <span className="text-warn font-bold">{req.variance_kg.toFixed(1)} kg</span>
          </div>
          <div className="font-mono text-[11px] text-text">
            Recount: <span className="font-bold">{req.recount_kg.toFixed(1)} kg</span>
          </div>
        </div>
        {open ? <ChevronUp size={15} className="text-text-muted shrink-0"/> : <ChevronDown size={15} className="text-text-muted shrink-0"/>}
      </button>

      {open && (
        <div className="border-t border-surface-rule px-5 pb-5 pt-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label:'Supervisor', value:`${req.sup_kg.toFixed(3)} kg`,     color:'text-text' },
              { label:'Admin',      value:`${req.adm_kg.toFixed(3)} kg`,     color:'text-text' },
              { label:'Recount',   value:`${req.recount_kg.toFixed(3)} kg`, color:'text-brand' },
            ].map(col => (
              <div key={col.label} className="bg-surface rounded-xl p-3 text-center">
                <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide">{col.label}</div>
                <div className={`font-display font-bold text-[16px] ${col.color} mt-1`}>{col.value}</div>
              </div>
            ))}
          </div>

          <div className="bg-surface rounded-xl px-4 py-3">
            <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-1">Supervisor notes</p>
            <p className="font-body text-[13px] text-text leading-relaxed">"{req.notes}"</p>
          </div>

          {hasPhoto && req.photo_base64 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide">Supporting photo</p>
                <button
                  onClick={() => setPhoto(s => !s)}
                  className="flex items-center gap-1.5 font-mono text-[10px] text-brand hover:underline"
                >
                  {showPhoto ? <><EyeOff size={10}/> Hide</> : <><Eye size={10}/> View</>}
                </button>
              </div>
              {showPhoto && (
                <div className="rounded-xl overflow-hidden border border-surface-rule max-w-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:${req.photo_mime};base64,${req.photo_base64}`} alt="Recount evidence" className="w-full h-auto"/>
                </div>
              )}
              {req.status === 'pending' && (
                <p className="font-mono text-[10px] text-text-muted/60">
                  This photo will be automatically deleted when you accept the recount.
                </p>
              )}
            </div>
          )}

          {req.status !== 'pending' && req.admin_notes && (
            <div className="bg-surface rounded-xl px-4 py-3">
              <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-1">Your response</p>
              <p className="font-body text-[13px] text-text">{req.admin_notes}</p>
              {req.reviewed_at && (
                <p className="font-mono text-[10px] text-text-muted mt-1">
                  {format(parseISO(req.reviewed_at), 'd MMM yyyy · HH:mm')}
                </p>
              )}
            </div>
          )}

          {req.status === 'pending' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
                  Your response / notes{' '}
                  <span className="text-text-muted/40">(required to reject)</span>
                </label>
                <textarea
                  value={adminNotes} onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. Accepted — supervisor recount confirmed correct."
                  rows={2}
                  className="w-full px-4 py-3 rounded-xl border border-surface-rule bg-surface font-body text-[13px] text-text outline-none focus:border-brand resize-none"
                />
              </div>
              {error && <p className="font-mono text-[12px] text-err">{error}</p>}
              <div className="flex gap-3">
                <button
                  onClick={() => review('rejected')} disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-err/30 text-err font-display font-bold text-[13px] hover:bg-err/5 disabled:opacity-40 transition-colors"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin"/> : <XCircle size={14}/>}
                  Reject
                </button>
                <button
                  onClick={() => review('accepted')} disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-ok text-white font-display font-bold text-[13px] hover:bg-ok/80 disabled:opacity-40 transition-colors"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>}
                  Accept recount
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// RECOUNT REVIEW TAB
// ═════════════════════════════════════════════════════════════════════════════
export default function RecountReviewTab() {
  const [loading,  setLoading]  = useState(true)
  const [requests, setRequests] = useState<RecountRequest[]>([])
  const [filter,   setFilter]   = useState<'pending'|'all'>('pending')

  async function load() {
    setLoading(true)
    const db = getDb()
    const { data } = await db
      .from('recount_requests')
      .select('*, sc_sessions(count_date)')
      .order('submitted_at', { ascending: false })
      .limit(100)
    const mapped = ((data as any[]) ?? []).map((r: any) => ({
      ...r,
      count_date: r.sc_sessions?.count_date ?? null,
    }))
    setRequests(mapped)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const pending  = requests.filter(r => r.status === 'pending')
  const filtered = filter === 'pending' ? pending : requests

  return (
    <div className="space-y-5 max-w-[800px]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-body text-[13px] text-text-muted">
            Supervisor recount requests — review, accept or reject
          </p>
        </div>
        {pending.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 bg-warn/10 border border-warn/30 rounded-xl">
            <AlertTriangle size={14} className="text-warn"/>
            <span className="font-mono text-[11px] text-warn font-bold">{pending.length} pending</span>
          </div>
        )}
      </div>

      <div className="flex gap-1 p-1 bg-surface-card border border-surface-rule rounded-xl w-fit">
        {(['pending','all'] as const).map(f => (
          <button
            key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg font-body font-medium text-[13px] transition-colors capitalize ${
              filter === f ? 'bg-brand text-white' : 'text-text-muted hover:text-text'
            }`}
          >
            {f === 'pending' ? `Pending (${pending.length})` : `All (${requests.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-8 text-center font-mono text-[12px] text-text-muted animate-pulse">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center space-y-2">
          <CheckCircle2 size={28} className="text-ok mx-auto"/>
          <p className="font-mono text-[12px] text-text-muted">
            {filter === 'pending' ? 'No pending recounts' : 'No recount requests yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(req => (
            <RecountReviewCard key={req.id} req={req} onReviewed={load}/>
          ))}
        </div>
      )}
    </div>
  )
}
