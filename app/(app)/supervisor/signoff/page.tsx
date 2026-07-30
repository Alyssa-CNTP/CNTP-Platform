'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import {
  PenLine, ChevronRight, RefreshCw, Loader2, CheckCircle2, Clock, Pen,
  Users, AlertTriangle, FileText,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { sectionMeta } from '@/lib/production/capture-config'
import { SHIFT_LABEL, sastToday } from '@/lib/production/shifts'
import { HubHeader } from '@/components/supervisor/HubTabs'
import { ReopenRequestsPanel } from '@/components/supervisor/ReopenRequestsPanel'
import { JobCardApprovalsPanel } from '@/components/production/JobCardApprovalsPanel'

// Supervisor Hub → Sign-off. This tab is a QUEUE, not a dashboard: it shows only
// what is still outstanding, and it empties as things get signed. It used to
// also carry a "lines this shift" board (including lines already signed off,
// which by definition need nothing) — that moved to the Dashboard, so this page
// is now exactly the list of things waiting on a signature:
//
//   • capture records submitted and waiting for a supervisor signature
//   • capture records still open on a shift that has already ended
//   • pasteuriser job cards sent for approval
//   • reopen requests waiting for a Production Manager decision
//   • the shift report waiting to be sent up or signed off
//
// Records from every date are listed, oldest first — a session left unsigned
// last Thursday was previously invisible here because the queue only looked at
// today, which is exactly how it went unnoticed.

interface Pending {
  id: string; section_id: string; date: string; shift: string
  operators: string[]; submitted_at: string | null; status: string
}
interface ReportRow { date: string; shift: string; status: string; submitted_by_name: string | null }

