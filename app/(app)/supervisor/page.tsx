'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import {
  Factory, Scale, TrendingUp, PenLine, Wrench, Users, Loader2, RefreshCw,
  ChevronRight, AlertTriangle, CheckCircle2, ArrowRight, FileText, MessageSquare,
  CalendarRange, Trophy,
} from 'lucide-react'
import { currentShift, sastToday, SHIFT_LABEL } from '@/lib/production/shifts'
import { sectionMeta } from '@/lib/production/capture-config'
import { HubHeader } from '@/components/supervisor/HubTabs'
import { hoursLabel, STATUS_LABEL, type ShiftReport } from '@/lib/production/shift-report'

// Supervisor Hub → Dashboard. The ONLY summary page in the hub: what is
// happening right now, what still needs a signature, and one line each on
// people, output and breakdowns. Everything here is a link to the tab that owns
// the detail — the dashboard deliberately holds no ACTION controls of its own
// (no sign, no edit, no approve — those live on the tab that owns them), which
// is what stops it turning back into a page that does five jobs at once. The
// line filter is the one exception: it only narrows what this page displays,
// it doesn't do anything, so it doesn't reintroduce that problem.
//
// It reads the same /api/production/shift-report assembly the Shift Report tab
// renders, so the numbers on the dashboard and in the signed report can never
// disagree — there is one calculation, not two. Mass balance (input vs output)
// is per-line data straight off that same report, just not previously shown.

const LINE_STATUS: Record<string, { cls: string; dot: string }> = {
  draft:     { cls: 'bg-warn/10 text-warn',           dot: 'bg-warn' },
  submitted: { cls: 'bg-info/10 text-info',           dot: 'bg-info' },
  approved:  { cls: 'bg-ok/10 text-ok',               dot: 'bg-ok' },
}

