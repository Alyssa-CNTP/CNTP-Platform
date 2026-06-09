'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import {
  AlertTriangle, Camera, CheckCircle2, Clock, X,
  ChevronDown, ChevronUp, Send, Loader2, RefreshCw,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface VarianceEntry {
  inventory_code: string
  item_name:      string
  section_id:     string
  section_name:   string
  sup_kg:         number
  adm_kg:         number
  variance_kg:    number
}

interface RecountRequest {
  id:            string
  inventory_code: string
  item_name:      string
  section_name:   string
  sup_kg:         number
  adm_kg:         number
  variance_kg:    number
  recount_kg:     number
  notes:          string
  status:         string
  submitted_at:   string
  reviewed_at:    string | null
  admin_notes:    string | null
  has_photo:      boolean
}

interface ScSession {
  id: string
  count_date: string
  sup_confirmed_at: string | null
  adm_confirmed_at: string | null
  comparison_status: string | null
}

function fileToBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve({
      base64: (reader.result as string).split(',')[1],
      mime:   file.type,
    })
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function VarianceItem({
  entry, sessionId, onSubmitted,
}: {
  entry: VarianceEntry; sessionId: string; onSubmitted: () => void
}) {
  const { user } = useAuth()
  const [open, setOpen]         = useState(false)
  const [recountKg, setRecount] = useState('')
  const [notes, setNotes]       = useState('')
  const [photo, setPhoto]       = useState<{ base64: string; mime: string; preview: string } | null>(null)
  const [submitting, setSub]    = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const pct = entry.sup_kg > 0
    ? Math.round((entry.variance_kg / Math.max(entry.sup_kg, entry.adm_kg)) * 100)
    : 0

  async function handlePhoto(file: File) {
    const result = await fileToBase64(file)
    setPhoto({ ...result, preview: URL.createObjectURL(file) })
  }

  async function submit() {
    if (!recountKg || !notes.trim()) { setError('Recount weight and notes are required.'); return }
    setSub(true); setError(null)
    const db = getDb()
    const { error: dbErr } = await db.from('recount_requests').insert({
      session_id:     sessionId,
      inventory_code: entry.inventory_code,
      item_name:      entry.item_name,
      section_id:     entry.section_id,
      section_name:   entry.section_name,
      sup_kg:         entry.sup_kg,
      adm_kg:         entry.adm_kg,
      variance_kg:    entry.variance_kg,
      recount_kg:     parseFloat(recountKg),
      notes:          notes.trim(),
      photo_base64:   photo?.base64 ?? null,
      photo_mime:     photo?.mime   ?? null,
      status:         'pending',
      submitted_by:   user?.id ?? null,
    } as any)
    if (dbErr) { setError(dbErr.message); setSub(false); return }
    setSubmitted(true); setSub(false)
    setTimeout(onSubmitted, 800)
  }

  if (submitted) {
    return (
      <div className="flex items-center gap-3 px-5 py-4 bg-ok/5 border border-ok/20 rounded-2xl">
        <CheckCircle2 size={18} className="text-ok shrink-0" />
        <div>
          <div className="font-body font-semibold text-[13px] text-ok">Recount submitted</div>
          <div className="font-mono text-[11px] text-text-muted">{entry.item_name}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-surface transition-colors"
      >
        <div className="w-2 h-2 rounded-full bg-warn shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-body font-semibold text-[13px] text-text truncate">{entry.item_name}</div>
          <div className="font-mono text-[11px] text-text-muted">{entry.section_name}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-display font-bold text-[15px] text-warn">{entry.variance_kg.toFixed(1)} kg off</div>
          <div className="font-mono text-[10px] text-text-muted">
            Sup {entry.sup_kg.toFixed(1)} · Adm {entry.adm_kg.toFixed(1)} · {pct}% variance
          </div>
        </div>
        {open ? <ChevronUp size={15} className="text-text-muted shrink-0" /> : <ChevronDown size={15} className="text-text-muted shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-surface-rule px-5 pb-5 space-y-4 pt-4">
          <div className="space-y-1.5">
            <label className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
              Your recount weight (kg) *
            </label>
            <input
              type="number" step="0.001" value={recountKg}
              onChange={e => setRecount(e.target.value)}
              placeholder="e.g. 1250.500"
              className="w-full px-4 py-3 rounded-xl border border-surface-rule bg-surface font-mono text-[14px] text-text outline-none focus:border-brand"
            />
            <p className="font-mono text-[10px] text-text-muted">
              Supervisor counted: {entry.sup_kg.toFixed(3)} kg · Admin counted: {entry.adm_kg.toFixed(3)} kg
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
              Notes — explain the discrepancy *
            </label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Found 2 extra bags behind the pallet. Admin count appears to have missed them."
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-surface-rule bg-surface font-body text-[13px] text-text outline-none focus:border-brand resize-none leading-relaxed"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
              Supporting photo (optional)
            </label>
            {photo ? (
              <div className="relative w-40 h-28 rounded-xl overflow-hidden border border-surface-rule">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.preview} alt="Supporting photo" className="w-full h-full object-cover" />
                <button
                  onClick={() => setPhoto(null)}
                  className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white"
                >
                  <X size={11} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-surface-rule text-text-muted hover:border-brand hover:text-brand transition-colors font-mono text-[12px]"
              >
                <Camera size={14} /> Take or attach a photo
              </button>
            )}
            <input
              ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handlePhoto(f) }}
            />
            <p className="font-mono text-[10px] text-text-muted">
              Photo will be removed from the system once admin accepts the recount.
            </p>
          </div>

          {error && <p className="font-mono text-[12px] text-err">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting || !recountKg || !notes.trim()}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-brand text-white font-display font-bold text-[14px] disabled:opacity-40 transition-opacity"
          >
            {submitting
              ? <><Loader2 size={15} className="animate-spin" /> Submitting…</>
              : <><Send size={14} /> Submit recount</>
            }
          </button>
        </div>
      )}
    </div>
  )
}

