'use client'

// app/(app)/maintenance/job-cards/page.tsx
// Role-aware job-card board. Manager sees new cards + a priority-grouped active
// board (High / Medium / Low) + status filter + history. Planner and Roster/QC
// map now live at /maintenance/planner. Tech sees assigned-open; QC sees the
// qc_check queue; raiser (default) sees their own cards + summary tiles. Each
// card row links to job-cards/[cardId].

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Plus, AlertTriangle, ChevronDown, ChevronRight, Users, Search, Download, Printer } from 'lucide-react'
import { exportJobCardsCsv, printJobCards } from '@/lib/maintenance/exporters'
import { useAuth } from '@/lib/auth/context'
import BottomSheet from '@/components/ui/BottomSheet'
import { useMaintenanceContext } from '../layout'
import { deriveMaintRole } from '@/lib/maintenance/roles'
import { JobCardItem } from '@/components/maintenance/JobCardItem'
import { RaiseJobCardForm } from '@/components/maintenance/RaiseJobCardForm'
import { STATUSES } from '@/lib/maintenance/constants'
import { fmtD, fmtT, diffDays, diffM, priorityOf, PRIORITY_META, type Priority } from '@/lib/maintenance/helpers'
import { INP } from '@/components/production/shared/ui'
import type { JobCard } from '@/lib/maintenance/types'

const SEG = (active: boolean) =>
  `px-3.5 py-2 rounded-lg text-[12px] font-semibold whitespace-nowrap ${active ? 'bg-brand text-white' : 'text-text-muted hover:bg-surface-dim'}`

const PRIO_ORDER: Priority[] = ['high', 'medium', 'low']

