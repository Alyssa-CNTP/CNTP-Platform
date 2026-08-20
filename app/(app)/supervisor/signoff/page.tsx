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
// which by definition need nothing) — that moved to the Dashboard.
//
// The queue is tiered by how much it's actually the viewer's job, not just
// concatenated in discovery order — that was the "bombarded" version, five
// equally loud colored boxes stacked regardless of whether the thing was the
// viewer's to sign:
//
//   1. Waiting for your signature — capture records submitted + shift reports
//      needing this viewer's action. One card, sub-grouped, top of the page.
//   2. Needs a decision — reopen requests, pasteuriser job-card approvals.
//   3. Records still open from a finished shift — nobody's signature yet,
//      just a flag that someone else's record needs finishing or archiving.
//      Quietest styling of the three: it's visibility, not a task for the
//      viewer.
//
// Records from every date are listed, oldest first — a session left unsigned
// last Thursday was previously invisible here because the queue only looked at
// today, which is exactly how it went unnoticed.
//
// Archiving a record on Production Orders auto-declines any pending reopen
// request against it (see app/api/production/orders/[id]/route.ts) — before
// that guard existed, an archived record could keep showing up here forever
// via a request that never got resolved. ReopenRequestsPanel also filters
// defensively against the session's own deleted_at for any request created
// before the guard shipped.

interface Pending {
  id: string; section_id: string; date: string; shift: string
  operators: string[]; submitted_at: string | null; status: string
}
interface ReportRow { date: string; shift: string; status: string; submitted_by_name: string | null }

// The queue has no natural ceiling — every unsigned record from every date
// stays on it forever, which is exactly right for not losing one, but wrong
// for "what do I look at right now": weeks of backlog reads as noise, not a
// queue. Default to a 7-day window; the full backlog is one click away, never
// hidden for good.
const WINDOW_OPTIONS = [
  { value: 7 as const,     label: '7 days' },
  { value: 30 as const,    label: '30 days' },
  { value: 'all' as const, label: 'All time' },
]
type WindowDays = typeof WINDOW_OPTIONS[number]['value']

