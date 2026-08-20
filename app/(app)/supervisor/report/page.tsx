'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { format, parseISO, subDays, addDays } from 'date-fns'
import {
  FileText, Printer, RefreshCw, Loader2, Send, BadgeCheck, Undo2, Save,
  AlertTriangle, CheckCircle2, Users, Scale, Factory, Wrench, Gauge, Settings2,
  ArrowLeftRight, ClipboardCheck, Trash2, MessageSquare, ChevronLeft, ChevronRight,
  History, PenLine, Clock,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { sastToday, currentShift, SHIFT_LABEL } from '@/lib/production/shifts'
import { HubHeader } from '@/components/supervisor/HubTabs'
import {
  hoursLabel, sastTime, sastDateTime, STATUS_LABEL,
  type ShiftReport, type ShiftReportStatus,
} from '@/lib/production/shift-report'
import { Collapse } from '@/components/production/ui/kit'

// Supervisor Hub → Shift Report.
//
// The document the floor never had: one auditable record of everything that
// happened on a shift, generated rather than typed. Every number is derived from
// records already captured (capture + mass balance, bagging rows, timesheets,
// the checks engine, maintenance job cards, the roster and leave) — see
// app/api/production/shift-report/route.ts. The only thing a human writes here
// is the notes box; everything else is read.
//
// Lifecycle: generated (draft) → sent to the Production Manager (submitted) →
// signed off (approved). Submitting or signing freezes the payload the reader
// actually looked at into production.shift_reports, and writes an audit row, so
// a later recapture can't silently rewrite a report someone already signed.

export default function ShiftReportPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24"><Loader2 size={22} className="animate-spin text-stone-300" /></div>}>
      <ShiftReportInner />
    </Suspense>
  )
}

function ShiftReportInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { p, isFullAdmin } = useAuth()

  const canEdit    = isFullAdmin || p('can_edit_shift_report')
  const canSubmit  = isFullAdmin || p('can_submit_shift_report')
  const canApprove = isFullAdmin || p('can_approve_shift_report')

  // Date + shift live in the URL so a report is linkable — the Sign-off queue
  // and the dashboard both deep-link straight to a specific shift.
  const date  = params.get('date')  || sastToday()
  const shift = (params.get('shift') === 'afternoon' || params.get('shift') === 'night') ? 'afternoon'
    : params.get('shift') === 'morning' ? 'morning'
    : currentShift()

  const [report, setReport]   = useState<ShiftReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [notes, setNotes]     = useState('')
  const [busy, setBusy]       = useState<null | 'save' | 'submit' | 'approve' | 'reopen'>(null)
  const [saved, setSaved]     = useState(false)

  function go(nextDate: string, nextShift: string) {
    router.push(`/supervisor/report?date=${nextDate}&shift=${nextShift}`)
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/production/shift-report?date=${date}&shift=${shift}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `Error ${res.status}`)
      setReport(json as ShiftReport)
      setNotes(json?.record?.supervisorNotes ?? '')
    } catch (e: any) {
      setError(e?.message ?? 'Could not build the shift report')
      setReport(null)
    }
    setLoading(false)
  }, [date, shift])

  useEffect(() => { load() }, [load])

  async function act(action: 'save' | 'submit' | 'approve' | 'reopen') {
    if (!report) return
    setBusy(action); setError(null)
    try {
      const res = await fetch('/api/production/shift-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action, date, shift,
          // Post the payload actually on screen — that is what gets frozen.
          payload: { ...report, record: undefined },
          supervisorNotes: notes,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `Error ${res.status}`)
      setReport(r => r ? { ...r, record: { ...r.record, ...json, trail: r.record.trail } } : r)
      if (action === 'save') { setSaved(true); setTimeout(() => setSaved(false), 2500) }
      // Reload after a status change so the audit trail below is current.
      if (action !== 'save') load()
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the report')
    }
    setBusy(null)
  }

  const status: ShiftReportStatus = report?.record.status ?? 'draft'
  const locked = status === 'approved'

  return (
    <div className="px-4 py-6 max-w-[1050px] mx-auto space-y-5 print-full-width">
      <div className="no-print space-y-4">
        <HubHeader
          title="Shift Report"
          subtitle="Everything that happened on the shift — generated from what the floor captured"
          action={
            <div className="flex items-center gap-2">
              <button onClick={load} className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text">
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Regenerate
              </button>
              <button onClick={() => window.print()} disabled={!report}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[12px] text-stone-600 hover:border-brand hover:text-brand disabled:opacity-40 transition-colors">
                <Printer size={13} /> Print
              </button>
            </div>
          }
        />

        {/* Date + shift picker */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => go(format(subDays(parseISO(date + 'T12:00:00'), 1), 'yyyy-MM-dd'), shift)}
            className="p-2 rounded-lg border border-stone-200 text-stone-500 hover:border-brand hover:text-brand transition-colors" title="Previous day">
            <ChevronLeft size={14} />
          </button>
          <input type="date" value={date} max={sastToday()} onChange={e => e.target.value && go(e.target.value, shift)}
            className="px-3 py-2 rounded-lg border border-stone-200 text-[12px] font-mono outline-none focus:border-brand" />
          <button onClick={() => go(format(addDays(parseISO(date + 'T12:00:00'), 1), 'yyyy-MM-dd'), shift)}
            disabled={date >= sastToday()}
            className="p-2 rounded-lg border border-stone-200 text-stone-500 hover:border-brand hover:text-brand disabled:opacity-30 transition-colors" title="Next day">
            <ChevronRight size={14} />
          </button>
          <div className="flex gap-1 p-1 bg-stone-100 rounded-lg ml-1">
            {(['morning', 'afternoon'] as const).map(s => (
              <button key={s} onClick={() => go(date, s)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${shift === s ? 'bg-white text-brand shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
                {SHIFT_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <StatusPill status={status} />
        </div>

        {error && (
          <p className="flex items-center gap-2 text-[12px] text-err px-4 py-3 bg-err/5 border border-err/20 rounded-xl">
            <AlertTriangle size={13} className="shrink-0" /> {error}
          </p>
        )}
      </div>

      {loading && !report ? (
        <div className="flex items-center justify-center py-24"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
      ) : !report ? (
        <div className="text-center py-20 bg-surface-card border border-surface-rule rounded-2xl">
          <FileText size={28} className="mx-auto mb-3 text-stone-200" />
          <p className="font-mono text-[12px] text-stone-400">No report could be built for this shift.</p>
        </div>
      ) : (
        <>
          <ReportHeader report={report} />
          <Headline report={report} />
          <Attendance report={report} />
          <Lines report={report} />
          <Outputs report={report} />
          <Throughput report={report} />
          <MachineConfig report={report} />
          <Changeovers report={report} />
          <Breakdowns report={report} />
          <Checks report={report} />
          <Waste report={report} />
          <Notes report={report} />
          <Outstanding report={report} />

          {/* Supervisor notes — the only thing typed on this page. */}
          <Section title="Supervisor notes" icon={PenLine}>
            {canEdit && !locked ? (
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
                placeholder="Anything the numbers don't say — a decision taken, a customer instruction, something to watch on the next shift."
                className="no-print w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand resize-none" />
            ) : (
              <p className="text-[13px] text-text whitespace-pre-wrap">{notes || <span className="text-stone-400">No notes added.</span>}</p>
            )}
            {/* The printed report shows the notes as text, never as a form field. */}
            {canEdit && !locked && (
              <p className="print-only text-[13px] text-text whitespace-pre-wrap mt-2">{notes || '—'}</p>
            )}
          </Section>

          <SignOff report={report} status={status} notes={notes}
            canEdit={canEdit} canSubmit={canSubmit} canApprove={canApprove}
            busy={busy} saved={saved} onAct={act} />

          {!!report.gaps.length && (
            <div className="report-section bg-warn/5 border border-warn/30 rounded-xl px-4 py-3 space-y-1">
              <p className="font-body font-semibold text-[12px] text-warn">Could not be read for this shift</p>
              {report.gaps.map((g, i) => (
                <p key={i} className="flex items-start gap-2 text-[12px] text-warn">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {g}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Shared layout pieces ─────────────────────────────────────────────────────

function StatusPill({ status }: { status: ShiftReportStatus }) {
  const meta = status === 'approved' ? { cls: 'bg-ok/10 text-ok', icon: BadgeCheck, label: 'Signed off' }
    : status === 'submitted' ? { cls: 'bg-info/10 text-info', icon: Send, label: 'Sent for sign-off' }
    : { cls: 'bg-stone-100 text-stone-500', icon: FileText, label: 'Draft' }
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-full ${meta.cls}`}>
      <meta.icon size={12} /> {meta.label}
    </span>
  )
}

function Section({ title, icon: Icon, hint, count, children, breakBefore }: {
  title: string; icon: React.ElementType; hint?: string; count?: number
  children: React.ReactNode; breakBefore?: boolean
}) {
  return (
    <div className={`report-section bg-surface-card border border-surface-rule rounded-2xl overflow-hidden ${breakBefore ? 'report-break' : ''}`}>
      <div className="flex items-baseline gap-2 px-4 py-3 border-b border-surface-rule bg-surface">
        <Icon size={14} className="text-text-muted shrink-0 self-center" />
        <span className="font-display font-bold text-[14px] text-text">{title}</span>
        {count !== undefined && <span className="font-mono text-[11px] text-text-muted">{count}</span>}
        {hint && <span className="text-[11px] text-text-muted ml-auto text-right">{hint}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) =>
  <p className="text-[12px] text-stone-400">{children}</p>

// A plain table — deliberately the same on screen and on paper, so the printed
// report is a document rather than a screenshot of the app.
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-surface-rule">
            {head.map((h, i) => (
              <th key={h} className={`py-1.5 font-mono text-[9px] font-semibold text-text-muted uppercase tracking-wide ${i ? 'pl-3' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-rule">{children}</tbody>
      </table>
    </div>
  )
}
const Td = ({ children, mono, right, className = '' }: {
  children: React.ReactNode; mono?: boolean; right?: boolean; className?: string
}) => (
  <td className={`py-2 pl-3 first:pl-0 text-[12px] text-text align-top ${mono ? 'font-mono' : ''} ${right ? 'text-right' : ''} ${className}`}>
    {children}
  </td>
)

// Only linkable when the name matched someone on the roster (see
// lib/production/shift-report-builder.ts) — an unrostered swap has no
// employee id to link to, so it stays plain text rather than a dead link.
// Reads as plain text on paper either way; a disclosure link means nothing
// on a printed page.
const PersonName = ({ name, employeeId }: { name: string; employeeId: string | null }) =>
  employeeId ? (
    <Link href={`/production/staff/${employeeId}`} className="text-brand hover:underline print:text-text print:no-underline">
      {name}
    </Link>
  ) : <>{name}</>

// ── Report sections ──────────────────────────────────────────────────────────

function ReportHeader({ report }: { report: ShiftReport }) {
  const m = report.meta
  return (
    <div className="report-section bg-surface-card border border-surface-rule rounded-2xl px-5 py-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display font-bold text-[20px] text-text leading-tight">
            Shift Report — {format(parseISO(m.date + 'T12:00:00'), 'EEEE d MMMM yyyy')}
          </h2>
          <p className="text-[12px] text-text-muted mt-1">
            {m.shiftLabel} shift · {m.shiftWindow}
            {m.rosterShiftLabel ? ` · ${m.rosterShiftLabel}` : ''}
            {m.rosterPeriodName ? ` · roster ${m.rosterPeriodName}` : ''}
          </p>
          {m.supervisorNames.length > 0 && (
            <p className="text-[12px] text-text-muted">Supervisor{m.supervisorNames.length > 1 ? 's' : ''}: {m.supervisorNames.join(', ')}</p>
          )}
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide">Generated</p>
          <p className="font-mono text-[12px] text-text">{sastDateTime(m.generatedAt)} SAST</p>
        </div>
      </div>
    </div>
  )
}

function Headline({ report }: { report: ShiftReport }) {
  const h = report.headline
  const tiles = [
    { label: 'Lines run', value: String(h.linesRun), icon: Factory },
    { label: 'Tons out', value: h.tonsOut.toFixed(2), icon: Scale },
    { label: 'kg in', value: h.totalInputKg.toLocaleString(), icon: Scale },
    { label: 'Yield', value: h.yieldPct != null ? `${h.yieldPct}%` : '—', icon: Gauge },
    { label: 'On the floor', value: `${h.peoplePresent}/${h.peopleRostered || h.peoplePresent}`, icon: Users },
    { label: 'Breakdowns', value: String(h.breakdowns), icon: Wrench, warn: h.breakdowns > 0 },
    { label: 'Downtime', value: hoursLabel(h.downtimeMinutes), icon: Clock, warn: h.downtimeMinutes > 0 },
    { label: 'Balance flags', value: String(h.balanceFlags), icon: AlertTriangle, warn: h.balanceFlags > 0 },
  ]
  return (
    <div className="report-section grid grid-cols-2 sm:grid-cols-4 gap-3">
      {tiles.map(t => (
        <div key={t.label} className="bg-surface-card border border-surface-rule rounded-xl p-3.5">
          <t.icon size={13} className={`mb-2 ${t.warn ? 'text-warn' : 'text-text-muted'}`} />
          <div className={`font-display font-bold text-[20px] leading-none ${t.warn ? 'text-warn' : 'text-text'}`}>{t.value}</div>
          <div className="font-mono text-[9px] text-text-muted uppercase tracking-wide mt-1">{t.label}</div>
        </div>
      ))}
    </div>
  )
}

function Attendance({ report }: { report: ShiftReport }) {
  const a = report.attendance
  return (
    <Section title="Who was here" icon={Users}
      hint={`${a.present.length} on the floor · ${hoursLabel(a.totalWorkedMinutes)} worked`}>
      {a.present.length === 0 && a.rostered.length === 0 ? (
        <Empty>No roster and no timesheets for this shift.</Empty>
      ) : (
        <Collapse label="Present / absent detail" count={a.present.length} defaultOpen printOpen>
        <div className="space-y-4">
          {a.present.length > 0 && (
            <Table head={['Person', 'Line(s)', 'On', 'Off', 'Breaks', 'Worked', 'Timesheet']}>
              {a.present.map(pp => (
                <tr key={pp.personName}>
                  <Td><PersonName name={pp.personName} employeeId={pp.employeeId} /></Td>
                  <Td mono>{pp.sectionIds.length ? pp.sectionIds.join(', ') : '—'}</Td>
                  <Td mono>{sastTime(pp.firstIn)}</Td>
                  <Td mono>{sastTime(pp.lastOut)}</Td>
                  <Td mono>{pp.breakMinutes ? `${pp.breakMinutes}m` : '—'}</Td>
                  <Td mono>{pp.workedMinutes ? hoursLabel(pp.workedMinutes) : '—'}</Td>
                  <Td>
                    {pp.confirmed
                      ? <span className="inline-flex items-center gap-1 text-[11px] text-ok"><CheckCircle2 size={11} /> Confirmed</span>
                      : <span className="text-[11px] text-warn">Not confirmed</span>}
                  </Td>
                </tr>
              ))}
            </Table>
          )}

          {/* Absence is the half of attendance that used to only exist verbally. */}
          {a.absent.length > 0 && (
            <div>
              <p className="font-mono text-[10px] text-warn uppercase tracking-wide mb-1.5">
                Rostered but not on the floor — {a.absent.length}
              </p>
              <Table head={['Person', 'Role', 'Reason']}>
                {a.absent.map(x => (
                  <tr key={x.personName}>
                    <Td><PersonName name={x.personName} employeeId={x.employeeId} /></Td>
                    <Td>{x.roleName}</Td>
                    <Td>
                      {x.reason === 'leave'
                        ? <span className="text-amber-700">On {x.leaveKind ?? 'leave'}{x.leaveNote ? ` — ${x.leaveNote}` : ''}</span>
                        : <span className="text-warn">No timesheet and no capture record — unexplained</span>}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}

          {a.unrostered.length > 0 && (
            <div>
              <p className="font-mono text-[10px] text-info uppercase tracking-wide mb-1.5">
                On the floor but not rostered — {a.unrostered.length}
              </p>
              <Table head={['Person', 'Line(s)', 'Worked']}>
                {a.unrostered.map(x => (
                  <tr key={x.personName}>
                    <Td><PersonName name={x.personName} employeeId={x.employeeId} /></Td>
                    <Td mono>{x.sectionIds.join(', ') || '—'}</Td>
                    <Td mono>{x.workedMinutes ? hoursLabel(x.workedMinutes) : '—'}</Td>
                  </tr>
                ))}
              </Table>
              <p className="text-[11px] text-text-muted mt-1.5">
                A swap that wasn&apos;t written down — update the roster so next week&apos;s rotation is right.
              </p>
            </div>
          )}
        </div>
        </Collapse>
      )}
    </Section>
  )
}

function Lines({ report }: { report: ShiftReport }) {
  return (
    <Section title="Lines run" icon={Factory} count={report.lines.length}>
      {report.lines.length === 0 ? <Empty>Nothing was captured on this shift.</Empty> : (
        <Table head={['Line', 'Record', 'Variant / lot', 'PO', 'Operators', 'kg in', 'kg out', 'Yield', 'Balance', 'Status']}>
          {report.lines.map(l => (
            <tr key={l.sessionId}>
              <Td>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: l.colorHex }}>
                    <span className="font-mono font-bold text-[7px] text-white">{l.sectionCode}</span>
                  </span>
                  {l.sectionName}
                </span>
              </Td>
              <Td mono>{l.recordNo ?? '—'}</Td>
              <Td mono>{[l.variant, l.lotNumber].filter(Boolean).join(' · ') || '—'}</Td>
              <Td mono>{l.productionOrders.length ? l.productionOrders.join(', ') : '—'}</Td>
              <Td>{l.operatorNames.join(', ') || '—'}</Td>
              <Td mono right>{l.inputKg.toLocaleString()}</Td>
              <Td mono right>{l.outputKg.toLocaleString()}</Td>
              <Td mono right>{l.yieldPct != null ? `${l.yieldPct}%` : '—'}</Td>
              <Td mono right className={l.withinTolerance === false ? 'text-warn font-semibold' : ''}>
                {l.balanceKg == null ? '—' : `${l.balanceKg > 0 ? '+' : ''}${l.balanceKg}`}
                {l.withinTolerance === false && <span className="ml-1 text-[9px]">over ±{l.toleranceKg}</span>}
              </Td>
              <Td>{STATUS_LABEL[l.status] ?? l.status}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  )
}

function Outputs({ report }: { report: ShiftReport }) {
  const total = report.outputs.reduce((t, o) => t + o.kg, 0)
  return (
    <Section title="What was produced" icon={Scale}
      hint={total ? `${total.toLocaleString()} kg bagged across ${report.outputs.length} product${report.outputs.length === 1 ? '' : 's'}` : undefined}>
      {report.outputs.length === 0 ? <Empty>No output bags were captured on this shift.</Empty> : (
        <Table head={['Product', 'From line(s)', 'Bags', 'kg', 'Share of output']}>
          {report.outputs.map(o => (
            <tr key={o.productType}>
              <Td>{o.productType}</Td>
              <Td mono>{o.sections.map(s => report.lines.find(l => l.sectionId === s)?.sectionCode ?? s).join(', ')}</Td>
              <Td mono right>{o.bags}</Td>
              <Td mono right>{o.kg.toLocaleString()}</Td>
              <Td mono right>
                {o.sharePct != null ? (
                  <span className="inline-flex items-center gap-1.5 justify-end">
                    <span className="hidden sm:inline-block w-16 h-1.5 rounded-full bg-stone-100 overflow-hidden align-middle">
                      <span className="block h-full bg-brand" style={{ width: `${Math.min(100, o.sharePct)}%` }} />
                    </span>
                    {o.sharePct}%
                  </span>
                ) : '—'}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  )
}

function Throughput({ report }: { report: ShiftReport }) {
  return (
    <Section title="Machine throughput" icon={Gauge}
      hint="kg out per hour — from first to last bag where we have both, otherwise from confirmed hours">
      {report.throughput.length === 0 ? <Empty>No throughput to report — nothing was bagged.</Empty> : (
        <Table head={['Line', 'kg in', 'kg out', 'Ran for', 'Crew hours', 'kg / hour', 'Basis']}>
          {report.throughput.map(t => (
            <tr key={t.sectionId}>
              <Td>{t.sectionName}</Td>
              <Td mono right>{t.inputKg.toLocaleString()}</Td>
              <Td mono right>{t.outputKg.toLocaleString()}</Td>
              <Td mono right>{t.runMinutes != null ? hoursLabel(t.runMinutes) : '—'}</Td>
              <Td mono right>{t.workedMinutes ? hoursLabel(t.workedMinutes) : '—'}</Td>
              <Td mono right className="font-semibold">{t.kgPerHour != null ? t.kgPerHour.toLocaleString() : '—'}</Td>
              <Td>{t.basis === 'run' ? 'Run time' : t.basis === 'worked' ? 'Crew hours' : '—'}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  )
}

function MachineConfig({ report }: { report: ShiftReport }) {
  return (
    <Section title="Machine & sieving configuration" icon={Settings2}
      hint="The settings the line actually ran on, as recorded in the checks">
      {report.machineConfig.length === 0 ? <Empty>No checks were recorded for this shift, so no machine settings are on record.</Empty> : (
        <div className="space-y-4">
          {report.machineConfig.map(mc => (
            <div key={mc.sectionId}>
              <p className="font-body font-semibold text-[13px] text-text mb-1.5">{mc.sectionName}</p>
              {mc.sievingConfig && (
                <p className="text-[12px] text-text mb-1.5">
                  <span className="font-mono text-[10px] text-text-muted uppercase tracking-wide mr-1.5">Sieve config</span>
                  {mc.sievingConfig}
                </p>
              )}
              {mc.vsdHz.readings > 0 && (
                <p className="text-[12px] text-text mb-1.5">
                  <span className="font-mono text-[10px] text-text-muted uppercase tracking-wide mr-1.5">Infeed VSD</span>
                  avg {mc.vsdHz.avg} Hz · range {mc.vsdHz.min}–{mc.vsdHz.max} Hz · {mc.vsdHz.readings} hourly reading{mc.vsdHz.readings === 1 ? '' : 's'}
                </p>
              )}
              {mc.settings.length > 0 ? (
                <Table head={['Setting', 'Value', 'Recorded']}>
                  {mc.settings.map((s, i) => (
                    <tr key={`${s.label}-${i}`}>
                      <Td>{s.label}</Td>
                      <Td mono className={s.status === 'fail' ? 'text-err font-semibold' : s.status === 'flagged' ? 'text-warn font-semibold' : ''}>
                        {s.value}{s.unit ? ` ${s.unit}` : ''}
                      </Td>
                      <Td mono>{sastTime(s.at)}</Td>
                    </tr>
                  ))}
                </Table>
              ) : (
                !mc.sievingConfig && mc.vsdHz.readings === 0 && <Empty>No settings recorded for this line.</Empty>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function Changeovers({ report }: { report: ShiftReport }) {
  return (
    <Section title="Change-overs" icon={ArrowLeftRight} count={report.changeovers.length}>
      {report.changeovers.length === 0 ? <Empty>No change-overs were logged on this shift.</Empty> : (
        <Table head={['Time', 'Line', 'Who', 'What', 'Source']}>
          {report.changeovers.map((c, i) => (
            <tr key={`${c.sectionId}-${c.at}-${i}`}>
              <Td mono>{sastTime(c.at)}</Td>
              <Td>{c.sectionName}</Td>
              <Td>{c.personName ?? '—'}</Td>
              <Td>{c.detail ?? 'Change-over'}</Td>
              <Td mono className="text-text-muted">{c.source === 'timesheet' ? 'Timesheet' : 'Checks'}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  )
}

function Breakdowns({ report }: { report: ShiftReport }) {
  const bd = report.breakdowns.filter(b => b.workflow === 'breakdown')
  const planned = report.breakdowns.filter(b => b.workflow === 'planned')
  return (
    <Section title="Maintenance & downtime" icon={Wrench}
      hint={bd.length ? `${bd.length} breakdown${bd.length === 1 ? '' : 's'} · ${hoursLabel(report.headline.downtimeMinutes)} downtime` : undefined}>
      {report.breakdowns.length === 0 ? <Empty>No job cards were raised on this shift.</Empty> : (
        <div className="space-y-4">
          {bd.length > 0 && (
            <div>
              <p className="font-mono text-[10px] text-err uppercase tracking-wide mb-1.5">Breakdowns</p>
              <Table head={['Card', 'Area / machine', 'Fault', 'Raised', 'Technician', 'Closed', 'Downtime', 'Root cause']}>
                {bd.map(b => (
                  <tr key={b.cardId}>
                    <Td mono>{b.cardNo}</Td>
                    <Td>{b.area}{b.machine ? ` · ${b.machine}` : ''}</Td>
                    <Td>{b.description}</Td>
                    <Td mono>{sastTime(b.raisedAt)}</Td>
                    <Td>{b.assignedTo ?? '—'}</Td>
                    <Td mono>{b.completedAt ? sastTime(b.completedAt) : <span className="text-warn">still open</span>}</Td>
                    <Td mono right className="font-semibold">
                      {b.downtimeMinutes != null ? hoursLabel(b.downtimeMinutes) : '—'}
                      {b.stillOpen && <span className="block text-[9px] font-normal text-text-muted">to shift end</span>}
                    </Td>
                    <Td>{b.rootCause ?? '—'}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
          {planned.length > 0 && (
            <div>
              <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-1.5">Planned work</p>
              <Table head={['Card', 'Area / machine', 'Work', 'Raised', 'Technician', 'Status']}>
                {planned.map(b => (
                  <tr key={b.cardId}>
                    <Td mono>{b.cardNo}</Td>
                    <Td>{b.area}{b.machine ? ` · ${b.machine}` : ''}</Td>
                    <Td>{b.description}</Td>
                    <Td mono>{sastTime(b.raisedAt)}</Td>
                    <Td>{b.assignedTo ?? '—'}</Td>
                    <Td>{b.status.replace(/_/g, ' ')}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

function Checks({ report }: { report: ShiftReport }) {
  const anyFailures = report.checks.some(c => c.failures.length > 0)
  return (
    <Section title="Checks & quality" icon={ClipboardCheck}
      hint={report.headline.checksFailed ? `${report.headline.checksFailed} failed` : undefined}>
      {report.checks.length === 0 ? <Empty>No check records exist for this shift.</Empty> : (
        <div className="space-y-4">
          <Table head={['Line', 'Checks', 'OK', 'Flagged', 'Failed', 'N/A', 'Signed by', 'Verified by']}>
            {report.checks.map(c => (
              <tr key={c.sectionId}>
                <Td>{c.sectionName}</Td>
                <Td mono right>{c.total}</Td>
                <Td mono right>{c.ok}</Td>
                <Td mono right className={c.flagged ? 'text-warn font-semibold' : ''}>{c.flagged}</Td>
                <Td mono right className={c.failed ? 'text-err font-semibold' : ''}>{c.failed}</Td>
                <Td mono right>{c.na}</Td>
                <Td>{c.operatorName ?? '—'}</Td>
                <Td>{c.supervisorName ?? <span className="text-warn">not verified</span>}</Td>
              </tr>
            ))}
          </Table>

          {anyFailures && (
            <div>
              <p className="font-mono text-[10px] text-err uppercase tracking-wide mb-1.5">Flagged and failed checks</p>
              <Table head={['Time', 'Line', 'Check', 'Value', 'Reason', 'By']}>
                {report.checks.flatMap(c => c.failures.map((f, i) => (
                  <tr key={`${c.sectionId}-${i}`}>
                    <Td mono>{sastTime(f.at)}</Td>
                    <Td>{c.sectionName}</Td>
                    <Td className={f.status === 'fail' ? 'text-err font-medium' : 'text-warn font-medium'}>{f.label}</Td>
                    <Td mono>{f.value ? `${f.value}${f.unit ? ` ${f.unit}` : ''}` : '—'}</Td>
                    <Td>{f.reason ?? '—'}</Td>
                    <Td>{f.actorName ?? '—'}</Td>
                  </tr>
                )))}
              </Table>
            </div>
          )}

          {report.checks.filter(c => c.aiSummary).map(c => (
            <div key={`${c.sectionId}-ai`} className="px-3 py-2.5 bg-surface rounded-xl border border-surface-rule">
              <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-1">{c.sectionName} — shift audit summary</p>
              <p className="text-[12px] text-text whitespace-pre-wrap">{c.aiSummary}</p>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function Waste({ report }: { report: ShiftReport }) {
  return (
    <Section title="Waste & spillage" icon={Trash2}>
      {report.waste.length === 0 ? <Empty>No waste, spillage or extraction was recorded on this shift.</Empty> : (
        <Table head={['Line', 'Spillage kg', 'Dust extraction kg', 'Floor waste kg', 'Water kg']}>
          {report.waste.map(w => (
            <tr key={w.sectionId}>
              <Td>{w.sectionName}</Td>
              <Td mono right>{w.spillageKg || '—'}</Td>
              <Td mono right>{w.dustExtractionKg || '—'}</Td>
              <Td mono right>{w.floorWasteKg || '—'}</Td>
              <Td mono right>{w.waterKg || '—'}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  )
}

function Notes({ report }: { report: ShiftReport }) {
  return (
    <Section title="Handover notes & line messages" icon={MessageSquare} count={report.notes.length}>
      {report.notes.length === 0 ? <Empty>Nothing was written on the lines this shift.</Empty> : (
        <div className="space-y-2">
          {report.notes.map((n, i) => (
            <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-xl border border-surface-rule bg-surface">
              <span className={`font-mono text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${n.kind === 'handover' ? 'bg-info/10 text-info' : 'bg-stone-100 text-stone-500'}`}>
                {n.kind === 'handover' ? 'Handover' : 'Message'}
              </span>
              <div className="min-w-0">
                <p className="text-[12px] text-text whitespace-pre-wrap">{n.body}</p>
                <p className="font-mono text-[10px] text-text-muted mt-0.5">
                  {n.sectionName} · {n.author} · {sastTime(n.at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function Outstanding({ report }: { report: ShiftReport }) {
  if (report.outstanding.length === 0) {
    return (
      <div className="report-section flex items-center gap-2.5 bg-ok/5 border border-ok/25 rounded-2xl px-4 py-3">
        <CheckCircle2 size={16} className="text-ok shrink-0" />
        <span className="text-[13px] text-text"><span className="font-semibold">Every record on this shift is signed off.</span></span>
      </div>
    )
  }
  return (
    <Section title="Still outstanding" icon={AlertTriangle} count={report.outstanding.length}
      hint="These records are not signed off — the report can still be sent, but they are on it">
      <Table head={['Line', 'Status', 'What is needed']}>
        {report.outstanding.map(o => (
          <tr key={o.sessionId}>
            <Td>
              <Link href={`/production/capture/${o.sectionId}?date=${report.meta.date}&shift=${report.meta.shift}&return=${encodeURIComponent('/supervisor/report')}`}
                className="text-brand hover:underline">{o.sectionName}</Link>
            </Td>
            <Td>{STATUS_LABEL[o.status] ?? o.status}</Td>
            <Td>{o.reason}</Td>
          </tr>
        ))}
      </Table>
    </Section>
  )
}

function SignOff({ report, status, notes, canEdit, canSubmit, canApprove, busy, saved, onAct }: {
  report: ShiftReport
  status: ShiftReportStatus
  notes: string
  canEdit: boolean; canSubmit: boolean; canApprove: boolean
  busy: null | 'save' | 'submit' | 'approve' | 'reopen'
  saved: boolean
  onAct: (a: 'save' | 'submit' | 'approve' | 'reopen') => void
}) {
  const r = report.record
  const trail = r.trail ?? []
  const [showTrail, setShowTrail] = useState(false)

  const signatures = useMemo(() => ([
    { role: 'Generated by', name: r.generatedByName, at: r.generatedAt },
    { role: 'Sent by (Supervisor)', name: r.submittedByName, at: r.submittedAt },
    { role: 'Signed off by (Production Manager)', name: r.approvedByName, at: r.approvedAt },
  ]), [r])

  return (
    <div className="report-section bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-rule bg-surface">
        <BadgeCheck size={14} className="text-text-muted shrink-0" />
        <span className="font-display font-bold text-[14px] text-text">Sign-off</span>
        <span className="ml-auto"><StatusPill status={status} /></span>
      </div>

      {/* The signature block — printed, so a paper copy carries the same trail. */}
      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-surface-rule">
        {signatures.map(s => (
          <div key={s.role}>
            <p className="font-mono text-[9px] text-text-muted uppercase tracking-wide">{s.role}</p>
            <p className="text-[13px] text-text mt-0.5">{s.name ?? <span className="text-stone-300">—</span>}</p>
            <p className="font-mono text-[10px] text-text-muted">{s.at ? `${sastDateTime(s.at)} SAST` : ''}</p>
          </div>
        ))}
      </div>

      <div className="no-print px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && status !== 'approved' && (
            <button onClick={() => onAct('save')} disabled={!!busy}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-stone-200 bg-white font-medium text-[13px] text-text disabled:opacity-40 hover:bg-stone-50 transition-colors">
              {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} className="text-ok" /> : <Save size={14} />}
              {busy === 'save' ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
            </button>
          )}
          {canSubmit && status !== 'approved' && (
            <button onClick={() => onAct('submit')} disabled={!!busy}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white font-semibold text-[13px] disabled:opacity-40 hover:bg-brand-mid transition-colors">
              {busy === 'submit' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {status === 'submitted' ? 'Re-send to Production Manager' : 'Send to Production Manager'}
            </button>
          )}
          {canApprove && status !== 'approved' && (
            <button onClick={() => onAct('approve')} disabled={!!busy}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-ok text-white font-semibold text-[13px] disabled:opacity-40 hover:opacity-90 transition-colors">
              {busy === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />}
              Sign off
            </button>
          )}
          {canApprove && status === 'approved' && (
            <button onClick={() => onAct('reopen')} disabled={!!busy}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-stone-200 text-[13px] text-stone-600 hover:border-warn hover:text-warn disabled:opacity-40 transition-colors">
              {busy === 'reopen' ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
              Reopen for corrections
            </button>
          )}
          {!canEdit && !canSubmit && !canApprove && (
            <p className="text-[12px] text-stone-400">You have read-only access to shift reports.</p>
          )}
        </div>

        <p className="text-[11px] text-text-muted">
          {status === 'approved'
            ? 'Signed off. The figures shown were frozen at sign-off — reopening it re-reads the live records.'
            : status === 'submitted'
              ? 'Sent up. Sending again re-freezes the figures as they stand now.'
              : 'Sending freezes these figures against this shift, so a later recapture can’t change a report someone already signed.'}
          {notes.trim() ? '' : ' Notes are optional.'}
        </p>

        {trail.length > 0 && (
          <div className="border-t border-surface-rule pt-3">
            <button onClick={() => setShowTrail(v => !v)} className="flex items-center gap-1.5 text-[12px] text-brand hover:underline">
              <History size={12} /> {showTrail ? 'Hide' : 'Show'} audit trail ({trail.length})
            </button>
            {showTrail && (
              <ul className="mt-2 space-y-1">
                {trail.map((t, i) => (
                  <li key={i} className="font-mono text-[11px] text-text-muted">
                    {sastDateTime(t.at)} · {t.action}
                    {t.fromStatus && t.toStatus ? ` (${t.fromStatus} → ${t.toStatus})` : ''}
                    {t.actorName ? ` · ${t.actorName}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