export default function JobCardsPage() {
  const auth = useAuth()
  const baseRole = deriveMaintRole(auth)
  const ctx = useMaintenanceContext()
  const { loading, data, derived, actions, ui, actor } = ctx
  const { jcs } = data
  const { cnt, newCards, hist } = derived

  // IT / full admin get the full view of every profile via a "View as" switcher.
  // Everyone else keeps their single derived role.
  const [viewAs, setViewAs] = useState<'manager' | 'tech' | 'qc' | 'raiser'>('manager')
  const role = baseRole.isAdminView
    ? { ...baseRole, canManage: viewAs === 'manager', isTech: viewAs === 'tech', isQc: viewAs === 'qc', isRaiser: viewAs === 'raiser' }
    : baseRole

  const [filt, setFilt] = useState('all')
  const [search, setSearch] = useState('')
  const [techFilt, setTechFilt] = useState('all') // filter the board by the technician working the card
  const [raiseOpen, setRaiseOpen] = useState(false)
  const [raiseMode, setRaiseMode] = useState<'breakdown' | 'planned'>('planned')
  // Priority groups: High & Medium open by default, Low collapsed.
  const [openPrio, setOpenPrio] = useState<Record<Priority, boolean>>({ high: true, medium: true, low: false })
  const canRaiseBreakdown = auth.isProduction || auth.p('can_raise_breakdown')
  const openRaise = (mode: 'breakdown' | 'planned') => { setRaiseMode(mode); setRaiseOpen(true) }
  // IT (admin view) and the maintenance manager may browse every raiser's cards;
  // everyone else only ever sees their own.
  const canSeeAllRaisers = baseRole.isAdminView || auth.role === 'maintenance_manager'

  const cardRoles = { canManage: role.canManage, isTech: role.isTech, isQc: role.isQc, isRaiser: role.isRaiser }
  const cardHref = (j: JobCard) => `/maintenance/job-cards/${j.id}`

  // Free-text search across the human-meaningful fields.
  const q = search.trim().toLowerCase()
  const matchesSearch = (j: JobCard) => !q || [j.card_no, j.area, j.machine, j.description, j.long_desc, j.raised_by, j.assigned_to]
    .some(v => (v ?? '').toLowerCase().includes(q))

  // Technicians who have cards assigned to them — drives the "By technician" filter.
  const techNames = useMemo(
    () => Array.from(new Set(jcs.map(j => j.assigned_to).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [jcs])

  // Active cards = not complete/cancelled, excluding the freshly-raised ones (shown
  // above in "Awaiting allocation"). Status / technician / search filters narrow it.
  const activeCards = jcs
    .filter(j => j.status !== 'complete' && j.status !== 'cancelled' && j.status !== 'raised')
    .filter(j => filt === 'all' || j.status === filt)
    .filter(j => techFilt === 'all' || j.assigned_to === techFilt)
    .filter(matchesSearch)
  // Group by derived priority, oldest-first within each group.
  const byPriority = (p: Priority) =>
    activeCards.filter(j => priorityOf(j) === p).sort((a, b) => a.raised_at.localeCompare(b.raised_at))

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

      {/* ── MANAGER: BOARD (priority-grouped) ── */}
      {role.canManage && (
        <div>
          <ShiftSummary jcs={jcs} completions={data.completions} cardHref={cardHref} />

          {canSeeAllRaisers && <RaisersPanel jcs={jcs} cardRoles={cardRoles} />}

          {newCards.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-warn" />
                <h2 className="text-sm font-semibold text-text">Awaiting allocation</h2>
                <span className="text-[11px] text-text-muted tabular-nums">{newCards.length}</span>
              </div>
              <div className="stagger">{newCards.map(j => <JobCardItem key={j.id} j={j} roles={cardRoles} />)}</div>
            </div>
          )}

          {/* Search + technician filter + export */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
              <input className={`${INP} w-full pl-8`} placeholder="Search job cards — number, machine, description, person…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className={`${INP} w-auto`} value={techFilt} onChange={e => setTechFilt(e.target.value)} title="Filter by the technician working the card">
              <option value="all">All technicians</option>
              {techNames.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={() => exportJobCardsCsv(activeCards)} title="Export visible cards to CSV"
              className="inline-flex items-center gap-1.5 border border-surface-rule bg-surface-card text-text rounded-lg px-3 py-2.5 text-[12px] font-semibold hover:border-text/30 transition"><Download size={14} /> Export</button>
            <button onClick={() => printJobCards(activeCards, 'Active job cards')} title="Print visible cards"
              className="inline-flex items-center gap-1.5 border border-surface-rule bg-surface-card text-text rounded-lg px-3 py-2.5 text-[12px] font-semibold hover:border-text/30 transition"><Printer size={14} /> Print</button>
          </div>

          {/* Light, clickable status filter — narrows which cards show in each group */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            <Chip active={filt === 'all'} onClick={() => setFilt('all')} label="Active" count={jcs.filter(j => j.status !== 'complete' && j.status !== 'cancelled').length} />
            {STATUSES.map(s => <Chip key={s} active={filt === s} onClick={() => setFilt(f => (f === s ? 'all' : s))} label={s.replace(/_/g, ' ')} count={cnt(s)} />)}
          </div>

          {/* Priority sections — High & Medium open, Low collapsed */}
          {PRIO_ORDER.map(p => {
            const cards = byPriority(p)
            const meta = PRIORITY_META[p]
            const open = openPrio[p]
            return (
              <div key={p} className="mb-3">
                <button onClick={() => setOpenPrio(s => ({ ...s, [p]: !s[p] }))}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-surface-dim/60 transition text-left">
                  {open ? <ChevronDown size={16} className="text-text-muted shrink-0" /> : <ChevronRight size={16} className="text-text-muted shrink-0" />}
                  <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                  <span className="text-sm font-semibold text-text">{meta.label} priority</span>
                  <span className="text-[11px] text-text-muted tabular-nums">{cards.length}</span>
                </button>
                {open && (
                  cards.length > 0
                    ? <div className="stagger mt-1 grid lg:grid-cols-2 gap-x-4 items-start">{cards.map(j => <JobCardItem key={j.id} j={j} roles={cardRoles} />)}</div>
                    : <div className="text-[12px] text-text-faint px-3 py-2">No {meta.label.toLowerCase()}-priority cards{filt !== 'all' ? ' for this status' : ''}.</div>
                )}
              </div>
            )
          })}

          {/* Historical */}
          <div className="card p-4 mt-2">
            <div className="text-sm font-semibold text-text mb-3">Historical Job Cards (Last 20)</div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr>{['#', 'Type', 'Area', 'Description', 'Tech', 'By', 'Raised', 'Closed', 'Days'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{hist.map(j => {
                  const days = diffDays(j.raised_at, j.completed_at ?? j.verified_at)
                  return (
                    <tr key={j.id}>
                      <td><Link href={cardHref(j)} className="text-accent font-semibold">{j.card_no}</Link></td>
                      <td><span className={`badge ${j.workflow === 'breakdown' ? 'badge-err' : 'badge-info'}`}>{j.workflow === 'breakdown' ? 'BD' : 'PL'}</span></td>
                      <td>{j.area}</td>
                      <td className="max-w-[220px]">{j.description}</td>
                      <td>{j.assigned_to ?? '—'}</td>
                      <td>{j.raised_by}</td>
                      <td>{fmtD(j.raised_at)}</td>
                      <td>{fmtD(j.completed_at ?? j.verified_at)}</td>
                      <td className={`font-semibold ${days > 7 ? 'text-warn' : 'text-ok'}`}>{days}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TECHNICIAN VIEW ── */}
      {!role.canManage && role.isTech && (
        <div>
          <div className="card p-3 text-[12px] text-text-muted mb-3">
            Showing job cards assigned to <strong className="text-text">{actor}</strong>. Breakdown cards run their timer from the moment they were raised.
          </div>
          <div className="stagger">
            {jcs.filter(j => j.assigned_to === actor && !j.external && j.status !== 'complete').map(j => <JobCardItem key={j.id} j={j} roles={cardRoles} />)}
          </div>
          {jcs.filter(j => j.assigned_to === actor && !j.external && j.status !== 'complete').length === 0 && <div className="card p-4 text-center text-[12px] text-text-faint">No open job cards assigned to {actor}.</div>}
        </div>
      )}

      {/* ── QC VIEW ── */}
      {!role.canManage && !role.isTech && role.isQc && (
        <div>
          <div className="card p-3 text-[12px] text-text-muted mb-3">
            Job cards awaiting QC post-maintenance checks — answer YES / NO / N/A; any YES returns the card to the technician with your comment.
          </div>
          <div className="stagger">
            {[...jcs.filter(j => j.status === 'qc_check')].sort((a, b) => (actions.qcFor(b.area) === actor ? 1 : 0) - (actions.qcFor(a.area) === actor ? 1 : 0)).map(j => <JobCardItem key={j.id} j={j} roles={cardRoles} />)}
          </div>
          {jcs.filter(j => j.status === 'qc_check').length === 0 && <div className="card p-4 text-center text-[12px] text-text-faint">Nothing waiting for QC.</div>}
        </div>
      )}

      {/* ── RAISER DASHBOARD (default) ── */}
      {!role.canManage && !role.isTech && !role.isQc && (
        <RaiserView actor={actor} jcs={jcs} cardRoles={cardRoles} canSeeAll={canSeeAllRaisers} />
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

type CardRoles = { canManage: boolean; isTech: boolean; isQc: boolean; isRaiser: boolean }

// Reactive tile definitions — clicking a tile filters the card list below it.
const TILE_DEFS: { key: string; label: string; test: (j: JobCard) => boolean }[] = [
  { key: 'outstanding', label: 'Outstanding', test: j => j.status !== 'complete' && j.status !== 'cancelled' },
  { key: 'needsinput', label: 'Needs input', test: j => j.status === 'clarify' || j.status === 'verify' },
  { key: 'inprogress', label: 'In progress', test: j => ['assigned', 'in_progress', 'qc_check'].includes(j.status) },
  { key: 'completed', label: 'Completed', test: j => j.status === 'complete' },
]
const tilePredicate = (key: string | null) => key ? (TILE_DEFS.find(d => d.key === key)?.test ?? (() => true)) : () => true

// Summary tiles for a set of cards (re-used by the personal raiser view and the
// per-raiser tabs). Each tile is a reactive filter button.
function RaiserTiles({ cards, active, onPick, labels }: { cards: JobCard[]; active: string | null; onPick: (k: string | null) => void; labels?: Record<string, string> }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {TILE_DEFS.map(t => {
        const on = active === t.key
        return (
          <button key={t.key} onClick={() => onPick(on ? null : t.key)}
            className={`card p-3 text-center transition ${on ? 'border-brand bg-brand/5 ring-1 ring-brand/30' : 'hover:border-text/30'}`}>
            <div className="text-2xl font-semibold text-text tabular-nums">{cards.filter(t.test).length}</div>
            <div className="text-[10px] text-text-muted uppercase tracking-wide mt-1">{labels?.[t.key] ?? t.label}</div>
          </button>
        )
      })}
    </div>
  )
}

// IT / maintenance-manager view: a tab per person who has raised job cards, plus
// an "All" tab. Selecting a tab shows that raiser's summary tiles + their cards.
function RaisersPanel({ jcs, cardRoles }: { jcs: JobCard[]; cardRoles: CardRoles }) {
  const raisers = useMemo(() => {
    const counts = new Map<string, number>()
    for (const j of jcs) {
      const r = (j.raised_by ?? '').trim()
      if (r) counts.set(r, (counts.get(r) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }))
  }, [jcs])

  const [sel, setSel] = useState<string>('__all__')
  const [tf, setTf] = useState<string | null>(null)
  const withRaiser = jcs.filter(j => (j.raised_by ?? '').trim())
  const cards = (sel === '__all__' ? withRaiser : jcs.filter(j => (j.raised_by ?? '').trim() === sel))
    .slice()
    .sort((a, b) => b.raised_at.localeCompare(a.raised_at))
  const shown = cards.filter(tilePredicate(tf))

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Users size={16} className="text-text-muted" />
        <h2 className="text-sm font-semibold text-text">By raiser</h2>
        <span className="text-[11px] text-text-muted">{raisers.length} {raisers.length === 1 ? 'person' : 'people'}</span>
      </div>

      {raisers.length === 0 ? (
        <div className="text-[12px] text-text-faint">No job cards have been raised yet.</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button onClick={() => setSel('__all__')} className={SEG(sel === '__all__')}>
              All <span className="opacity-70 tabular-nums">{withRaiser.length}</span>
            </button>
            {raisers.map(r => (
              <button key={r.name} onClick={() => setSel(r.name)} className={SEG(sel === r.name)}>
                {r.name} <span className="opacity-70 tabular-nums">{r.count}</span>
              </button>
            ))}
          </div>
          <RaiserTiles cards={cards} active={tf} onPick={setTf} />
          <div className="stagger grid lg:grid-cols-2 gap-x-4 items-start">{shown.map(j => <JobCardItem key={j.id} j={j} roles={cardRoles} />)}</div>
          {shown.length === 0 && <div className="text-[12px] text-text-faint px-1 py-2">No cards match this filter.</div>}
        </>
      )}
    </div>
  )
}

function RaiserView({ actor, jcs, cardRoles, canSeeAll }: { actor: string; jcs: JobCard[]; cardRoles: CardRoles; canSeeAll: boolean }) {
  // IT / maintenance manager browse everyone via the per-raiser tabs.
  if (canSeeAll) return <RaisersPanel jcs={jcs} cardRoles={cardRoles} />

  const [tf, setTf] = useState<string | null>(null)
  const mine = jcs.filter(j => j.raised_by === actor)
  const shown = mine.filter(tilePredicate(tf))
  return (
    <div>
      <RaiserTiles cards={mine} active={tf} onPick={setTf} labels={{ needsinput: 'Needs my input' }} />
      <div className="card p-3 text-[12px] text-text-muted mb-3">
        Your job cards, <strong className="text-text">{actor}</strong>. Tap a tile above to filter. Actions appear when a card needs your clarification or final verification.
      </div>
      <div className="stagger grid lg:grid-cols-2 gap-x-4 items-start">{shown.map(j => <JobCardItem key={j.id} j={j} roles={cardRoles} />)}</div>
      {mine.length === 0 && <div className="card p-4 text-center text-[12px] text-text-faint">No job cards raised by {actor}.</div>}
      {mine.length > 0 && shown.length === 0 && <div className="text-[12px] text-text-faint px-1 py-2">No cards match this filter.</div>}
    </div>
  )
}
