'use client'

import { useState, useEffect } from 'react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { format, parseISO } from 'date-fns'
import {
  CheckCircle2, XCircle, AlertTriangle,
  Camera, Eye, EyeOff, ChevronDown, ChevronUp, Loader2,
  ClipboardCheck, Building2, RefreshCw, Download, ChevronRight,
} from 'lucide-react'
import AcumaticaSummary from '@/components/production/AcumaticaSummary'

// ═══════════════════════════════════════════════════════════════════════════════
// RECOUNT REVIEW — original code preserved exactly
// ═══════════════════════════════════════════════════════════════════════════════

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
  if (status === 'accepted') return <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-ok/10 text-ok font-bold">Accepted</span>
  if (status === 'rejected') return <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-err/10 text-err font-bold">Rejected</span>
  return <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-warn/10 text-warn font-bold">Pending</span>
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
    if (action === 'rejected' && !adminNotes.trim()) { setError('Please add a note explaining why the recount is rejected.'); return }
    setSub(true); setError(null)
    const update: any = { status: action, reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString(), admin_notes: adminNotes.trim() || null }
    if (action === 'accepted') { update.photo_base64 = null; update.photo_mime = null }
    const { error: dbErr } = await getDb().from('recount_requests').update(update).eq('id', req.id)
    if (dbErr) { setError(dbErr.message); setSub(false); return }
    setSub(false); onReviewed()
  }

  return (
    <div className={`bg-surface-card border rounded-2xl overflow-hidden ${req.status === 'accepted' ? 'border-ok/30' : req.status === 'rejected' ? 'border-err/30' : 'border-warn/40'}`}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-surface transition-colors">
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-body font-semibold text-[14px] text-text">{req.item_name}</span>
            {statusBadge(req.status)}
            {hasPhoto && req.status === 'pending' && (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-info/10 text-info flex items-center gap-1"><Camera size={9}/> Photo attached</span>
            )}
          </div>
          <div className="font-mono text-[11px] text-text-muted">
            {req.section_name} · {req.count_date ? format(parseISO(req.count_date), 'd MMM') : ''} · Submitted {format(parseISO(req.submitted_at), 'HH:mm')}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-[11px] text-text-muted">Var: <span className="text-warn font-bold">{req.variance_kg.toFixed(1)} kg</span></div>
          <div className="font-mono text-[11px] text-text">Recount: <span className="font-bold">{req.recount_kg.toFixed(1)} kg</span></div>
        </div>
        {open ? <ChevronUp size={15} className="text-text-muted shrink-0"/> : <ChevronDown size={15} className="text-text-muted shrink-0"/>}
      </button>

      {open && (
        <div className="border-t border-surface-rule px-5 pb-5 pt-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[{label:'Supervisor',value:`${req.sup_kg.toFixed(3)} kg`,color:'text-text'},{label:'Admin',value:`${req.adm_kg.toFixed(3)} kg`,color:'text-text'},{label:'Recount',value:`${req.recount_kg.toFixed(3)} kg`,color:'text-brand'}].map(col=>(
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
                <button onClick={() => setPhoto(s => !s)} className="flex items-center gap-1.5 font-mono text-[10px] text-brand hover:underline">
                  {showPhoto ? <><EyeOff size={10}/> Hide</> : <><Eye size={10}/> View</>}
                </button>
              </div>
              {showPhoto && <div className="rounded-xl overflow-hidden border border-surface-rule max-w-sm"><img src={`data:${req.photo_mime};base64,${req.photo_base64}`} alt="Recount evidence" className="w-full h-auto"/></div>}
              {req.status === 'pending' && <p className="font-mono text-[10px] text-text-muted/60">This photo will be automatically deleted when you accept the recount.</p>}
            </div>
          )}
          {req.status !== 'pending' && req.admin_notes && (
            <div className="bg-surface rounded-xl px-4 py-3">
              <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-1">Your response</p>
              <p className="font-body text-[13px] text-text">{req.admin_notes}</p>
              {req.reviewed_at && <p className="font-mono text-[10px] text-text-muted mt-1">{format(parseISO(req.reviewed_at), 'd MMM yyyy · HH:mm')}</p>}
            </div>
          )}
          {req.status === 'pending' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="font-mono text-[11px] text-text-muted uppercase tracking-wide">Your response / notes <span className="text-text-muted/40">(required to reject)</span></label>
                <textarea value={adminNotes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Accepted — supervisor recount confirmed correct." rows={2}
                  className="w-full px-4 py-3 rounded-xl border border-surface-rule bg-surface font-body text-[13px] text-text outline-none focus:border-brand resize-none"/>
              </div>
              {error && <p className="font-mono text-[12px] text-err">{error}</p>}
              <div className="flex gap-3">
                <button onClick={() => review('rejected')} disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-err/30 text-err font-display font-bold text-[13px] hover:bg-err/5 disabled:opacity-40 transition-colors">
                  {submitting ? <Loader2 size={14} className="animate-spin"/> : <XCircle size={14}/>} Reject
                </button>
                <button onClick={() => review('accepted')} disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-ok text-white font-display font-bold text-[13px] hover:bg-ok/80 disabled:opacity-40 transition-colors">
                  {submitting ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>} Accept recount
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RecountTab() {
  const [loading,  setLoading]  = useState(true)
  const [requests, setRequests] = useState<RecountRequest[]>([])
  const [filter,   setFilter]   = useState<'pending'|'all'>('pending')

  async function load() {
    setLoading(true)
    const { data } = await getDb().from('recount_requests').select('*, sc_sessions(count_date)').order('submitted_at', { ascending: false }).limit(100)
    setRequests(((data as any[]) ?? []).map((r: any) => ({ ...r, count_date: r.sc_sessions?.count_date ?? null })))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const pending  = requests.filter(r => r.status === 'pending')
  const filtered = filter === 'pending' ? pending : requests

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="font-body text-[13px] text-text-muted">Supervisor recount requests — review, accept or reject</p>
        {pending.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 bg-warn/10 border border-warn/30 rounded-xl">
            <AlertTriangle size={14} className="text-warn"/>
            <span className="font-mono text-[11px] text-warn font-bold">{pending.length} pending</span>
          </div>
        )}
      </div>
      <div className="flex gap-1 p-1 bg-surface-card border border-surface-rule rounded-xl w-fit">
        {(['pending','all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-4 py-2 rounded-lg font-body font-medium text-[13px] transition-colors capitalize ${filter === f ? 'bg-brand text-white' : 'text-text-muted hover:text-text'}`}>
            {f === 'pending' ? `Pending (${pending.length})` : `All (${requests.length})`}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="py-8 text-center font-mono text-[12px] text-text-muted animate-pulse">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center space-y-2">
          <CheckCircle2 size={28} className="text-ok mx-auto"/>
          <p className="font-mono text-[12px] text-text-muted">{filter === 'pending' ? 'No pending recounts' : 'No recount requests yet'}</p>
        </div>
      ) : (
        <div className="space-y-3">{filtered.map(req => <RecountReviewCard key={req.id} req={req} onReviewed={load}/>)}</div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACUMATICA CAPTURE QUEUE — new tab
// ═══════════════════════════════════════════════════════════════════════════════

type ProdSession = {
  id: string; section_id: string; section_name: string
  date: string; shift: string; status: 'draft'|'submitted'|'approved'
  notes: any; submitted_at: string|null; approved_at: string|null
  acumatica_captured: boolean; acumatica_captured_at: string|null; acumatica_order_ref: string|null
}

const SECTION_DOT: Record<string,string> = {
  sieving:'bg-teal-500', refining1:'bg-blue-600', refining2:'bg-blue-500',
  granule:'bg-amber-500', blender:'bg-purple-500', pasteuriser:'bg-red-500',
}

function AcumaticaCard({ session, onMarkCaptured, onRefresh }: { session:ProdSession; onMarkCaptured:(id:string,ref:string)=>Promise<void>; onRefresh:()=>void }) {
  const [open,     setOpen]     = useState(false)
  const [orderRef, setOrderRef] = useState(session.acumatica_order_ref ?? '')
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  const formData = (() => { try { return typeof session.notes === 'string' ? JSON.parse(session.notes) : (session.notes ?? {}) } catch { return {} } })()
  const captured = session.acumatica_captured

  async function handleMark() {
    if (!orderRef.trim()) { alert('Enter the Acumatica production order reference first.'); return }
    setSaving(true)
    await onMarkCaptured(session.id, orderRef.trim())
    setSaved(true); setSaving(false)
    setTimeout(onRefresh, 800)
  }

  return (
    <div className={`bg-white border rounded-2xl overflow-hidden shadow-sm ${captured ? 'border-stone-200 opacity-60' : 'border-stone-200'}`}>
      <div className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-stone-50 transition-colors" onClick={() => setOpen(o => !o)}>
        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${SECTION_DOT[session.section_id] ?? 'bg-stone-400'}`}/>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[14px] text-text">{session.section_name}</p>
          <p className="text-[11px] text-stone-400 font-mono mt-0.5">{format(parseISO(session.date+'T12:00:00'),'d MMM yyyy')} · <span className="capitalize">{session.shift}</span> shift</p>
        </div>
        <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg ${session.status==='approved'?'bg-ok/10 text-ok':session.status==='submitted'?'bg-amber-100 text-amber-700':'bg-stone-100 text-stone-500'}`}>
          {session.status==='approved'?'Signed off':session.status==='submitted'?'Submitted':'Draft'}
        </span>
        {captured && <span className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-ok/10 text-ok"><CheckCircle2 size={10}/> In Acumatica</span>}
        {open ? <ChevronDown size={16} className="text-stone-400"/> : <ChevronRight size={16} className="text-stone-400"/>}
      </div>

      {open && (
        <div className="border-t border-stone-100">
          <div className="flex items-center gap-3 px-5 py-3 bg-stone-50 border-b border-stone-100 flex-wrap">
            <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 text-[12px] font-medium text-stone-600 hover:border-brand hover:text-brand transition-colors">
              <Download size={13}/> Download / Print
            </button>
            {!captured && (session.status==='submitted'||session.status==='approved') && (
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                <input type="text" value={orderRef} onChange={e=>setOrderRef(e.target.value.toUpperCase())} placeholder="Acumatica order ref e.g. WO-001234"
                  className="px-3 py-2 rounded-lg border border-stone-200 text-[12px] font-mono text-text outline-none focus:border-brand w-60"/>
                <button onClick={handleMark} disabled={saving||!orderRef.trim()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ok text-white text-[12px] font-semibold disabled:opacity-40">
                  {saving?<Loader2 size={13} className="animate-spin"/>:saved?<CheckCircle2 size={13}/>:<ClipboardCheck size={13}/>}
                  {saving?'Saving…':saved?'Logged':'Mark as captured'}
                </button>
              </div>
            )}
            {captured && session.acumatica_order_ref && (
              <div className="ml-auto flex items-center gap-2 text-[12px] text-stone-500">
                <Building2 size={13}/> Order: <span className="font-mono font-bold text-text">{session.acumatica_order_ref}</span>
                {session.acumatica_captured_at && <span className="text-stone-400">· {format(parseISO(session.acumatica_captured_at),'d MMM HH:mm')}</span>}
              </div>
            )}
          </div>
          <div className="p-5">
            <AcumaticaSummary sectionId={session.section_id} sessionData={formData} date={session.date} shift={session.shift}/>
          </div>
        </div>
      )}
    </div>
  )
}

function AcumaticaTab() {
  const [sessions,     setSessions]     = useState<ProdSession[]>([])
  const [loading,      setLoading]      = useState(true)
  const [refreshing,   setRefreshing]   = useState(false)
  const [filterDate,   setFilterDate]   = useState(format(new Date(),'yyyy-MM-dd'))
  const [filterStatus, setFilterStatus] = useState<'pending'|'all'|'captured'>('pending')

  async function load() {
    setRefreshing(true)
    let q = getDb().schema('production').from('prod_sessions').select('*').order('date',{ascending:false}).order('section_id') as any
    if (filterDate) q = q.eq('date', filterDate)
    if (filterStatus === 'pending') q = q.in('status',['submitted','approved']).or('acumatica_captured.is.null,acumatica_captured.eq.false')
    else if (filterStatus === 'captured') q = q.eq('acumatica_captured', true)
    const { data } = await q
    setSessions((data ?? []) as ProdSession[])
    setLoading(false); setRefreshing(false)
  }

  useEffect(() => { load() }, [filterDate, filterStatus])

  async function markCaptured(id: string, ref: string) {
    await (getDb().schema('production').from('prod_sessions').update({
      acumatica_captured: true, acumatica_captured_at: new Date().toISOString(),
      acumatica_order_ref: ref, updated_at: new Date().toISOString(),
    } as any).eq('id', id) as any)
  }

  const pendingCount = sessions.filter(s => !s.acumatica_captured && (s.status==='submitted'||s.status==='approved')).length

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-[12px] text-blue-800">
        <p className="font-semibold mb-1">Sandbox testing — before going live with API push</p>
        <p>Ask your Acumatica partner to create a <strong>Snapshot company</strong> (System → Manage Snapshots → name it <code className="bg-blue-100 px-1 rounded">SANDBOX</code>). API URL changes from <code className="bg-blue-100 px-1 rounded">/LIVE/entity/</code> to <code className="bg-blue-100 px-1 rounded">/SANDBOX/entity/</code>. Production orders target screen <strong>IN305000</strong>. Once you have sandbox credentials, share the URL and I'll build the push endpoint.</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} className="px-3 py-2 rounded-lg border border-stone-200 text-[12px] font-mono outline-none focus:border-brand"/>
        <div className="flex gap-1">
          {(['pending','all','captured'] as const).map(f=>(
            <button key={f} onClick={()=>setFilterStatus(f)} className={`px-3 py-2 rounded-lg text-[12px] font-medium transition-colors ${filterStatus===f?'bg-brand text-white':'bg-stone-100 text-stone-500 hover:bg-stone-200'}`}>
              {f==='pending'?`Pending (${pendingCount})`:f==='captured'?'Captured':'All'}
            </button>
          ))}
        </div>
        <button onClick={load} disabled={refreshing} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 text-[12px] text-stone-500 hover:border-brand hover:text-brand disabled:opacity-40 transition-colors">
          <RefreshCw size={13} className={refreshing?'animate-spin':''}/> Refresh
        </button>
        {pendingCount > 0 && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 text-[11px] font-semibold">
            <AlertTriangle size={11}/> {pendingCount} session{pendingCount!==1?'s':''} need entry
          </span>
        )}
      </div>

      {loading
        ? <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-stone-300"/></div>
        : sessions.length === 0
        ? <div className="text-center py-16"><Building2 size={28} className="mx-auto mb-3 text-stone-200"/><p className="font-mono text-[12px] text-stone-400">{filterStatus==='pending'?'No sessions pending Acumatica entry for this date':'No sessions found'}</p></div>
        : <div className="space-y-3">{sessions.map(s=><AcumaticaCard key={s.id} session={s} onMarkCaptured={markCaptured} onRefresh={load}/>)}</div>
      }
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

type Tab = 'acumatica' | 'recount'

export default function ManagementPage() {
  const { role } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('acumatica')

  if (role !== 'admin' && role !== 'supervisor') {
    return <div className="flex items-center justify-center h-64"><p className="text-[13px] text-stone-400">Admin or supervisor access required</p></div>
  }

  return (
    <div className="px-4 py-6 max-w-[900px] mx-auto space-y-5">
      <div>
        <h1 className="font-display font-bold text-[22px] text-text">Management</h1>
        <p className="text-[12px] text-stone-400 mt-0.5">Acumatica capture queue · Recount review</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-stone-200">
        {([
          { id: 'acumatica' as Tab, label: 'Acumatica capture queue' },
          { id: 'recount'   as Tab, label: 'Recount review'          },
        ]).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 font-medium text-[13px] border-b-2 transition-colors -mb-px ${activeTab===tab.id?'border-brand text-brand':'border-transparent text-stone-400 hover:text-stone-700'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'acumatica' && <AcumaticaTab/>}
      {activeTab === 'recount'   && <RecountTab/>}
    </div>
  )
}