function cutoffDate(today: string, days: number) {
  const d = new Date(today + 'T12:00:00')
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

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
  const [windowDays, setWindowDays] = useState<WindowDays>(7)

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

  const actionableReports = reports.filter(r => (r.status === 'submitted' && canApproveReport) || (r.status === 'draft' && canSubmitReport))
  const total = submitted.length + stale.length + reopenCount + actionableReports.length
  const allClear = !loading && total === 0

  // reopenCount and job-card approvals aren't windowed — a decision queue
  // doesn't get less urgent with age, so it's excluded from both totals below.
  const today = sastToday()
  const cutoff = windowDays === 'all' ? null : cutoffDate(today, windowDays)
  const inWindow = (d: string) => !cutoff || d >= cutoff
  const submittedVisible = submitted.filter(s => inWindow(s.date))
  const staleVisible = stale.filter(s => inWindow(s.date))
  const reportsVisible = actionableReports.filter(r => inWindow(r.date))
  const totalVisible = submittedVisible.length + staleVisible.length + reopenCount + reportsVisible.length
  const hiddenOlder = (submitted.length - submittedVisible.length) + (stale.length - staleVisible.length) + (actionableReports.length - reportsVisible.length)
  const windowLabel = WINDOW_OPTIONS.find(o => o.value === windowDays)!.label.toLowerCase()

  return (
    <div className="px-4 py-6 max-w-[900px] mx-auto space-y-4">
      <HubHeader
        title="Sign-off"
        subtitle={loading ? 'Checking what’s outstanding…'
          : total === 0 ? 'Nothing outstanding'
          : totalVisible === 0 ? `Nothing in the last ${windowLabel} — ${total} further back`
          : `${totalVisible} thing${totalVisible === 1 ? '' : 's'} waiting on a signature`
            + (hiddenOlder > 0 ? ` · ${hiddenOlder} more further back` : '')}
        action={
          <button onClick={load} className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      {!loading && !allClear && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-text-faint">Show:</span>
          {WINDOW_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setWindowDays(opt.value)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                windowDays === opt.value ? 'bg-brand text-white border-brand' : 'border-stone-200 text-text-muted hover:border-brand hover:text-brand'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      )}

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
          {/* Everything that is quite literally waiting on the viewer's own
              signature lives in ONE card, oldest first within each kind — this
              used to be two separate colored boxes (records, then reports)
              competing for attention; now it's one queue with sub-groups. */}
          {(submittedVisible.length > 0 || reportsVisible.length > 0) && (
            <QueueCard
              count={submittedVisible.length + reportsVisible.length} icon={PenLine}
              title="Waiting for your signature"
              hint="Oldest first — open one to review and sign it off.">
              {submittedVisible.length > 0 && (
                <>
                  {reportsVisible.length > 0 && <GroupLabel>Capture records</GroupLabel>}
                  {submittedVisible.map(s => <SessionRow key={s.id} s={s} tab="signoff" />)}
                </>
              )}
              {reportsVisible.length > 0 && (
                <>
                  {submittedVisible.length > 0 && <GroupLabel>Shift reports</GroupLabel>}
                  {reportsVisible.map(r => (
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
                </>
              )}
            </QueueCard>
          )}

          {/* Decisions (approve/reject), not signatures — a distinct action but
              still something only the viewer can resolve, so it sits right
              under the signature queue rather than mixed into it. */}
          <ReopenRequestsPanel onCountChange={setReopenCount} />
          {canApproveJobCards && <JobCardApprovalsPanel />}

          {/* Lowest priority: records nobody has even submitted yet. This isn't
              the viewer's signature to give — it's a flag that someone else's
              record needs finishing or archiving — so it reads much quieter
              than the queues above instead of matching their visual weight. */}
          {staleVisible.length > 0 && (
            <div className="rounded-xl border border-stone-200 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-stone-50 border-b border-stone-200">
                <Pen size={13} className="text-stone-400 shrink-0" />
                <span className="font-body font-semibold text-[12.5px] text-stone-500">
                  {staleVisible.length} record{staleVisible.length === 1 ? '' : 's'} still open from a finished shift
                </span>
              </div>
              <p className="px-4 pt-2 text-[11px] text-text-muted">
                Never submitted for sign-off — not yours to sign, but worth chasing. Finish and submit, or archive the record on Production Orders.
              </p>
              <div className="divide-y divide-stone-100">
                {staleVisible.map(s => <SessionRow key={s.id} s={s} tab="capture" />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function QueueCard({ count, icon: Icon, title, hint, children }: {
  count: number; icon: React.ElementType
  title: string; hint: string; children: React.ReactNode
}) {
  return (
    <div className="border-2 rounded-2xl overflow-hidden bg-info/5 border-info/40">
      <div className="flex items-start gap-2 px-4 py-3 border-b border-info/20">
        <span className="w-7 h-7 rounded-full bg-info text-white flex items-center justify-center font-display font-bold text-[13px] shrink-0">{count}</span>
        <Icon size={16} className="text-info shrink-0 mt-1" />
        <div className="min-w-0">
          <div className="font-display font-bold text-[15px] text-info">{title}</div>
          <div className="text-[11px] text-text-muted mt-0.5">{hint}</div>
        </div>
      </div>
      <div className="divide-y divide-info/15">{children}</div>
    </div>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-2.5 pb-1 font-mono text-[10px] uppercase tracking-wide text-text-faint bg-white/40">
      {children}
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
      {/* Age is the point of an oldest-first queue — say it out loud. But with
          weeks of backlog possible, flagging every 3-day-old row red made the
          whole queue read as on fire — reserve red for genuinely stale (30d+),
          amber for a week or more, and a plain neutral pill under that. */}
      {!isToday && ageDays > 0 && (
        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg shrink-0 ${
          ageDays >= 30 ? 'bg-err/10 text-err' : ageDays >= 7 ? 'bg-warn/10 text-warn' : 'bg-stone-100 text-stone-500'}`}>
          {ageDays >= 30 && <AlertTriangle size={10} />}
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
