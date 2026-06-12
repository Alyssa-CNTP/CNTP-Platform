'use client'

// app/(app)/maintenance/job-cards/page.tsx
// Role-aware job-card board. Manager sees new cards + status tiles + filter +
// active list, with Planner and Roster/QC-map as in-page segmented controls.
// Tech sees assigned-open; QC sees the qc_check queue; raiser (default) sees
// their own cards + summary tiles. Each card row links to job-cards/[cardId].

import { useState } from 'react'
import Link from 'next/link'
import { Plus, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import BottomSheet from '@/components/ui/BottomSheet'
import { useMaintenanceContext } from '../layout'
import { deriveMaintRole } from '@/lib/maintenance/roles'
import { JobCardItem } from '@/components/maintenance/JobCardItem'
import { RaiseJobCardForm } from '@/components/maintenance/RaiseJobCardForm'
import { AREAS, STATUSES } from '@/lib/maintenance/constants'
import { fmtD, fmtDT, fmtT, diffDays } from '@/lib/maintenance/helpers'
import { INP } from '@/components/production/shared/ui'
import type { JobCard } from '@/lib/maintenance/types'

const LB = 'text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em] mb-1 block'
const SEG = (active: boolean) =>
  `px-3.5 py-2 rounded-lg text-[12px] font-semibold whitespace-nowrap ${active ? 'bg-brand text-white' : 'text-text-muted hover:bg-surface-dim'}`

export default function JobCardsPage() {
  const auth = useAuth()
  const role = deriveMaintRole(auth)
  const ctx = useMaintenanceContext()
  const { loading, data, derived, actions, ui, actor } = ctx
  const { jcs, staff } = data
  const { cnt, newCards, hist, openPlannedCards } = derived
  const { slotForm, setSlotForm, rosterForm, setRosterForm } = ui

  // Technician names from the live staff directory (drives planner rows + pickers).
  const techNames = staff.map(s => s.name)
  const staffByName = (name: string) => staff.find(s => s.name === name)

  const [seg, setSeg] = useState(0) // 0 board, 1 planner, 2 roster & qc
  const [filt, setFilt] = useState('all')
  const [raiseOpen, setRaiseOpen] = useState(false)
  const [raiseMode, setRaiseMode] = useState<'breakdown' | 'planned'>('planned')
  const canRaiseBreakdown = auth.isProduction || auth.p('can_raise_breakdown')
  const openRaise = (mode: 'breakdown' | 'planned') => { setRaiseMode(mode); setRaiseOpen(true) }
  const [plannerWeekStart, setPlannerWeekStart] = useState(() => {
    const d = new Date(); const day = d.getDay() || 7
    d.setDate(d.getDate() - day + 1); d.setHours(0, 0, 0, 0); return d
  })

  const cardRoles = { canManage: role.canManage, isTech: role.isTech, isQc: role.isQc, isRaiser: role.isRaiser }
  const cardHref = (j: JobCard) => `/maintenance/job-cards/${j.id}`

  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(plannerWeekStart); d.setDate(d.getDate() + i); return d })
  const slotsFor = (tech: string, day: Date) => data.slots.filter(s => {
    const st = new Date(s.start_at)
    return s.technician === tech && st.getFullYear() === day.getFullYear() && st.getMonth() === day.getMonth() && st.getDate() === day.getDate()
  })

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

      {role.canManage && (
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {['Board', 'Planner', 'Roster & QC Map'].map((t, i) => (
            <button key={t} className={SEG(seg === i)} onClick={() => setSeg(i)}>{t}</button>
          ))}
        </div>
      )}

      {/* ── MANAGER: BOARD ── */}
      {role.canManage && seg === 0 && (
        <div>
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

          {/* Light, clickable status filter */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            <Chip active={filt === 'all'} onClick={() => setFilt('all')} label="Active" count={jcs.filter(j => j.status !== 'complete').length} />
            {STATUSES.map(s => <Chip key={s} active={filt === s} onClick={() => setFilt(f => (f === s ? 'all' : s))} label={s.replace(/_/g, ' ')} count={cnt(s)} />)}
          </div>

          <div className="stagger">
            {(filt === 'all' ? jcs.filter(j => j.status !== 'complete') : jcs.filter(j => j.status === filt))
              .filter(j => j.status !== 'raised' || filt !== 'all')
              .map(j => <JobCardItem key={j.id} j={j} roles={cardRoles} />)}
          </div>

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

      {/* ── MANAGER: PLANNER ── */}
      {role.canManage && seg === 1 && (
        <div className="card p-4">
          <div className="text-sm font-semibold text-text mb-3">Technician Planner — Estimated Time Slots</div>
          <div className="flex gap-2 flex-wrap items-end mb-3">
            <div><label className={LB}>Job Card</label>
              <select className={`${INP} w-[230px]`} value={slotForm.cardId} onChange={e => setSlotForm(p => ({ ...p, cardId: e.target.value }))}>
                <option value="">(no card — general slot)</option>
                {openPlannedCards.map(c => <option key={c.id} value={c.id}>{c.card_no} — {c.area}: {c.description.slice(0, 40)}</option>)}
              </select>
            </div>
            <div><label className={LB}>Technician</label><select className={`${INP} w-28`} value={slotForm.tech} onChange={e => { const s = staffByName(e.target.value); setSlotForm(p => ({ ...p, tech: e.target.value, techId: s?.id ?? null })) }}>{techNames.map(t => <option key={t}>{t}</option>)}</select></div>
            <div><label className={LB}>Date</label><input className={`${INP} w-36`} type="date" value={slotForm.date} onChange={e => setSlotForm(p => ({ ...p, date: e.target.value }))} /></div>
            <div><label className={LB}>Start</label><input className={`${INP} w-24`} type="time" value={slotForm.time} onChange={e => setSlotForm(p => ({ ...p, time: e.target.value }))} /></div>
            <div><label className={LB}>Est. Hours</label><input className={`${INP} w-20`} type="number" min={0.5} step={0.5} value={slotForm.hours} onChange={e => setSlotForm(p => ({ ...p, hours: e.target.value }))} /></div>
            <div className="flex-1 min-w-[120px]"><label className={LB}>Note</label><input className={INP} value={slotForm.note} onChange={e => setSlotForm(p => ({ ...p, note: e.target.value }))} placeholder="Optional note…" /></div>
            <button className="bg-ok text-white rounded-lg px-4 py-2.5 text-sm font-semibold" onClick={actions.addSlot}>+ Slot</button>
          </div>
          <div className="flex gap-2 items-center mb-2">
            <button className={SEG(false)} onClick={() => setPlannerWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })}>← Prev</button>
            <span className="text-[12px] text-text-muted">Week of {fmtD(plannerWeekStart.toISOString())}</span>
            <button className={SEG(false)} onClick={() => setPlannerWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })}>Next →</button>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Technician</th>{weekDays.map(d => <th key={d.toISOString()}>{d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}</th>)}</tr></thead>
              <tbody>{techNames.map(t => (
                <tr key={t}>
                  <td className="font-semibold">{t}</td>
                  {weekDays.map(d => {
                    const cellSlots = slotsFor(t, d)
                    return (
                      <td
                        key={d.toISOString()}
                        onClick={() => { if (cellSlots.length === 0) actions.addSlotFor(t, staffByName(t)?.id ?? null, d) }}
                        className={`align-top min-w-[110px] min-h-[44px] ${cellSlots.length === 0 ? 'cursor-pointer hover:bg-surface-dim' : ''}`}
                        title={cellSlots.length === 0 ? `Add a slot for ${t}` : undefined}>
                        {cellSlots.length === 0 && <span className="text-[16px] text-text-faint leading-none">+</span>}
                        {cellSlots.map(s => {
                          const c = jcs.find(x => x.id === s.card_id)
                          return (
                            <div key={s.id} className="bg-info/10 border border-info/20 rounded p-1.5 mb-1 cursor-pointer hover:border-err/40"
                              onClick={ev => { ev.stopPropagation(); actions.delSlot(s.id) }}
                              title="Tap to remove this slot">
                              <div className="font-semibold text-info text-[11px]">{fmtT(s.start_at)}–{fmtT(s.end_at)}</div>
                              {c && <div className="text-accent text-[11px]">{c.card_no}</div>}
                              {(s.note || c) && <div className="text-text-muted text-[11px]">{s.note || c?.description.slice(0, 30)}</div>}
                              <button className="mt-1 text-[10px] px-1.5 py-0.5 rounded bg-err text-white" onClick={ev => { ev.stopPropagation(); actions.delSlot(s.id) }}>✕</button>
                            </div>
                          )
                        })}
                      </td>
                    )
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="text-[11px] text-text-faint mt-2">Tap an empty cell to add a quick 2-hour slot, or tap a slot to remove it. Use the form above for card-linked slots with notes. Slots are estimates — actual durations come from the job card timer.</div>
        </div>
      )}

      {/* ── MANAGER: ROSTER & QC MAP ── */}
      {role.canManage && seg === 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="text-sm font-semibold text-text mb-2">Duty Roster — Breakdown Auto-Assign</div>
            <div className="rounded-lg bg-info/10 border border-info/20 p-2 mb-2 text-[12px] text-text">
              This roster is what <strong>auto-routes breakdowns</strong>: a breakdown raised during a duty slot goes straight to that technician.
              Currently on duty: <strong className={derived.duty ? 'text-ok' : 'text-err'}>{derived.duty ?? 'NOBODY'}</strong>
            </div>
            <div className="flex gap-2 flex-wrap items-end mb-2.5">
              <div><label className={LB}>Technician</label><select className={`${INP} w-28`} value={rosterForm.tech} onChange={e => { const s = staffByName(e.target.value); setRosterForm(p => ({ ...p, tech: e.target.value, techId: s?.id ?? null })) }}>{techNames.map(t => <option key={t}>{t}</option>)}</select></div>
              <div><label className={LB}>From</label><input className={`${INP} w-44`} type="datetime-local" value={rosterForm.start} onChange={e => setRosterForm(p => ({ ...p, start: e.target.value }))} /></div>
              <div><label className={LB}>To</label><input className={`${INP} w-44`} type="datetime-local" value={rosterForm.end} onChange={e => setRosterForm(p => ({ ...p, end: e.target.value }))} /></div>
              <button className="bg-ok text-white rounded-lg px-4 py-2.5 text-sm font-semibold min-h-[44px]" onClick={actions.addRoster}>+ Add</button>
            </div>

            {/* Weekly view grouped by day */}
            {(() => {
              const now = Date.now()
              const upcoming = data.roster.filter(r => new Date(r.end_at).getTime() > now - 7 * 86400000)
                .sort((a, b) => a.start_at.localeCompare(b.start_at))
              if (upcoming.length === 0) return <div className="text-[12px] text-text-faint">No duty slots yet — breakdowns will wait for manager allocation until a roster exists.</div>
              const byDay = upcoming.reduce((m: Record<string, typeof upcoming>, r) => {
                const key = fmtD(r.start_at); (m[key] ??= []).push(r); return m
              }, {})
              return Object.entries(byDay).map(([day, rows]) => (
                <div key={day} className="mb-2">
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">{day}</div>
                  {rows.map(r => {
                    const onNow = new Date(r.start_at).getTime() <= now && now <= new Date(r.end_at).getTime()
                    return (
                      <div key={r.id} className={`flex gap-2 items-center text-[12px] px-2 py-2 rounded mb-1 ${onNow ? 'bg-ok/15 border border-ok/40' : 'bg-surface-raised'}`}>
                        <strong className="w-20">{r.technician}</strong>
                        {onNow && <span className="badge badge-ok">ON DUTY NOW</span>}
                        <span className="text-text-muted flex-1">{fmtT(r.start_at)} → {fmtDT(r.end_at)}</span>
                        <button className="min-h-[28px] text-[10px] px-2 py-1 rounded bg-err text-white" onClick={() => actions.delRoster(r.id)}>✕</button>
                      </div>
                    )
                  })}
                </div>
              ))
            })()}
          </div>
          <div className="card p-4">
            <div className="text-sm font-semibold text-text mb-2">Station / Area → QC Officer Map</div>
            <div className="text-[12px] text-text-muted mb-2">Completed jobs route to the QC mapped to their area for the post-maintenance check. Pick a name from your staff directory.</div>
            <div className="max-h-[420px] overflow-y-auto">
              {AREAS.map(a => {
                const current = actions.qcFor(a)
                const known = staff.some(s => s.name === current)
                return (
                  <div key={a} className="flex gap-1.5 items-center mb-1">
                    <span className="text-[12px] w-44 text-text-muted">{a}</span>
                    <select className={`${INP} flex-1 min-h-[40px]`} value={known ? current : (current ? '__free__' : '')}
                      onChange={e => {
                        const v = e.target.value
                        if (v === '__free__') return
                        const s = staff.find(x => x.name === v)
                        actions.saveAreaQc(a, v, s?.id ?? null)
                      }}>
                      <option value="">— unassigned —</option>
                      {!known && current && <option value="__free__">{current} (manual)</option>}
                      {staff.map(s => <option key={s.id ?? s.name} value={s.name}>{s.name}</option>)}
                    </select>
                  </div>
                )
              })}
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