function RecountCard({ req }: { req: RecountRequest }) {
  const statusColor = req.status === 'accepted' ? 'text-ok' : req.status === 'rejected' ? 'text-err' : 'text-warn'
  const statusLabel = req.status === 'accepted' ? 'Accepted' : req.status === 'rejected' ? 'Rejected' : 'Pending review'

  return (
    <div className={`bg-surface-card border rounded-2xl p-4 space-y-2 ${
      req.status === 'accepted' ? 'border-ok/30' :
      req.status === 'rejected' ? 'border-err/30' :
      'border-warn/30'
    }`}>
      <div className="flex items-center justify-between">
        <span className="font-body font-semibold text-[13px] text-text">{req.item_name}</span>
        <span className={`font-mono text-[11px] font-bold ${statusColor}`}>{statusLabel}</span>
      </div>
      <div className="font-mono text-[11px] text-text-muted">
        {req.section_name} · Submitted {format(new Date(req.submitted_at), 'd MMM HH:mm')}
      </div>
      <div className="flex items-center gap-4 font-mono text-[11px] text-text-muted">
        <span>Sup: {req.sup_kg.toFixed(1)} kg</span>
        <span>Adm: {req.adm_kg.toFixed(1)} kg</span>
        <span className="font-bold text-text">Recount: {req.recount_kg.toFixed(1)} kg</span>
      </div>
      {req.notes && <p className="font-body text-[12px] text-text-muted italic">"{req.notes}"</p>}
      {req.admin_notes && (
        <div className="bg-surface rounded-lg px-3 py-2">
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-1">Admin response</p>
          <p className="font-body text-[12px] text-text">{req.admin_notes}</p>
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// RECOUNT TAB
// ═════════════════════════════════════════════════════════════════════════════
export default function RecountTab() {
  const [loading, setLoading]       = useState(true)
  const [session, setSession]       = useState<ScSession | null>(null)
  const [variances, setVariances]   = useState<VarianceEntry[]>([])
  const [existing, setExisting]     = useState<RecountRequest[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const today = format(new Date(), 'yyyy-MM-dd')

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    const db = getDb()

    const { data: sess } = await db
      .from('sc_sessions')
      .select('id,count_date,sup_confirmed_at,adm_confirmed_at,comparison_status')
      .eq('count_date', today)
      .maybeSingle()

    setSession((sess as ScSession) ?? null)

    if (sess?.id) {
      const { data: vars } = await db
        .from('v_discrepancy_trends')
        .select('*')
        .eq('count_date', today)

      const entries: VarianceEntry[] = ((vars as any[]) ?? [])
        .filter((v: any) => v.abs_variance_kg > 0)
        .map((v: any) => ({
          inventory_code: v.inventory_code,
          item_name:      v.item_name,
          section_id:     v.section_id,
          section_name:   v.section_name,
          sup_kg:         v.sup_total_kg ?? 0,
          adm_kg:         v.adm_total_kg ?? 0,
          variance_kg:    v.abs_variance_kg ?? 0,
        }))
        .sort((a: VarianceEntry, b: VarianceEntry) => b.variance_kg - a.variance_kg)

      setVariances(entries)

      const { data: reqs } = await db
        .from('recount_requests')
        .select('id,inventory_code,item_name,section_name,sup_kg,adm_kg,variance_kg,recount_kg,notes,status,submitted_at,reviewed_at,admin_notes,photo_base64')
        .eq('session_id', sess.id)
        .order('submitted_at', { ascending: false })

      setExisting(((reqs as any[]) ?? []).map((r: any) => ({ ...r, has_photo: !!r.photo_base64 })))
    }

    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => { load() }, [])

  const submittedCodes    = new Set(existing.map(r => r.inventory_code))
  const pendingVariances  = variances.filter(v => !submittedCodes.has(v.inventory_code))

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="font-mono text-[12px] text-text-muted animate-pulse">Loading…</div>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 space-y-5 max-w-[720px]">

      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] text-text-muted mt-0.5">
            {format(new Date(), 'EEEE d MMMM')} · Variance sections only
          </p>
        </div>
        <button
          onClick={() => load(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-card border border-surface-rule font-mono text-[10px] text-text-muted hover:text-text transition-colors"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {!session && (
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-8 text-center space-y-2">
          <Clock size={28} className="text-text-muted/40 mx-auto" />
          <p className="font-body text-[13px] text-text-muted">No completed count session for today yet.</p>
          <p className="font-mono text-[11px] text-text-muted/60">
            Both supervisor and admin must confirm their counts before variances appear here.
          </p>
        </div>
      )}

      {session && variances.length === 0 && (
        <div className="bg-ok/8 border border-ok/30 rounded-2xl p-8 text-center space-y-2">
          <CheckCircle2 size={28} className="text-ok mx-auto" />
          <p className="font-body font-semibold text-[14px] text-ok">All counts matched</p>
          <p className="font-mono text-[11px] text-text-muted">No variances found in today's count.</p>
        </div>
      )}

      {pendingVariances.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-warn" />
            <span className="font-display font-bold text-[13px] text-text uppercase tracking-wide">
              {pendingVariances.length} variance{pendingVariances.length !== 1 ? 's' : ''} to address
            </span>
          </div>
          {pendingVariances.map(entry => (
            <VarianceItem
              key={entry.inventory_code}
              entry={entry}
              sessionId={session!.id}
              onSubmitted={load}
            />
          ))}
        </div>
      )}

      {existing.length > 0 && (
        <div className="space-y-3">
          <span className="font-display font-bold text-[13px] text-text uppercase tracking-wide">
            Submitted recounts
          </span>
          {existing.map(req => (
            <RecountCard key={req.id} req={req} />
          ))}
        </div>
      )}
    </div>
  )
}
