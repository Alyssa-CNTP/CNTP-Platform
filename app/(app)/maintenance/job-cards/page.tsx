'use client'

// app/(app)/maintenance/job-cards/page.tsx
// Role-aware job-card board built around a professional one-line table
// (JobCardTable): every card is a single row that expands to the full
// JobCardItem for allocation / work-logging / QC / verification. Manager sees a
// shift summary, an "awaiting allocation" table, the active board grouped by a
// technician tab strip, and history. Tech / QC / raiser see their own tables.

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Plus, AlertTriangle, Search, Download, Printer } from 'lucide-react'
import { exportJobCardsCsv, printJobCards } from '@/lib/maintenance/exporters'
import { useAuth } from '@/lib/auth/context'
import BottomSheet from '@/components/ui/BottomSheet'
import { useMaintenanceContext } from '../layout'
import { deriveMaintRole } from '@/lib/maintenance/roles'
import { JobCardTable } from '@/components/maintenance/JobCardTable'
import { RaiseJobCardForm } from '@/components/maintenance/RaiseJobCardForm'
import { STATUSES, URGENCIES, URGENCY_META } from '@/lib/maintenance/constants'
import { fmtD, fmtT, diffDays, diffM, priorityOf } from '@/lib/maintenance/helpers'
import { INP } from '@/components/production/shared/ui'
import type { JobCard, Urgency } from '@/lib/maintenance/types'

const SEG = (active: boolean) =>
  `px-3.5 py-2 rounded-lg text-[12px] font-semibold whitespace-nowrap ${active ? 'bg-brand text-white' : 'text-text-muted hover:bg-surface-dim'}`

// Effective urgency = manager-set label, else the derived priority (high/med/low).
const effUrg = (j: JobCard): Urgency => (j.urgency ?? priorityOf(j) as Urgency)

// Sort rank: manager-set urgency (critical→low) wins, else the derived priority.
// Lower = more urgent, so high urgency always floats to the top of any list.
const urgencyRank = (j: JobCard) => {
  if (j.urgency) return URGENCY_META[j.urgency].rank // 0 critical … 3 low
  const p = priorityOf(j)
  return p === 'high' ? 1 : p === 'medium' ? 2 : 3
}
const byUrgencyThenAge = (a: JobCard, b: JobCard) => urgencyRank(a) - urgencyRank(b) || a.raised_at.localeCompare(b.raised_at)

// Shared filter: free-text search across human fields + a raised-date range.
function makeCardFilter(search: string, from: string, to: string) {
  const q = search.trim().toLowerCase()
  return (j: JobCard) => {
    const day = (j.raised_at ?? '').slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    if (!q) return true
    return [j.card_no, j.area, j.machine, j.description, j.long_desc, j.raised_by, j.assigned_to]
      .some(v => (v ?? '').toLowerCase().includes(q))
  }
}

// Reusable search + date-range + urgency bar, shared by every job-card view.
function FilterBar({ search, setSearch, dateFrom, setDateFrom, dateTo, setDateTo, urg, setUrg }: {
  search: string; setSearch: (v: string) => void
  dateFrom: string; setDateFrom: (v: string) => void
  dateTo: string; setDateTo: (v: string) => void
  urg: string; setUrg: (v: string) => void
}) {
  const active = !!(search || dateFrom || dateTo || urg !== 'all')
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative flex-1 min-w-[220px]">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
        <input className={`${INP} w-full pl-8`} placeholder="Search job cards — number, machine, description, person…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <select className={`${INP} w-auto`} value={urg} onChange={e => setUrg(e.target.value)} title="Filter by urgency">
        <option value="all">All urgencies</option>
        {URGENCIES.slice().reverse().map(u => <option key={u} value={u}>{URGENCY_META[u].label}</option>)}
      </select>
      <label className="text-[11px] text-text-muted">From <input className={`${INP} w-auto inline-block ml-1`} type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
      <label className="text-[11px] text-text-muted">To <input className={`${INP} w-auto inline-block ml-1`} type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>
      {active && <button onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setUrg('all') }} className="text-[12px] text-text-muted hover:text-text underline">Clear</button>}
    </div>
  )
}

