'use client'

// app/(app)/maintenance/job-cards/page.tsx
// Role-aware job-card board. Manager sees new cards + a priority-grouped active
// board (High / Medium / Low) + status filter + history. Planner and Roster/QC
// map now live at /maintenance/planner. Tech sees assigned-open; QC sees the
// qc_check queue; raiser (default) sees their own cards + summary tiles. Each
// card row links to job-cards/[cardId].

import { useState } from 'react'
import Link from 'next/link'
import { Plus, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
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
  const [raiseOpen, setRaiseOpen] = useState(false)
  const [raiseMode, setRaiseMode] = useState<'breakdown' | 'planned'>('planned')
  // Priority groups: High & Medium open by default, Low collapsed.
  const [openPrio, setOpenPrio] = useState<Record<Priority, boolean>>({ high: true, medium: true, low: false })
  const canRaiseBreakdown = auth.isProduction || auth.p('can_raise_breakdown')
  const openRaise = (mode: 'breakdown' | 'planned') => { setRaiseMode(mode); setRaiseOpen(true) }

  const cardRoles = { canManage: role.canManage, isTech: role.isTech, isQc: role.isQc, isRaiser: role.isRaiser }
  const cardHref = (j: JobCard) => `/maintenance/job-cards/${j.id}`

  // Active cards = not complete, excluding the freshly-raised ones (shown above in
  // "Awaiting allocation"). When a status filter is selected, narrow to it.
  const activeCards = jcs
    .filter(j => j.status !== 'complete' && j.status !== 'raised')
    .filter(j => filt === 'all' || j.status === filt)
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

          {/* Light, clickable status filter — narrows which cards show in each group */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            <Chip active={filt === 'all'} onClick={() => setFilt('all')} label="Active" count={jcs.filter(j => j.status !== 'complete').length} />
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
                    ? <div className="stagger mt-1">{cards.map(j => <JobCardItem key={j.id} j={j} roles={cardRoles} />)}</div>
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
        <RaiserView actor={actor} jcs={jcs} cardRoles={cardRoles} />
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
  const accepted = jcs.filter(j => inShift(j.accepted_at))
  const checklists = completions.filter(c => inShift(c.updated_at)).length

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
        {[
          { l: 'Breakdowns raised', v: breakdowns.length, hot: breakdowns.length > 0 },
          { l: 'Job cards raised', v: raised.length },
          { l: 'Accepted / started', v: accepted.length },
          { l: 'Finished', v: finished.length },
          { l: 'Checklists worked', v: checklists },
        ].map(t => (
          <div key={t.l} className="bg-surface-raised rounded-lg p-2.5 text-center">
            <div className={`text-xl font-semibold tabular-nums ${t.hot ? 'text-err' : 'text-text'}`}>{t.v}</div>
            <div className="text-[10px] text-text-muted uppercase tracking-wide mt-0.5">{t.l}</div>
          </div>
        ))}
      </div>
      {(raised.length > 0 || finished.length > 0) ? (
        <div className="space-y-1 text-[12px]">
          {breakdowns.map(j => <div key={'b' + j.id}><span className="badge badge-err mr-1.5">BREAKDOWN</span><Link href={cardHref(j)} className="text-accent font-semibold">{j.card_no}</Link> {j.area} — {j.description} <span className="text-text-faint">({fmtT(j.raised_at)}, by {j.raised_by}{j.assigned_to ? ', → ' + j.assigned_to : ''})</span></div>)}
          {raised.filter(j => j.workflow !== 'breakdown').map(j => <div key={'r' + j.id}><span className="badge badge-warn mr-1.5">RAISED</span><Link href={cardHref(j)} className="text-accent font-semibold">{j.card_no}</Link> {j.area} — {j.description} <span className="text-text-faint">({fmtT(j.raised_at)}, by {j.raised_by})</span></div>)}
          {finished.map(j => <div key={'c' + j.id}><span className="badge badge-ok mr-1.5">FINISHED</span><Link href={cardHref(j)} className="text-accent font-semibold">{j.card_no}</Link> {j.area} — {j.description} <span className="text-text-faint">({j.assigned_to ?? '—'}, {diffM(j.workflow === 'breakdown' ? j.raised_at : j.accepted_at, j.completed_at)} min)</span></div>)}
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

function RaiserView({ actor, jcs, cardRoles }: { actor: string; jcs: JobCard[]; cardRoles: { canManage: boolean; isTech: boolean; isQc: boolean; isRaiser: boolean } }) {
  const mine = jcs.filter(j => j.raised_by === actor)
  const tiles: { label: string; value: number }[] = [
    { label: 'Outstanding', value: mine.filter(j => j.status !== 'complete').length },
    { label: 'Needs my input', value: mine.filter(j => j.status === 'clarify' || j.status === 'verify').length },
    { label: 'In progress', value: mine.filter(j => ['assigned', 'in_progress', 'qc_check'].includes(j.status)).length },
    { label: 'Completed', value: mine.filter(j => j.status === 'complete').length },
  ]
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {tiles.map(t => (
          <div key={t.label} className="card p-3 text-center">
            <div className="text-2xl font-semibold text-text tabular-nums">{t.value}</div>
            <div className="text-[10px] text-text-muted uppercase tracking-wide mt-1">{t.label}</div>
          </div>
        ))}
      </div>
      <div className="card p-3 text-[12px] text-text-muted mb-3">
        Your job cards, <strong className="text-text">{actor}</strong>. Actions appear when a card needs your clarification or final verification.
      </div>
      <div className="stagger">{mine.map(j => <JobCardItem key={j.id} j={j} roles={cardRoles} />)}</div>
      {mine.length === 0 && <div className="card p-4 text-center text-[12px] text-text-faint">No job cards raised by {actor}.</div>}
    </div>
  )
}