export default function SupervisorSignoff() {
  const { p, isFullAdmin } = useAuth()
  const canApproveJobCards = isFullAdmin || p('can_approve_job_cards')
  const canApproveReport   = isFullAdmin || p('can_approve_shift_report')
  const canSubmitReport    = isFullAdmin || p('can_submit_shift_report')

  const [submitted, setSubmitted] = useState<Pending[]>([])
  const [stale, setStale]         = useState<Pending[]>([])
  const [reports, setReports]     = useState<ReportRow[]>([])
  const [reopenCount, setReopenCount] = useState(0)
  const [loading, setLoading]     = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const db = getDb().schema('production')
    const today = sastToday()

    const [subRes, openRes] = await Promise.all([
      db.from('prod_sessions')
        .select('id,section_id,date,shift,status,operator_names,submitted_at')
        .eq('status', 'submitted').is('deleted_at', null)
        .order('submitted_at', { ascending: true }).limit(100),
      // Records still in progress on a shift that has already finished. A draft
      // from today's live shift is not outstanding — it is simply still running.
      db.from('prod_sessions')
        .select('id,section_id,date,shift,status,operator_names,submitted_at')
        .eq('status', 'draft').is('deleted_at', null)
        .lt('date', today).order('date', { ascending: true }).limit(100),
    ])

    const map = (rows: any[] | null): Pending[] => (rows ?? []).map(s => ({
      id: s.id, section_id: s.section_id, date: s.date, shift: s.shift,
      operators: s.operator_names ?? [], submitted_at: s.submitted_at, status: s.status,
    }))
    setSubmitted(map(subRes.data as any[]))
    setStale(map(openRes.data as any[]))

    // Shift reports not yet signed off. Best-effort: the table lands with
    // migration 20260730_001, so on a database without it the query returns an
    // error rather than throwing — the queue still renders, just without this
    // section, instead of failing whole.
    const { data: repData, error: repErr } = await db.from('shift_reports')
      .select('date,shift,status,submitted_by_name')
      .neq('status', 'approved').order('date', { ascending: true }).limit(30)
    setReports(repErr ? [] : ((repData as ReportRow[]) ?? []))

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const total = submitted.length + stale.length + reopenCount
    + reports.filter(r => (r.status === 'submitted' && canApproveReport) || (r.status === 'draft' && canSubmitReport)).length
  const allClear = !loading && total === 0

  return (
    <div className="px-4 py-6 max-w-[900px] mx-auto space-y-4">
      <HubHeader
        title="Sign-off"
        subtitle={loading ? 'Checking what’s outstanding…'
          : total === 0 ? 'Nothing outstanding'
          : `${total} thing${total === 1 ? '' : 's'} waiting on a signature`}
        action={
          <button onClick={load} className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-24"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
      ) : allClear ? (
        <div className="text-center py-20 bg-ok/5 border border-ok/25 rounded-2xl">
          <CheckCircle2 size={30} className="mx-auto mb-3 text-ok" />
          <p className="font-display font-bold text-[16px] text-text">All caught up</p>
          <p className="text-[12px] text-text-muted mt-1">Nothing is waiting for your signature.</p>
          <Link href="/supervisor" className="text-[12px] text-brand hover:underline mt-3 inline-block">Back to the dashboard →</Link>
        </div>
      ) : (
        <>
          {/* Capture records submitted and waiting for a signature. */}
          {submitted.length > 0 && (
            <QueueCard
              tone="info" count={submitted.length} icon={PenLine}
              title="Capture records waiting for your signature"
              hint="Oldest first — open one to review the figures and sign it off.">
              {submitted.map(s => <SessionRow key={s.id} s={s} tab="signoff" />)}
            </QueueCard>
          )}

          {/* Still-open records from a shift that has ended. */}
          {stale.length > 0 && (
            <QueueCard
              tone="warn" count={stale.length} icon={Pen}
              title="Records still open from a finished shift"
              hint="Never submitted for sign-off. Finish and submit, or archive the record on Production Orders.">
              {stale.map(s => <SessionRow key={s.id} s={s} tab="capture" />)}
            </QueueCard>
          )}

          {/* Shift reports. Shown to whoever can act: the supervisor sees a draft
              to send up, the manager sees a submitted one to sign. */}
          {reports.filter(r => (r.status === 'submitted' && canApproveReport) || (r.status === 'draft' && canSubmitReport)).length > 0 && (
            <QueueCard
              tone="info"
              count={reports.filter(r => (r.status === 'submitted' && canApproveReport) || (r.status === 'draft' && canSubmitReport)).length}
              icon={FileText}
              title="Shift reports"
              hint="The end-of-shift record for the day.">
              {reports
                .filter(r => (r.status === 'submitted' && canApproveReport) || (r.status === 'draft' && canSubmitReport))
                .map(r => (
                  <Link key={`${r.date}-${r.shift}`} href={`/supervisor/report?date=${r.date}&shift=${r.shift}`}
                    className="flex items-center gap-3 px-4 py-3 bg-white/40 hover:bg-white transition-colors group">
                    <div className="w-8 h-8 rounded-lg bg-stone-700 flex items-center justify-center shrink-0">
                      <FileText size={14} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-body font-bold text-[14px] text-text truncate">
                        {format(parseISO(r.date + 'T12:00:00'), 'EEE d MMM')} · {SHIFT_LABEL[r.shift as 'morning'] ?? r.shift}
                      </div>
                      <div className="font-mono text-[11px] text-text-muted truncate">
                        {r.status === 'submitted'
                          ? `Sent by ${r.submitted_by_name || 'a supervisor'} — waiting for your sign-off`
                          : 'Draft — not sent to the Production Manager yet'}
                      </div>
                    </div>
                    <ChevronRight size={15} className="text-info shrink-0 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                ))}
            </QueueCard>
          )}

          {/* Reopen requests (decision tier only) and job-card approvals render
              their own cards and hide themselves when empty. */}
          <ReopenRequestsPanel onCountChange={setReopenCount} />
          {canApproveJobCards && <JobCardApprovalsPanel />}
        </>
      )}
    </div>
  )
}

function QueueCard({ tone, count, icon: Icon, title, hint, children }: {
  tone: 'info' | 'warn'; count: number; icon: React.ElementType
  title: string; hint: string; children: React.ReactNode
}) {
  const cls = tone === 'warn'
    ? { box: 'bg-warn/5 border-warn/40', head: 'border-warn/20', pill: 'bg-warn', text: 'text-warn', divide: 'divide-warn/15' }
    : { box: 'bg-info/5 border-info/40', head: 'border-info/20', pill: 'bg-info', text: 'text-info', divide: 'divide-info/15' }
  return (
    <div className={`border-2 rounded-2xl overflow-hidden ${cls.box}`}>
      <div className={`flex items-start gap-2 px-4 py-3 border-b ${cls.head}`}>
        <span className={`w-7 h-7 rounded-full ${cls.pill} text-white flex items-center justify-center font-display font-bold text-[13px] shrink-0`}>{count}</span>
        <Icon size={16} className={`${cls.text} shrink-0 mt-1`} />
        <div className="min-w-0">
          <div className={`font-display font-bold text-[15px] ${cls.text}`}>{title}</div>
          <div className="text-[11px] text-text-muted mt-0.5">{hint}</div>
        </div>
      </div>
      <div className={`divide-y ${cls.divide}`}>{children}</div>
    </div>
  )
}

function SessionRow({ s, tab }: { s: Pending; tab: 'signoff' | 'capture' }) {
  const m = sectionMeta(s.section_id)
  const today = sastToday()
  const isToday = s.date === today
  const href = `/production/capture/${s.section_id}?date=${s.date}&shift=${s.shift}`
    + `${tab === 'signoff' ? '&tab=signoff' : ''}&return=${encodeURIComponent('/supervisor/signoff')}`
  const ageDays = Math.round((new Date(today + 'T12:00:00').getTime() - new Date(s.date + 'T12:00:00').getTime()) / 86_400_000)
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 bg-white/40 hover:bg-white transition-colors group">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
        <span className="font-mono font-bold text-[9px] text-white">{m.code}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-body font-bold text-[14px] text-text truncate">{m.name}</div>
        <div className="font-mono text-[11px] text-text-muted truncate flex items-center gap-1">
          <Users size={10} className="shrink-0" />
          {format(parseISO(s.date + 'T12:00:00'), 'EEE d MMM')} · <span className="capitalize">{s.shift}</span>
          {s.operators.length ? ` · ${s.operators.join(', ')}` : ''}
        </div>
      </div>
      {/* Age is the point of an oldest-first queue — say it out loud. */}
      {!isToday && ageDays > 0 && (
        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg shrink-0 ${ageDays >= 3 ? 'bg-err/10 text-err' : 'bg-stone-100 text-stone-500'}`}>
          {ageDays >= 3 && <AlertTriangle size={10} />}
          {ageDays}d old
        </span>
      )}
      {s.submitted_at && (
        <span className="hidden sm:inline-flex items-center gap-1 font-mono text-[10px] text-text-muted shrink-0">
          <Clock size={10} /> {format(parseISO(s.submitted_at), 'd MMM HH:mm')}
        </span>
      )}
      <ChevronRight size={15} className="text-stone-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
    </Link>
  )
}
