'use client'

import { useEffect, useState } from 'react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { format, subDays, parseISO } from 'date-fns'
import type { ScSession } from '@/lib/supabase/database.types'
import {
  Download, Eye, X, ChevronDown, ChevronRight,
  ClipboardCheck, Loader2, CheckCircle2,
} from 'lucide-react'
import CountCompareView from '@/components/count/CountCompareView'
import AcumaticaSummary from '@/components/production/AcumaticaSummary'
import { useRouter } from 'next/navigation'

// ── Session row — expandable Acumatica entry sheet ────────────────────────────
const SECTION_DOT: Record<string, string> = {
  sieving:     'bg-teal-500',
  refining1:   'bg-blue-600',
  refining2:   'bg-blue-500',
  granule:     'bg-amber-500',
  blender:     'bg-purple-500',
  pasteuriser: 'bg-red-500',
}

function SessionRow({
  session: s,
  onMarkCaptured,
}: {
  session: any
  onMarkCaptured: (id: string, ref: string) => Promise<void>
}) {
  const [open,     setOpen]     = useState(false)
  const [orderRef, setOrderRef] = useState(s.acumatica_order_ref ?? '')
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(!!s.acumatica_captured)

  const formData = (() => {
    try { return typeof s.notes === 'string' ? JSON.parse(s.notes) : (s.notes ?? {}) }
    catch { return {} }
  })()

  const canCapture = !s.acumatica_captured && (s.status === 'submitted' || s.status === 'approved')
  const captured   = !!s.acumatica_captured

  async function handleMark() {
    if (!orderRef.trim()) { alert('Enter the Acumatica production order reference first.'); return }
    setSaving(true)
    await onMarkCaptured(s.id, orderRef.trim())
    setSaved(true)
    setSaving(false)
  }

  return (
    <div className={captured ? 'opacity-60' : ''}>
      {/* Collapsed row */}
      <div
        className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-surface transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${SECTION_DOT[s.section_id] ?? 'bg-stone-400'}`}/>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[13px] text-text">{s.section_name || s.section_id}</p>
          <p className="font-mono text-[11px] text-text-muted capitalize">{s.shift} shift</p>
        </div>
        <span className={`font-mono text-[10px] px-2 py-0.5 rounded-md ${
          s.status === 'approved'  ? 'bg-ok/10 text-ok' :
          s.status === 'submitted' ? 'bg-info/10 text-info' :
          s.status === 'draft'     ? 'bg-warn/10 text-warn' :
                                      'bg-surface text-text-muted'
        }`}>
          {s.status}
        </span>
        {captured && (
          <span className="flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-md bg-ok/10 text-ok">
            <CheckCircle2 size={10}/> In Acumatica
          </span>
        )}
        <span className="font-mono text-[11px] text-text-muted w-12 text-right flex-shrink-0">
          {s.submitted_at ? format(new Date(s.submitted_at), 'HH:mm') : '—'}
        </span>
        {open
          ? <ChevronDown  size={14} className="text-text-muted flex-shrink-0"/>
          : <ChevronRight size={14} className="text-text-muted flex-shrink-0"/>
        }
      </div>

      {/* Expanded — entry sheet */}
      {open && (
        <div className="border-t border-surface-rule">
          {/* Action bar */}
          <div className="flex items-center gap-3 px-5 py-3 bg-surface border-b border-surface-rule flex-wrap">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-rule text-[12px] font-medium text-text-muted hover:border-brand hover:text-brand transition-colors"
            >
              <Download size={13}/> Print / Download
            </button>

            {canCapture && (
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                <input
                  type="text"
                  value={orderRef}
                  onChange={e => setOrderRef(e.target.value.toUpperCase())}
                  placeholder="Acumatica order ref e.g. WO-001234"
                  onClick={e => e.stopPropagation()}
                  className="px-3 py-1.5 rounded-lg border border-surface-rule text-[12px] font-mono text-text outline-none focus:border-brand w-56"
                />
                <button
                  onClick={e => { e.stopPropagation(); handleMark() }}
                  disabled={saving || !orderRef.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-ok text-white text-[12px] font-semibold disabled:opacity-40"
                >
                  {saving
                    ? <Loader2 size={13} className="animate-spin"/>
                    : saved
                    ? <CheckCircle2 size={13}/>
                    : <ClipboardCheck size={13}/>
                  }
                  {saving ? 'Saving…' : saved ? 'Logged ✓' : 'Mark as captured in Acumatica'}
                </button>
              </div>
            )}

            {captured && s.acumatica_order_ref && (
              <div className="ml-auto flex items-center gap-2 text-[12px] text-text-muted">
                Order: <span className="font-mono font-bold text-text">{s.acumatica_order_ref}</span>
                {s.acumatica_captured_at && (
                  <span className="text-text-faint">
                    · {format(parseISO(s.acumatica_captured_at), 'd MMM HH:mm')}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Entry sheet */}
          <div className="p-5">
            {Object.keys(formData).length === 0 ? (
              <p className="text-[12px] text-text-muted text-center py-6">
                No production data captured yet for this session — operator has not saved a draft.
              </p>
            ) : (
              <AcumaticaSummary
                sectionId={s.section_id}
                sessionData={formData}
                date={s.date}
                shift={s.shift}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Production sessions table ─────────────────────────────────────────────────
function ProductionSessionsTable({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const db = getDb()
  const [sessions, setSessions] = useState<any[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await db
        .schema('production')
        .from('prod_sessions')
        .select('id, section_id, section_name, date, shift, status, submitted_at, notes, acumatica_captured, acumatica_captured_at, acumatica_order_ref')
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: false })
        .order('section_id')
      setSessions(data ?? [])
      setLoading(false)
    }
    load()
  }, [dateFrom, dateTo])

  async function markCaptured(sessionId: string, orderRef: string) {
    await db.schema('production').from('prod_sessions').update({
      acumatica_captured:    true,
      acumatica_captured_at: new Date().toISOString(),
      acumatica_order_ref:   orderRef,
      updated_at:            new Date().toISOString(),
    } as any).eq('id', sessionId)
    setSessions(prev => prev.map(s =>
      s.id === sessionId
        ? { ...s, acumatica_captured: true, acumatica_order_ref: orderRef, acumatica_captured_at: new Date().toISOString() }
        : s
    ))
  }

  if (loading) return (
    <div className="p-8 text-center text-text-muted text-sm animate-pulse">Loading production sessions…</div>
  )
  if (!sessions.length) return (
    <div className="p-8 text-center text-text-muted text-sm">No production sessions in this date range.</div>
  )

  // Group by date
  const byDate: Record<string, any[]> = {}
  sessions.forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = []
    byDate[s.date].push(s)
  })

  const pendingCapture = sessions.filter(s =>
    !s.acumatica_captured && (s.status === 'submitted' || s.status === 'approved')
  ).length

  return (
    <div className="space-y-4">
      {pendingCapture > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-warn/8 border border-warn/30 rounded-xl">
          <ClipboardCheck size={16} className="text-warn flex-shrink-0"/>
          <p className="text-[12px] text-warn font-medium">
            {pendingCapture} session{pendingCapture !== 1 ? 's' : ''} ready for Acumatica entry — click any row to expand
          </p>
        </div>
      )}

      {Object.entries(byDate).map(([date, rows]) => (
        <div key={date} className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-surface border-b border-surface-rule flex items-center justify-between">
            <span className="font-display font-bold text-[14px] text-text">
              {format(new Date(date + 'T12:00:00'), 'd MMM yyyy')}
            </span>
            <span className="font-mono text-[10px] text-text-muted">
              {rows.length} session{rows.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="divide-y divide-surface-rule">
            {rows.map(s => (
              <SessionRow key={s.id} session={s} onMarkCaptured={markCaptured}/>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main management page (structure unchanged) ────────────────────────────────
export default function ManagementPage() {
  const { isManagement } = useAuth()
  const db     = getDb()
  const router = useRouter()

  const [sessions,     setSessions]    = useState<ScSession[]>([])
  const [loading,      setLoading]     = useState(true)
  const [filter,       setFilter]      = useState<'all'|'review'|'pending'>('all')
  const [module,       setModule]      = useState<'count'|'production'>('count')
  const [viewSession,  setViewSession] = useState<{ id:string; date:string }|null>(null)
  const [dateFrom,     setDateFrom]    = useState(format(subDays(new Date(), 90), 'yyyy-MM-dd'))
  const [dateTo,       setDateTo]      = useState(format(new Date(), 'yyyy-MM-dd'))

  useEffect(() => { loadCount() }, [dateFrom, dateTo])

  async function loadCount() {
    setLoading(true)
    const { data } = await db
      .from('sc_sessions')
      .select('*')
      .gte('count_date', dateFrom)
      .lte('count_date', dateTo)
      .order('count_date', { ascending: false })
    setSessions((data ?? []) as ScSession[])
    setLoading(false)
  }

  const filtered = sessions.filter(s => {
    if (filter === 'review')  return !!s.adm_confirmed_at && !!s.sup_confirmed_at && (s.match_rate_pct ?? 100) < 90
    if (filter === 'pending') return !s.adm_confirmed_at || !s.sup_confirmed_at
    return true
  })

  const reviewCount    = sessions.filter(s => !!s.adm_confirmed_at && !!s.sup_confirmed_at && (s.match_rate_pct ?? 100) < 90).length
  const pendingCount   = sessions.filter(s => !s.adm_confirmed_at || !s.sup_confirmed_at).length
  const completedCount = sessions.filter(s => !!s.adm_confirmed_at && !!s.sup_confirmed_at).length

  async function exportCSV() {
    const sessionIds = filtered.map(s => s.id)
    if (!sessionIds.length) return
    const { data: entries } = await db
      .from('sc_entries').select('*')
      .in('session_id', sessionIds)
      .order('session_id').order('section_id').order('inventory_code')
    const rows = entries ?? []
    const header = ['Date','Role','Section','Inventory Code','Item Name','Entry Type','No Stock','Batch Number','kg','Boxes','Bags','Paper Bags'].join(',')
    const sessionMap = Object.fromEntries(sessions.map(s => [s.id, s.count_date]))
    const lines = rows.map((r: any) => [
      sessionMap[r.session_id] ?? '', r.role, r.section_name, r.inventory_code,
      `"${(r.item_name ?? '').replace(/"/g,'""')}"`, r.entry_type,
      r.is_no_stock ? 'yes' : 'no', r.batch_number ?? '', r.kg ?? 0,
      r.boxes ?? 0, r.bags_qty ?? 0, r.paper_bags ?? 0,
    ].join(','))
    const csv  = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `cntp-count-export-${new Date().toISOString().slice(0,10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  function statusPill(s: ScSession) {
    const both = !!s.adm_confirmed_at && !!s.sup_confirmed_at
    if (!both) return <span className="badge badge-gray">Partial</span>
    const match = s.match_rate_pct ?? 100
    if (match < 90) return <span className="badge badge-warn">Review</span>
    return <span className="badge badge-ok">Confirmed</span>
  }

  return (
    <div className="p-5 max-w-6xl">

      <div className="page-header mb-5">
        <h2 className="font-display font-extrabold text-3xl text-text mb-1">Management</h2>
        <p className="text-sm text-text-muted">Count session history · Production capture · Variance analysis · BHW</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-4">
          <div className="font-display font-bold text-[28px] text-text">{sessions.length}</div>
          <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mt-1">Total sessions</div>
        </div>
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-4">
          <div className="font-display font-bold text-[28px] text-ok">{completedCount}</div>
          <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mt-1">Completed</div>
        </div>
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-4">
          <div className="font-display font-bold text-[28px] text-warn">{reviewCount}</div>
          <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mt-1">Needs review</div>
        </div>
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-4">
          <div className="font-display font-bold text-[28px] text-info">{pendingCount}</div>
          <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mt-1">Pending</div>
        </div>
      </div>

      <div className="flex border border-surface-rule rounded-xl overflow-hidden w-fit mb-5">
        {(['count','production'] as const).map((m, i) => (
          <button
            key={m}
            onClick={() => setModule(m)}
            className={`px-5 py-2 font-display font-bold text-[14px] transition-colors ${
              i > 0 ? 'border-l border-surface-rule' : ''
            } ${module === m ? 'bg-brand text-white' : 'bg-surface-card text-text-muted hover:text-text'}`}
          >
            {m === 'count' ? 'Morning count' : 'Production capture'}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">From</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-1.5 border border-surface-rule rounded-lg font-mono text-xs text-text bg-surface-card outline-none focus:border-accent"/>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">To</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-3 py-1.5 border border-surface-rule rounded-lg font-mono text-xs text-text bg-surface-card outline-none focus:border-accent"/>
        </div>
        {loading && <span className="font-mono text-[11px] text-text-faint animate-pulse">Loading…</span>}
      </div>

      {/* COUNT MODULE */}
      {module === 'count' && (
        <>
          <div className="flex border border-surface-rule rounded-xl overflow-hidden w-fit mb-4">
            {([
              { key:'all',     label:'All sessions' },
              { key:'review',  label:`Review (${reviewCount})` },
              { key:'pending', label:`Pending (${pendingCount})` },
            ] as const).map((f, i) => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`px-4 py-2 font-body text-sm font-medium transition-colors ${i > 0 ? 'border-l border-surface-rule' : ''} ${filter === f.key ? 'bg-brand text-white' : 'bg-surface-card text-text-muted hover:text-text'}`}>
                {f.label}
              </button>
            ))}
          </div>

          <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-surface-rule">
              <span className="font-display font-bold text-[15px] text-text">Count sessions</span>
              <button onClick={exportCSV} className="flex items-center gap-1.5 text-xs text-ok font-semibold hover:underline">
                <Download size={12}/> Export CSV
              </button>
            </div>
            {loading ? (
              <div className="p-8 text-center text-text-muted text-sm animate-pulse">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-text-muted text-sm">No sessions match this filter.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-surface border-b border-surface-rule">
                      {['Date','Supervisor','Sup. kg','Admin','Admin kg','Match rate','Status',''].map(h => (
                        <th key={h} className="px-5 py-2.5 font-mono text-[10px] uppercase tracking-wide text-text-muted whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-rule">
                    {filtered.map(s => (
                      <tr key={s.id} className="hover:bg-surface transition-colors">
                        <td className="px-5 py-3 font-mono text-xs font-semibold whitespace-nowrap">
                          {format(new Date(s.count_date + 'T12:00:00'), 'd MMM yyyy')}
                        </td>
                        <td className="px-5 py-3 text-text-muted text-xs">{s.sup_name ?? '—'}</td>
                        <td className="px-5 py-3 font-mono text-xs">{s.sup_total_kg != null ? `${Math.round(s.sup_total_kg).toLocaleString()} kg` : '—'}</td>
                        <td className="px-5 py-3 text-text-muted text-xs">{s.adm_name ?? '—'}</td>
                        <td className="px-5 py-3 font-mono text-xs">{s.adm_total_kg != null ? `${Math.round(s.adm_total_kg).toLocaleString()} kg` : '—'}</td>
                        <td className="px-5 py-3 font-mono text-xs">
                          {s.match_rate_pct != null
                            ? <span className={s.match_rate_pct < 90 ? 'text-warn font-bold' : 'text-ok'}>{Math.round(s.match_rate_pct)}%</span>
                            : '—'}
                        </td>
                        <td className="px-5 py-3">{statusPill(s)}</td>
                        <td className="px-5 py-3">
                          {s.adm_confirmed_at && s.sup_confirmed_at ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <button onClick={() => setViewSession({ id: s.id, date: s.count_date })}
                                className="flex items-center gap-1 text-[11px] text-info hover:underline font-semibold">
                                <Eye size={12}/> Compare
                              </button>
                              {s.match_rate_pct != null && s.match_rate_pct < 95 && (
                                <button onClick={() => router.push(`/count?recount=1&date=${s.count_date}`)}
                                  className="flex items-center gap-1 text-[11px] text-warn bg-warn/10 border border-warn/30 px-2 py-0.5 rounded-lg font-semibold hover:bg-warn/20 transition-colors">
                                  Recount
                                </button>
                              )}
                            </div>
                          ) : <span className="text-[11px] text-text-faint">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* PRODUCTION MODULE */}
      {module === 'production' && (
        <ProductionSessionsTable dateFrom={dateFrom} dateTo={dateTo}/>
      )}

      {/* Compare overlay */}
      {viewSession && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center p-0 lg:p-6">
          <div className="bg-surface w-full lg:max-w-3xl lg:rounded-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-surface-card border-b border-surface-rule px-4 py-3 flex items-center justify-between">
              <span className="font-display font-bold text-base text-text">Count comparison</span>
              <button onClick={() => setViewSession(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface transition-colors">
                <X size={16} className="text-text-muted"/>
              </button>
            </div>
            <div className="p-4">
              <CountCompareView sessionId={viewSession.id} date={viewSession.date} onClose={() => setViewSession(null)}/>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}