export default function SupervisorDashboard() {
  const today = sastToday()
  const shift = currentShift()

  const [report, setReport] = useState<ShiftReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lineFilter, setLineFilter] = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/production/shift-report?date=${today}&shift=${shift}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `Error ${res.status}`)
      setReport(json as ShiftReport)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load today’s figures')
    }
    setLoading(false)
  }, [today, shift])

  useEffect(() => { load() }, [load])

  // A refresh can drop a line that was running (or add a new one) — don't
  // leave the filter pointed at a section that's no longer on this shift.
  useEffect(() => {
    if (lineFilter !== 'all' && report && !report.lines.some(l => l.sectionId === lineFilter)) setLineFilter('all')
  }, [report, lineFilter])

  const h = report?.headline
  const lines = report?.lines ?? []
  const availableSections = Array.from(new Set(lines.map(l => l.sectionId)))
  const visibleLines = lineFilter === 'all' ? lines : lines.filter(l => l.sectionId === lineFilter)
  const massBalance = visibleLines.reduce((acc, l) => ({
    input: acc.input + l.inputKg, output: acc.output + l.outputKg,
  }), { input: 0, output: 0 })
  const massBalanceOff = visibleLines.some(l => l.withinTolerance === false)

  const tiles = [
    { label: 'Lines running', value: h ? String(h.linesRun) : '—', icon: Factory, cls: 'text-text', href: '/production/orders' },
    { label: 'Tons out', value: h ? h.tonsOut.toFixed(2) : '—', icon: Scale, cls: 'text-text', href: '/production/orders?view=analytics' },
    { label: 'Yield', value: h?.yieldPct != null ? `${h.yieldPct}%` : '—', icon: TrendingUp, cls: 'text-text', href: '/production/orders?view=analytics' },
    { label: 'Need sign-off', value: h ? String(h.sessionsOutstanding) : '—', icon: PenLine, cls: h?.sessionsOutstanding ? 'text-info' : 'text-text-muted', href: '/supervisor/signoff' },
    { label: 'Breakdowns', value: h ? String(h.breakdowns) : '—', icon: Wrench, cls: h?.breakdowns ? 'text-err' : 'text-text-muted', href: '/maintenance/job-cards' },
    { label: 'On the floor', value: h ? `${h.peoplePresent}/${h.peopleRostered || h.peoplePresent}` : '—', icon: Users, cls: h?.peopleAbsent ? 'text-warn' : 'text-text', href: '/supervisor/team' },
  ]

  return (
    <div className="px-4 py-6 max-w-[1000px] mx-auto space-y-5">
      <HubHeader
        title="Dashboard"
        subtitle={`${format(parseISO(today + 'T12:00:00'), 'EEEE d MMM')} · ${SHIFT_LABEL[shift]} shift${report?.meta.rosterShiftLabel ? ` · ${report.meta.rosterShiftLabel}` : ''}`}
        action={
          <button onClick={load} className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      {error && (
        <p className="flex items-center gap-2 text-[12px] text-err px-4 py-3 bg-err/5 border border-err/20 rounded-xl">
          <AlertTriangle size={13} className="shrink-0" /> {error}
        </p>
      )}

      {/* Today at a glance. Every tile links to the page that owns it. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {tiles.map(t => (
          <Link key={t.label} href={t.href}
            className="bg-surface-card border border-surface-rule rounded-xl p-4 hover:border-brand/40 transition-colors group">
            <t.icon size={14} className={`${t.cls} mb-2`} />
            <div className={`font-display font-bold text-[22px] leading-none ${t.cls}`}>{loading ? '—' : t.value}</div>
            <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide mt-1 flex items-center gap-1">
              {t.label}
              <ChevronRight size={9} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </Link>
        ))}
      </div>

      {loading && !report ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Lines this shift */}
          <div className="lg:col-span-2 bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-surface-rule bg-surface">
              <div className="flex items-center gap-2">
                <Factory size={15} className="text-text-muted" />
                <span className="font-display font-bold text-[14px] text-text">Lines this shift</span>
              </div>
              <div className="flex items-center gap-3">
                {availableSections.length > 1 && (
                  <select value={lineFilter} onChange={e => setLineFilter(e.target.value)}
                    className="text-[11px] font-medium border border-surface-rule rounded-full pl-2.5 pr-6 py-1 text-text-muted hover:border-brand hover:text-brand bg-surface-card cursor-pointer">
                    <option value="all">All lines</option>
                    {availableSections.map(id => <option key={id} value={id}>{sectionMeta(id).name}</option>)}
                  </select>
                )}
                {!!visibleLines.length && (
                  <span className="font-mono text-[11px] text-text-muted">
                    {visibleLines.filter(l => l.status === 'approved').length}/{visibleLines.length} signed off
                  </span>
                )}
              </div>
            </div>
            {!!visibleLines.length && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-surface-rule bg-surface-dim/30 font-mono text-[11px]">
                <Scale size={12} className="text-text-muted shrink-0" />
                <span className="text-text-muted">Mass balance:</span>
                <span className="text-text font-semibold">{massBalance.input.toLocaleString()} kg in</span>
                <ArrowRight size={11} className="text-stone-300 shrink-0" />
                <span className="text-text font-semibold">{massBalance.output.toLocaleString()} kg out</span>
                <span className={massBalanceOff ? 'text-warn' : 'text-ok'}>
                  ({massBalance.input - massBalance.output >= 0 ? '+' : ''}{(massBalance.input - massBalance.output).toFixed(1)} kg)
                </span>
              </div>
            )}
            {!report?.lines.length ? (
              <div className="text-center py-14 px-4">
                <Factory size={24} className="mx-auto mb-3 text-stone-200" />
                <p className="font-mono text-[12px] text-stone-400">Nothing captured on this shift yet</p>
                <Link href="/supervisor/roster" className="text-[12px] text-brand hover:underline mt-1 inline-block">Assign today’s sections →</Link>
              </div>
            ) : (
              <div className="divide-y divide-surface-rule">
                {visibleLines.map(l => {
                  const st = LINE_STATUS[l.status] ?? LINE_STATUS.draft
                  const href = `/production/capture/${l.sectionId}?date=${report.meta.date}&shift=${report.meta.shift}`
                    + `${l.status === 'submitted' ? '&tab=signoff' : ''}&return=${encodeURIComponent('/supervisor')}`
                  return (
                    <Link key={l.sessionId} href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-surface transition-colors group">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: l.colorHex }}>
                        <span className="font-mono font-bold text-[10px] text-white">{l.sectionCode}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-body font-semibold text-[14px] text-text truncate">{l.sectionName}</div>
                        <div className="flex items-center gap-1.5 text-[11px] text-text-muted font-mono truncate">
                          <Users size={11} className="shrink-0" /> {l.operatorNames.join(', ') || 'No operators'}
                          {l.lotNumber ? ` · ${l.lotNumber}` : ''}
                        </div>
                      </div>
                      <div className="items-center gap-2 shrink-0 hidden sm:flex">
                        <div className="text-right">
                          <div className="font-mono text-[12px] text-text">{l.inputKg.toLocaleString()}</div>
                          <div className="font-mono text-[9px] text-text-muted uppercase">kg in</div>
                        </div>
                        <ArrowRight size={11} className="text-stone-300 shrink-0" />
                        <div className="text-right">
                          <div className={`font-mono text-[12px] ${l.withinTolerance === false ? 'text-warn font-semibold' : 'text-text'}`}>{l.outputKg.toLocaleString()}</div>
                          <div className="font-mono text-[9px] text-text-muted uppercase">kg out</div>
                        </div>
                      </div>
                      {l.withinTolerance === false && (
                        <span title={`Mass balance off by ${l.balanceKg} kg`} className="shrink-0">
                          <AlertTriangle size={13} className="text-warn" />
                        </span>
                      )}
                      <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg shrink-0 ${st.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} /> {STATUS_LABEL[l.status] ?? l.status}
                      </span>
                      <ChevronRight size={15} className="text-stone-300 group-hover:text-brand transition-colors shrink-0" />
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right column — the three things worth a supervisor's attention, and
              nothing that duplicates a tab. */}
          <div className="space-y-4">
            {/* Attention */}
            <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-rule bg-surface font-display font-bold text-[14px] text-text">
                Needs attention
              </div>
              <div className="divide-y divide-surface-rule">
                <AttentionRow
                  ok={!h?.sessionsOutstanding}
                  href="/supervisor/signoff" icon={PenLine}
                  label={h?.sessionsOutstanding ? `${h.sessionsOutstanding} record${h.sessionsOutstanding === 1 ? '' : 's'} not signed off` : 'All records signed off'}
                />
                <AttentionRow
                  ok={!h?.balanceFlags}
                  href="/production/orders" icon={Scale}
                  label={h?.balanceFlags ? `${h.balanceFlags} mass-balance variance${h.balanceFlags === 1 ? '' : 's'} over tolerance` : 'Mass balance within tolerance'}
                />
                <AttentionRow
                  ok={!h?.checksFailed}
                  href="/supervisor/report" icon={AlertTriangle}
                  label={h?.checksFailed ? `${h.checksFailed} failed check${h.checksFailed === 1 ? '' : 's'} this shift` : 'No failed checks'}
                />
                <AttentionRow
                  ok={!h?.peopleAbsent}
                  href="/supervisor/report" icon={Users}
                  label={h?.peopleAbsent
                    ? `${h.peopleAbsent} rostered ${h.peopleAbsent === 1 ? 'person is' : 'people are'} not on the floor`
                    : 'Everyone rostered is on the floor'}
                />
                <AttentionRow
                  ok={!h?.downtimeMinutes}
                  href="/maintenance/job-cards" icon={Wrench}
                  label={h?.downtimeMinutes
                    ? `${hoursLabel(h.downtimeMinutes)} of breakdown downtime`
                    : 'No breakdown downtime'}
                />
              </div>
            </div>

            {/* Jump-off points to the tabs that do the work. */}
            <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-rule bg-surface font-display font-bold text-[14px] text-text">
                Go to
              </div>
              <div className="divide-y divide-surface-rule">
                <QuickLink href="/supervisor/report" icon={FileText} label="Today’s shift report"
                  hint={report?.record.status ? SHIFT_REPORT_HINT[report.record.status] : 'Not generated yet'} />
                <QuickLink href="/supervisor/roster" icon={CalendarRange} label="Roster"
                  hint={report?.meta.rosterPeriodName ?? 'This period'} />
                <QuickLink href="/supervisor/team" icon={Trophy} label="Capture ratings"
                  hint="Score this week’s crew" />
                <QuickLink href="/supervisor/messages" icon={MessageSquare} label="Line messages"
                  hint="Talk to the floor" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Anything the report could not read is stated, not hidden — an empty
          section must never be mistaken for "nothing happened". */}
      {!!report?.gaps.length && (
        <div className="bg-warn/5 border border-warn/30 rounded-xl px-4 py-3 space-y-1">
          {report.gaps.map((g, i) => (
            <p key={i} className="flex items-start gap-2 text-[12px] text-warn">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {g}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

const SHIFT_REPORT_HINT: Record<string, string> = {
  draft: 'Draft — not sent yet',
  submitted: 'Sent to the Production Manager',
  approved: 'Signed off',
}

function AttentionRow({ ok, href, icon: Icon, label }: {
  ok: boolean; href: string; icon: React.ElementType; label: string
}) {
  return (
    <Link href={href} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-surface transition-colors group">
      {ok
        ? <CheckCircle2 size={14} className="text-ok shrink-0" />
        : <Icon size={14} className="text-warn shrink-0" />}
      <span className={`text-[12px] flex-1 min-w-0 ${ok ? 'text-text-muted' : 'text-text font-medium'}`}>{label}</span>
      <ChevronRight size={13} className="text-stone-300 group-hover:text-brand transition-colors shrink-0" />
    </Link>
  )
}

function QuickLink({ href, icon: Icon, label, hint }: {
  href: string; icon: React.ElementType; label: string; hint: string
}) {
  return (
    <Link href={href} className="flex items-center gap-2.5 px-4 py-3 hover:bg-surface transition-colors group">
      <Icon size={15} className="text-text-muted shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text truncate">{label}</div>
        <div className="font-mono text-[10px] text-text-muted truncate">{hint}</div>
      </div>
      <ArrowRight size={13} className="text-stone-300 group-hover:text-brand transition-colors shrink-0" />
    </Link>
  )
}