export default function JobCardsPage() {
  const auth = useAuth()
  const baseRole = deriveMaintRole(auth)
  const ctx = useMaintenanceContext()
  const { loading, data, derived, actions, ui, actor } = ctx
  const { jcs } = data
  const { cnt, newCards } = derived

  // IT / full admin get the full view of every profile via a "View as" switcher.
  const [viewAs, setViewAs] = useState<'manager' | 'tech' | 'qc' | 'raiser'>('manager')
  const role = baseRole.isAdminView
    ? { ...baseRole, canManage: viewAs === 'manager', isTech: viewAs === 'tech', isQc: viewAs === 'qc', isRaiser: viewAs === 'raiser' }
    : baseRole

  const [filt, setFilt] = useState('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [urg, setUrg] = useState('all')
  const [techFilt, setTechFilt] = useState('all') // 'all' | '__unassigned__' | technician name
  const [raiseOpen, setRaiseOpen] = useState(false)
  const [raiseMode, setRaiseMode] = useState<'breakdown' | 'planned'>('planned')
  const canRaiseBreakdown = auth.isProduction || auth.p('can_raise_breakdown')
  const openRaise = (mode: 'breakdown' | 'planned') => { setRaiseMode(mode); setRaiseOpen(true) }

  const cardRoles = { canManage: role.canManage, isTech: role.isTech, isQc: role.isQc, isRaiser: role.isRaiser }
  const cardHref = (j: JobCard) => `/maintenance/job-cards/${j.id}`

  // Shared free-text + date-range + urgency filter, applied across every view.
  const cardFilter = makeCardFilter(search, dateFrom, dateTo)
  const matchUrg = (j: JobCard) => urg === 'all' || effUrg(j) === urg
  const passes = (j: JobCard) => cardFilter(j) && matchUrg(j)

  // Technicians who have active cards — drives the technician tab strip + counts.
  const activeAll = jcs.filter(j => j.status !== 'complete' && j.status !== 'cancelled' && j.status !== 'raised')
  const techNames = useMemo(
    () => Array.from(new Set(activeAll.map(j => j.assigned_to).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [jcs]) // eslint-disable-line react-hooks/exhaustive-deps

  // Active board = not complete/cancelled/raised, narrowed by status / technician /
  // search / date / urgency, then high-urgency first.
  const activeCards = activeAll
    .filter(j => filt === 'all' || j.status === filt)
    .filter(j => techFilt === 'all' || (techFilt === '__unassigned__' ? !j.assigned_to : j.assigned_to === techFilt))
    .filter(passes)
    .sort(byUrgencyThenAge)

  if (loading) {
    return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="card p-6 text-text-muted text-sm">Loading job cards…</div></div>
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text">Job Cards</h1>
          <p className="text-sm text-text-muted mt-1">Report breakdowns, raise planned work, and track every job to close-out.</p>
        </div>
        <div className="flex gap-2">
          {canRaiseBreakdown && (
            <button onClick={() => openRaise('breakdown')}
              className="bg-err text-white rounded-lg px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm hover:brightness-110">
              <AlertTriangle size={16} /> Report Breakdown
            </button>
          )}
          <button onClick={() => openRaise('planned')}
            className="border border-surface-rule bg-surface-card text-text rounded-lg px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-1.5 hover:border-text/30">
            <Plus size={16} /> New Job Card
          </button>
        </div>
      </div>

      {/* Urgent breakdown banner for Production — makes the action unmissable */}
      {canRaiseBreakdown && (
        <button onClick={() => openRaise('breakdown')}
          className="w-full mb-5 flex items-center gap-3 text-left rounded-xl border border-err/20 bg-err/5 px-4 py-3 hover:bg-err/10 transition">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-err/10 text-err shrink-0"><AlertTriangle className="w-5 h-5" /></span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-text">Machine down? Report a breakdown</span>
            <span className="block text-[12px] text-text-muted">Goes straight to the on-duty technician{derived.duty ? ` (${derived.duty})` : ''} — timer starts immediately.</span>
          </span>
          <span className="text-err text-sm font-semibold shrink-0">Report →</span>
        </button>
      )}

      {/* IT / full-admin: switch between every profile's view */}
      {baseRole.isAdminView && (
        <div className="flex items-center gap-2 mb-4 flex-wrap rounded-lg border border-surface-rule bg-surface-dim p-1.5">
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide px-1.5">IT — view as</span>
          {([['manager', 'Maintenance Manager'], ['tech', 'Technician'], ['qc', 'QC'], ['raiser', 'Raiser']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setViewAs(v)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition ${viewAs === v ? 'bg-brand text-white shadow-sm' : 'text-text-muted hover:text-text'}`}>{label}</button>
          ))}
        </div>
      )}

      {/* Shared search + date-range + urgency filter — available in every view */}
      <FilterBar search={search} setSearch={setSearch} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} urg={urg} setUrg={setUrg} />

      {/* ── MANAGER: BOARD ── */}
      {role.canManage && (
        <div>
          <ShiftSummary jcs={jcs} completions={data.completions} cardHref={cardHref} />

          {/* Awaiting allocation — newly raised cards, most urgent first */}
          {newCards.filter(passes).length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-warn animate-pulse" />
                <h2 className="text-sm font-semibold text-text">Awaiting allocation</h2>
                <span className="text-[11px] text-text-muted tabular-nums">{newCards.filter(passes).length}</span>
              </div>
              <JobCardTable cards={newCards.filter(passes).sort(byUrgencyThenAge)} roles={cardRoles} />
            </div>
          )}

          {/* Active board header + export */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="text-sm font-semibold text-text">Active board <span className="text-[11px] text-text-muted tabular-nums">{activeCards.length}</span></h2>
            <div className="flex gap-2">
              <button onClick={() => exportJobCardsCsv(activeCards)} title="Export visible cards to CSV"
                className="inline-flex items-center gap-1.5 border border-surface-rule bg-surface-card text-text rounded-lg px-3 py-2 text-[12px] font-semibold hover:border-text/30 transition"><Download size={14} /> Export</button>
              <button onClick={() => printJobCards(activeCards, 'Active job cards')} title="Print visible cards"
                className="inline-flex items-center gap-1.5 border border-surface-rule bg-surface-card text-text rounded-lg px-3 py-2 text-[12px] font-semibold hover:border-text/30 transition"><Printer size={14} /> Print</button>
            </div>
          </div>

          {/* Per-technician allocation tabs (replaces the old "by raiser" view) */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button onClick={() => setTechFilt('all')} className={SEG(techFilt === 'all')}>All <span className="opacity-70 tabular-nums">{activeAll.filter(passes).length}</span></button>
            <button onClick={() => setTechFilt('__unassigned__')} className={SEG(techFilt === '__unassigned__')}>Unassigned <span className="opacity-70 tabular-nums">{activeAll.filter(j => !j.assigned_to).filter(passes).length}</span></button>
            {techNames.map(t => (
              <button key={t} onClick={() => setTechFilt(t)} className={SEG(techFilt === t)}>
                {t} <span className="opacity-70 tabular-nums">{activeAll.filter(j => j.assigned_to === t).filter(passes).length}</span>
              </button>
            ))}
          </div>

          {/* Status filter chips */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            <Chip active={filt === 'all'} onClick={() => setFilt('all')} label="Active" count={jcs.filter(j => j.status !== 'complete' && j.status !== 'cancelled').length} />
            {STATUSES.map(s => <Chip key={s} active={filt === s} onClick={() => setFilt(f => (f === s ? 'all' : s))} label={s.replace(/_/g, ' ')} count={cnt(s)} />)}
          </div>

          <JobCardTable cards={activeCards} roles={cardRoles} empty="No active job cards match these filters." />

          {/* Historical — searchable + per-column filters */}
          <HistoryPanel jcs={jcs} cardHref={cardHref} />
        </div>
      )}

      {/* ── TECHNICIAN VIEW ── */}
      {!role.canManage && role.isTech && (
        <div>
          <div className="card p-3 text-[12px] text-text-muted mb-3">
            Your job cards, <strong className="text-text">{actor}</strong>. Click a row to log work — the timer shows while a job is running. Breakdowns time from the moment they were raised.
          </div>
          <JobCardTable
            cards={jcs.filter(j => j.assigned_to === actor && !j.external && j.status !== 'complete').filter(passes).sort(byUrgencyThenAge)}
            roles={cardRoles}
            empty={`No open job cards assigned to ${actor}.`} />
        </div>
      )}

      {/* ── QC VIEW ── */}
      {!role.canManage && !role.isTech && role.isQc && (
        <div>
          <div className="card p-3 text-[12px] text-text-muted mb-3">
            Job cards awaiting QC post-maintenance checks — click a row to answer YES / NO / N/A; any YES returns the card to the technician with your comment.
          </div>
          <JobCardTable
            cards={jcs.filter(j => j.status === 'qc_check').filter(passes).sort((a, b) => (actions.qcFor(b.area) === actor ? 1 : 0) - (actions.qcFor(a.area) === actor ? 1 : 0) || byUrgencyThenAge(a, b))}
            roles={cardRoles}
            empty="Nothing waiting for QC." />
        </div>
      )}

      {/* ── RAISER DASHBOARD (default) ── */}
      {!role.canManage && !role.isTech && !role.isQc && (
        <RaiserView actor={actor} jcs={jcs} cardRoles={cardRoles} passes={passes} />
      )}

      <BottomSheet open={raiseOpen} onClose={() => setRaiseOpen(false)} center={false}>
        <div className="bg-surface-card rounded-t-2xl lg:rounded-2xl max-h-[90vh] overflow-y-auto p-1">
          <RaiseJobCardForm onDone={() => setRaiseOpen(false)} initialWorkflow={raiseMode} />
        </div>
      </BottomSheet>
    </div>
  )
}

// What happened during a shift (07:00–16:00 day / 16:00–01:00 evening) — computed
// live from the recorded timestamps, so the summary is ready the moment a shift ends.
function ShiftSummary({ jcs, completions, cardHref }: { jcs: JobCard[]; completions: { updated_at?: string }[]; cardHref: (j: JobCard) => string }) {
  const [date, setDate] = useState(() => {
    const d = new Date(); if (d.getHours() < 16) d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })
  const [shift, setShift] = useState<'day' | 'evening'>(() => (new Date().getHours() >= 16 || new Date().getHours() < 7 ? 'day' : 'evening'))

  const d0 = new Date(date + 'T00:00:00')
  const s = new Date(d0), e = new Date(d0)
  if (shift === 'day') { s.setHours(7, 0, 0, 0); e.setHours(16, 0, 0, 0) }
  else { s.setHours(16, 0, 0, 0); e.setDate(e.getDate() + 1); e.setHours(1, 0, 0, 0) }
  const inShift = (ts: string | null | undefined) => ts != null && new Date(ts) >= s && new Date(ts) < e

  const raised = jcs.filter(j => inShift(j.raised_at))
  const breakdowns = raised.filter(j => j.workflow === 'breakdown')
  const finished = jcs.filter(j => inShift(j.completed_at) || inShift(j.verified_at))
  const accepted = jcs.filter(j => inShift(j.accepted_at) || inShift(j.started_at))
  const checklists = completions.filter(c => inShift(c.updated_at)).length

  // Reactive tile filter — clicking a tile narrows the activity list below.
  const [sf, setSf] = useState<'all' | 'breakdowns' | 'raised' | 'accepted' | 'finished'>('all')
  const tiles = [
    { k: 'breakdowns' as const, l: 'Breakdowns raised', v: breakdowns.length, hot: breakdowns.length > 0 },
    { k: 'raised' as const, l: 'Job cards raised', v: raised.length },
    { k: 'accepted' as const, l: 'Accepted / started', v: accepted.length },
    { k: 'finished' as const, l: 'Finished', v: finished.length },
    { k: null, l: 'Checklists worked', v: checklists },
  ]
  const showBreakdowns = sf === 'all' || sf === 'breakdowns'
  const showRaised = sf === 'all' || sf === 'raised'
  const showAccepted = sf === 'accepted'
  const showFinished = sf === 'all' || sf === 'finished'

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-sm font-semibold text-text">Shift summary</h2>
        <div className="flex gap-1.5 items-center">
          <input className={`${INP} w-36 min-h-0 py-1.5`} type="date" value={date} onChange={ev => setDate(ev.target.value)} />
          <button className={SEG(shift === 'day')} onClick={() => setShift('day')}>Day 07:00–16:00</button>
          <button className={SEG(shift === 'evening')} onClick={() => setShift('evening')}>Evening 16:00–01:00</button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-3">
        {tiles.map(t => {
          const active = t.k !== null && sf === t.k
          const clickable = t.k !== null
          return (
            <button key={t.l} disabled={!clickable}
              onClick={() => clickable && setSf(s => (s === t.k ? 'all' : t.k!))}
              className={`rounded-lg p-2.5 text-center transition ${clickable ? 'cursor-pointer hover:border-text/30' : 'cursor-default'} ${active ? 'bg-brand/10 border border-brand/30' : 'bg-surface-raised border border-transparent'}`}>
              <div className={`text-xl font-semibold tabular-nums ${t.hot ? 'text-err' : 'text-text'}`}>{t.v}</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wide mt-0.5">{t.l}</div>
            </button>
          )
        })}
      </div>
      {(raised.length > 0 || finished.length > 0 || accepted.length > 0) ? (
        <div className="space-y-1 text-[12px]">
          {showBreakdowns && breakdowns.map(j => <div key={'b' + j.id}><span className="badge badge-err mr-1.5">BREAKDOWN</span><Link href={cardHref(j)} className="text-accent font-semibold">{j.card_no}</Link> {j.area} — {j.description} <span className="text-text-faint">({fmtT(j.raised_at)}, by {j.raised_by}{j.assigned_to ? ', → ' + j.assigned_to : ''})</span></div>)}
          {showRaised && raised.filter(j => j.workflow !== 'breakdown').map(j => <div key={'r' + j.id}><span className="badge badge-warn mr-1.5">RAISED</span><Link href={cardHref(j)} className="text-accent font-semibold">{j.card_no}</Link> {j.area} — {j.description} <span className="text-text-faint">({fmtT(j.raised_at)}, by {j.raised_by})</span></div>)}
          {showAccepted && accepted.map(j => <div key={'a' + j.id}><span className="badge badge-info mr-1.5">ACCEPTED</span><Link href={cardHref(j)} className="text-accent font-semibold">{j.card_no}</Link> {j.area} — {j.description} <span className="text-text-faint">({j.assigned_to ?? '—'}, {fmtT(j.started_at ?? j.accepted_at)})</span></div>)}
          {showFinished && finished.map(j => <div key={'c' + j.id}><span className="badge badge-ok mr-1.5">FINISHED</span><Link href={cardHref(j)} className="text-accent font-semibold">{j.card_no}</Link> {j.area} — {j.description} <span className="text-text-faint">({j.assigned_to ?? '—'}, {diffM(j.workflow === 'breakdown' ? j.raised_at : (j.started_at ?? j.accepted_at), j.completed_at)} min)</span></div>)}
        </div>
      ) : <div className="text-[12px] text-text-faint">Nothing recorded in this shift window.</div>}
    </div>
  )
}

function Chip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition ${active ? 'bg-brand text-white' : 'bg-surface-card border border-surface-rule text-text-muted hover:border-text/30'}`}>
      <span className="capitalize">{label}</span>
      <span className={`tabular-nums text-[11px] ${active ? 'text-white/80' : 'text-text-faint'}`}>{count}</span>
    </button>
  )
}

// Searchable + per-column-filterable history of completed / cancelled job cards.
function HistoryPanel({ jcs, cardHref }: { jcs: JobCard[]; cardHref: (j: JobCard) => string }) {
  const [q, setQ] = useState('')
  const [statusF, setStatusF] = useState<'complete' | 'cancelled' | 'all'>('complete')
  const [typeF, setTypeF] = useState('all')
  const [areaF, setAreaF] = useState('all')
  const [techF, setTechF] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const closedOf = (j: JobCard) => j.completed_at ?? j.verified_at
  const base = useMemo(() => jcs.filter(j => j.status === 'complete' || j.status === 'cancelled'), [jcs])
  const areas = useMemo(() => Array.from(new Set(base.map(j => j.area).filter(Boolean))).sort(), [base])
  const techs = useMemo(() => Array.from(new Set(base.map(j => j.assigned_to).filter(Boolean) as string[])).sort(), [base])

  const ql = q.trim().toLowerCase()
  const rows = base.filter(j => {
    if (statusF !== 'all' && j.status !== statusF) return false
    if (typeF !== 'all' && j.workflow !== typeF) return false
    if (areaF !== 'all' && j.area !== areaF) return false
    if (techF !== 'all' && j.assigned_to !== techF) return false
    const cd = (closedOf(j) ?? '').slice(0, 10)
    if (from && cd && cd < from) return false
    if (to && cd && cd > to) return false
    if (ql && ![j.card_no, j.area, j.machine, j.description, j.long_desc, j.assigned_to, j.raised_by, j.root_cause, j.work_done]
      .some(v => (v ?? '').toLowerCase().includes(ql))) return false
    return true
  }).sort((a, b) => (closedOf(b) ?? '').localeCompare(closedOf(a) ?? ''))

  const active = q || from || to || typeF !== 'all' || areaF !== 'all' || techF !== 'all' || statusF !== 'complete'
  const clear = () => { setQ(''); setFrom(''); setTo(''); setTypeF('all'); setAreaF('all'); setTechF('all'); setStatusF('complete') }
  const colSel = `${INP} w-full text-[11px] py-1 min-h-0`

  return (
    <div className="card p-4 mt-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="text-sm font-semibold text-text">Historical job cards <span className="text-[11px] text-text-muted tabular-nums">{rows.length}</span></div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
            <input className={`${INP} pl-8 w-[240px]`} placeholder="Search history — card, machine, root cause…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <select className={`${INP} w-auto`} value={statusF} onChange={e => setStatusF(e.target.value as any)}>
            <option value="complete">Done</option><option value="cancelled">Cancelled</option><option value="all">Done + cancelled</option>
          </select>
          <label className="text-[11px] text-text-muted">Closed <input type="date" className={`${INP} w-auto ml-1`} value={from} onChange={e => setFrom(e.target.value)} /></label>
          <span className="text-text-faint">–</span>
          <input type="date" className={`${INP} w-auto`} value={to} onChange={e => setTo(e.target.value)} />
          {active && <button className="text-[12px] underline text-text-muted hover:text-text" onClick={clear}>Clear</button>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table w-full">
          <thead>
            <tr>{['#', 'Type', 'Area', 'Machine', 'Description', 'Tech', 'By', 'Raised', 'Closed', 'Days'].map(h => <th key={h}>{h}</th>)}</tr>
            <tr>
              <th />
              <th><select className={colSel} value={typeF} onChange={e => setTypeF(e.target.value)}><option value="all">All</option><option value="breakdown">BD</option><option value="planned">PL</option></select></th>
              <th><select className={colSel} value={areaF} onChange={e => setAreaF(e.target.value)}><option value="all">All areas</option>{areas.map(a => <option key={a} value={a}>{a}</option>)}</select></th>
              <th /><th />
              <th><select className={colSel} value={techF} onChange={e => setTechF(e.target.value)}><option value="all">All techs</option>{techs.map(t => <option key={t} value={t}>{t}</option>)}</select></th>
              <th /><th /><th /><th />
            </tr>
          </thead>
          <tbody>{rows.slice(0, 200).map(j => {
            const days = diffDays(j.raised_at, closedOf(j))
            return (
              <tr key={j.id}>
                <td><Link href={cardHref(j)} className="text-accent font-semibold">{j.card_no}</Link></td>
                <td><span className={`badge ${j.workflow === 'breakdown' ? 'badge-err' : 'badge-info'}`}>{j.workflow === 'breakdown' ? 'BD' : 'PL'}</span></td>
                <td>{j.area}</td>
                <td className="text-text-muted">{j.machine ?? '—'}</td>
                <td className="max-w-[240px] truncate" title={j.description}>{j.description}</td>
                <td>{j.assigned_to ?? '—'}</td>
                <td>{j.raised_by}</td>
                <td>{fmtD(j.raised_at)}</td>
                <td>{j.status === 'cancelled' ? <span className="badge badge-gray">cancelled</span> : fmtD(closedOf(j))}</td>
                <td className={`font-semibold ${days > 7 ? 'text-warn' : 'text-ok'}`}>{days}</td>
              </tr>
            )
          })}</tbody>
        </table>
        {rows.length === 0 && <div className="p-3 text-[12px] text-text-faint text-center">No job cards match these filters.</div>}
        {rows.length > 200 && <div className="p-2 text-[11px] text-text-faint text-center">Showing first 200 of {rows.length} — narrow with search / filters.</div>}
      </div>
    </div>
  )
}

type CardRoles = { canManage: boolean; isTech: boolean; isQc: boolean; isRaiser: boolean }

// Reactive tile definitions — clicking a tile filters the card list below it.
const TILE_DEFS: { key: string; label: string; test: (j: JobCard) => boolean }[] = [
  { key: 'outstanding', label: 'Outstanding', test: j => j.status !== 'complete' && j.status !== 'cancelled' },
  { key: 'needsinput', label: 'Needs input', test: j => j.status === 'clarify' || j.status === 'verify' },
  { key: 'inprogress', label: 'In progress', test: j => ['assigned', 'in_progress', 'qc_check'].includes(j.status) },
  { key: 'completed', label: 'Completed', test: j => j.status === 'complete' },
]
const tilePredicate = (key: string | null) => key ? (TILE_DEFS.find(d => d.key === key)?.test ?? (() => true)) : () => true

// Personal raiser view: summary tiles (reactive filters) + a table of their cards.
function RaiserView({ actor, jcs, cardRoles, passes }: { actor: string; jcs: JobCard[]; cardRoles: CardRoles; passes: (j: JobCard) => boolean }) {
  const [tf, setTf] = useState<string | null>(null)
  const mine = jcs.filter(j => j.raised_by === actor).filter(passes)
  const shown = mine.filter(tilePredicate(tf)).sort(byUrgencyThenAge)
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {TILE_DEFS.map(t => {
          const on = tf === t.key
          return (
            <button key={t.key} onClick={() => setTf(on ? null : t.key)}
              className={`card p-3 text-center transition ${on ? 'border-brand bg-brand/5 ring-1 ring-brand/30' : 'hover:border-text/30'}`}>
              <div className="text-2xl font-semibold text-text tabular-nums">{mine.filter(t.test).length}</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wide mt-1">{t.key === 'needsinput' ? 'Needs my input' : t.label}</div>
            </button>
          )
        })}
      </div>
      <div className="card p-3 text-[12px] text-text-muted mb-3">
        Your job cards, <strong className="text-text">{actor}</strong>. Tap a tile to filter; click a row to see detail. Actions appear when a card needs your clarification or final verification.
      </div>
      <JobCardTable cards={shown} roles={cardRoles} empty={`No job cards raised by ${actor}.`} />
    </div>
  )
}
