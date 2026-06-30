'use client'

// app/(app)/maintenance/planner/page.tsx
// Planner & Roster — a proper week calendar for the maintenance team.
// Top "next" strip surfaces who is on duty now, who is up next on the roster,
// and the next scheduled job. Below sit three collapsible sections:
//   • This week — a 7-day Mon–Sun calendar of planner slots + duty windows
//   • Duty roster — the editable list that auto-routes breakdowns
//   • QC area map — area → QC officer mapping
// All data + mutations come from the shared maintenance context unchanged.
// Editing controls are gated to managers; everyone else sees a read-only view.

import { useState } from 'react'
import Link from 'next/link'
import {
  ChevronDown, ChevronRight, CalendarRange, UserCheck, Clock3, Wrench, Plus, Users,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useMaintenanceContext } from '../layout'
import { deriveMaintRole } from '@/lib/maintenance/roles'
import { AREAS } from '@/lib/maintenance/constants'
import { fmtD, fmtT, fmtDT } from '@/lib/maintenance/helpers'
import { INP } from '@/components/production/shared/ui'

const LB = 'text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em] mb-1 block'
const PRIMARY = 'bg-brand text-white rounded-lg px-4 py-2.5 text-sm font-semibold min-h-[44px] hover:brightness-110 transition'

function startOfWeek(d: Date) {
  const x = new Date(d)
  const day = x.getDay() || 7
  x.setDate(x.getDate() - day + 1)
  x.setHours(0, 0, 0, 0)
  return x
}
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

// ── Per-technician pastel identity colours ──────────────────────────────────
// Each technician gets a stable pastel (by name hash) so their duty windows and
// planner slots are instantly recognisable across the calendar.
// Maximally-distinct hues (violet → blue → green → amber → rose → cyan → orange →
// fuchsia) so the first ~8 technicians are each clearly different. Borders/dots
// are saturated for a "defining" edge; backgrounds stay soft.
interface Pastel { bg: string; border: string; text: string; dot: string }
const TECH_PALETTE: Pastel[] = [
  { bg: '#EDE9FE', border: '#8B5CF6', text: '#5B21B6', dot: '#7C3AED' }, // violet
  { bg: '#DBEAFE', border: '#3B82F6', text: '#1D4ED8', dot: '#2563EB' }, // blue
  { bg: '#D1FAE5', border: '#10B981', text: '#047857', dot: '#059669' }, // emerald
  { bg: '#FEF3C7', border: '#F59E0B', text: '#B45309', dot: '#D97706' }, // amber
  { bg: '#FFE4E6', border: '#F43F5E', text: '#BE123C', dot: '#E11D48' }, // rose
  { bg: '#CFFAFE', border: '#06B6D4', text: '#0E7490', dot: '#0891B2' }, // cyan
  { bg: '#FFEDD5', border: '#F97316', text: '#C2410C', dot: '#EA580C' }, // orange
  { bg: '#FAE8FF', border: '#D946EF', text: '#A21CAF', dot: '#C026D3' }, // fuchsia
]
function hashName(name: string) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h
}

export default function PlannerPage() {
  const auth = useAuth()
  const role = deriveMaintRole(auth)
  const canManage = role.canManage
  const ctx = useMaintenanceContext()
  const { loading, data, derived, actions, ui } = ctx
  const { jcs, slots, roster, staff } = data
  const { duty, dutyNow, openPlannedCards } = derived
  const { slotForm, setSlotForm } = ui

  // Technicians come from the live staff directory (falls back to TECHS).
  const techNames = staff.map(s => s.name)
  const staffByName = (name: string) => staff.find(s => s.name === name)
  // Stable per-technician colour: assign by position in the staff list so the
  // first technicians get the most-distinct hues; hash as a fallback.
  const techIndex = new Map(techNames.map((t, i) => [t, i]))
  const colorFor = (name: string) => TECH_PALETTE[(techIndex.has(name) ? techIndex.get(name)! : hashName(name)) % TECH_PALETTE.length]

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [openWeek, setOpenWeek] = useState(true)
  const [openRoster, setOpenRoster] = useState(true)
  const [openQc, setOpenQc] = useState(false)
  const [openAddSlot, setOpenAddSlot] = useState(false)

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i); return d
  })
  const weekEnd = weekDays[6]

  const now = new Date()
  const nowMs = now.getTime()

  // Slots / roster windows that fall on a given calendar day.
  const slotsOn = (day: Date) =>
    slots.filter(s => sameDay(new Date(s.start_at), day))
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
  // A roster window shows on every day it overlaps.
  const rosterOn = (day: Date) => {
    const ds = new Date(day); ds.setHours(0, 0, 0, 0)
    const de = new Date(day); de.setHours(23, 59, 59, 999)
    return roster.filter(r => new Date(r.start_at) <= de && new Date(r.end_at) >= ds)
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
  }

  // ── "Next" strip selectors ──
  const upNextRoster = [...roster]
    .filter(r => new Date(r.start_at).getTime() > nowMs)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0] ?? null
  const nextJob = [...slots]
    .filter(s => new Date(s.start_at).getTime() > nowMs)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0] ?? null
  const nextJobCard = nextJob ? jcs.find(c => c.id === nextJob.card_id) : null

  if (loading) {
    return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="card p-6 text-text-muted text-sm">Loading planner…</div></div>
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text flex items-center gap-2"><CalendarRange className="w-6 h-6 text-brand" /> Planner &amp; Roster</h1>
          <p className="text-sm text-text-muted mt-1">Who is on duty, who is up next, and every scheduled slot — on one calendar.</p>
        </div>
      </div>

      {/* ── "Next" strip — glanceable, colour-cued ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {/* On duty now */}
        <div className={`rounded-xl border p-4 ${duty ? 'border-ok/30 bg-ok/5' : 'border-err/30 bg-err/5'}`}>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            <UserCheck className={`w-4 h-4 ${duty ? 'text-ok' : 'text-err'}`} /> On duty now
          </div>
          {duty
            ? <div className="mt-1.5 text-lg font-semibold text-ok flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorFor(duty).dot }} />{duty}</div>
            : <div className="mt-1.5 text-sm font-semibold text-err">Nobody — breakdowns will wait</div>}
          <div className="text-[11px] text-text-faint mt-1">Breakdowns auto-route to the on-duty technician.</div>
        </div>

        {/* Up next on roster */}
        <div className="rounded-xl border border-surface-rule bg-surface-card p-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            <Clock3 className="w-4 h-4 text-info" /> Up next on roster
          </div>
          {upNextRoster
            ? <>
                <div className="mt-1.5 text-lg font-semibold text-text flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorFor(upNextRoster.technician).dot }} />{upNextRoster.technician}</div>
                <div className="text-[12px] text-text-muted mt-0.5">{fmtDT(upNextRoster.start_at)} → {fmtT(upNextRoster.end_at)}</div>
              </>
            : <div className="mt-1.5 text-sm text-text-faint">No upcoming duty slots.</div>}
        </div>

        {/* Next scheduled job */}
        <div className="rounded-xl border border-surface-rule bg-surface-card p-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            <Wrench className="w-4 h-4 text-accent" /> Next scheduled job
          </div>
          {nextJob
            ? <>
                <div className="mt-1.5 text-sm font-semibold text-text">
                  {nextJobCard ? <span className="text-accent">{nextJobCard.card_no}</span> : 'General slot'}
                  <span className="text-text-muted font-normal"> · {nextJob.technician}</span>
                </div>
                <div className="text-[12px] text-text-muted mt-0.5">{fmtDT(nextJob.start_at)} → {fmtT(nextJob.end_at)}</div>
                {(nextJob.note || nextJobCard) && <div className="text-[11px] text-text-faint mt-0.5 truncate">{nextJob.note || nextJobCard?.description}</div>}
              </>
            : <div className="mt-1.5 text-sm text-text-faint">Nothing scheduled ahead.</div>}
        </div>
      </div>

      {/* ── Per-technician status — what each person is busy with + outstanding ── */}
      {techNames.length > 0 && (
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Users size={16} className="text-text-muted" />
            <h2 className="text-sm font-semibold text-text">Per-technician status</h2>
            <span className="text-[11px] text-text-muted">what each person is doing now &amp; what is outstanding</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {techNames.map(t => {
              const open = jcs.filter(j => j.assigned_to === t && j.status !== 'complete' && j.status !== 'cancelled')
              const active = open.find(j => j.status === 'in_progress' && !j.paused)
              const paused = open.filter(j => j.status === 'in_progress' && j.paused)
              const waitingAccept = open.filter(j => j.status === 'assigned')
              const onDuty = dutyNow.includes(t)
              const tc = colorFor(t)
              return (
                <div key={t} className="rounded-lg border border-surface-rule bg-surface-raised p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tc.dot }} />
                      <strong className="text-[13px] text-text truncate">{t}</strong>
                    </div>
                    <span className={`badge ${onDuty ? 'badge-ok' : 'badge-gray'}`}>{onDuty ? 'ON DUTY' : 'OFF'}</span>
                  </div>
                  <div className="text-[12px] mb-1.5">
                    {active
                      ? <span className="text-warn font-medium">● Busy: <Link href={`/maintenance/job-cards/${active.id}`} className="text-accent">{active.card_no}</Link> — {active.area}</span>
                      : paused.length
                        ? <span className="text-text-muted">⏸ On hold ({paused.length}) — free to take work</span>
                        : <span className="text-ok">○ Available</span>}
                  </div>
                  <div className="flex gap-3 text-[11px] text-text-muted mb-1.5">
                    <span><strong className="text-text tabular-nums">{open.length}</strong> outstanding</span>
                    <span><strong className="text-text tabular-nums">{waitingAccept.length}</strong> to accept</span>
                  </div>
                  {open.length > 0 && (
                    <div className="space-y-0.5">
                      {open.slice(0, 4).map(j => (
                        <div key={j.id} className="text-[11px] truncate">
                          <Link href={`/maintenance/job-cards/${j.id}`} className="text-accent">{j.card_no}</Link>
                          <span className="text-text-faint"> · {j.status.replace(/_/g, ' ')}</span>
                          <span className="text-text-muted"> — {j.description}</span>
                        </div>
                      ))}
                      {open.length > 4 && <div className="text-[10px] text-text-faint">+{open.length - 4} more</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Add a planned slot (collapsible, manager only) ── */}
      {canManage && (
        <div className="card p-0 mb-4 overflow-hidden">
          <button onClick={() => setOpenAddSlot(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface-dim/50 transition">
            <Chevron open={openAddSlot} />
            <Plus size={15} className="text-brand" />
            <span className="text-sm font-semibold text-text">Add a planned slot</span>
            <span className="text-[12px] text-text-muted ml-1">card-linked estimate with note</span>
          </button>
          {openAddSlot && (
            <div className="px-4 pb-4 border-t border-surface-rule pt-3">
              <div className="flex gap-2 flex-wrap items-end">
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
                <button className={PRIMARY} onClick={actions.addSlot}>Add slot</button>
              </div>
              <div className="text-[11px] text-text-faint mt-2">Slots are estimates — actual durations come from the job-card timer.</div>
            </div>
          )}
        </div>
      )}

      {/* ── This week (calendar) ── */}
      <Section title="This week" subtitle={`${fmtD(weekStart.toISOString())} – ${fmtD(weekEnd.toISOString())}`} open={openWeek} onToggle={() => setOpenWeek(o => !o)}>
        <div className="flex gap-1.5 items-center mb-3 flex-wrap">
          <NavBtn onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })}>← Prev</NavBtn>
          <NavBtn onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</NavBtn>
          <NavBtn onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })}>Next →</NavBtn>
          <span className="text-[12px] text-text-muted ml-1">{fmtD(weekStart.toISOString())} – {fmtD(weekEnd.toISOString())}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
          {weekDays.map(day => {
            const isToday = sameDay(day, now)
            const daySlots = slotsOn(day)
            const dayRoster = rosterOn(day)
            return (
              <div key={day.toISOString()} className={`rounded-lg border shadow-sm ${isToday ? 'border-brand/50 bg-brand/[0.04] ring-1 ring-brand/20' : 'border-surface-rule bg-surface-card'} flex flex-col min-h-[120px]`}>
                <div className={`px-2 py-1.5 border-b ${isToday ? 'border-brand/30' : 'border-surface-rule'} flex items-baseline justify-between`}>
                  <span className={`text-[11px] font-semibold flex items-center gap-1 ${isToday ? 'text-brand' : 'text-text'}`}>{day.toLocaleDateString('en-ZA', { weekday: 'short' })}{isToday && <span className="text-[8px] font-bold uppercase bg-brand text-white rounded px-1 py-0.5">today</span>}</span>
                  <span className="text-[11px] text-text-muted tabular-nums">{day.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}</span>
                </div>
                <div className="p-1.5 flex-1 space-y-1">
                  {/* Roster duty windows — per-tech pastel, dashed border, on-duty glow */}
                  {dayRoster.map(r => {
                    const onNow = new Date(r.start_at).getTime() <= nowMs && nowMs <= new Date(r.end_at).getTime()
                    const tc = colorFor(r.technician)
                    return (
                      <div key={'r' + r.id}
                        style={{ background: tc.bg, borderColor: onNow ? '#1A7A3C' : tc.border, color: tc.text, boxShadow: onNow ? '0 0 0 2px rgba(26,122,60,0.25)' : undefined }}
                        className="rounded-md px-1.5 py-1 text-[10px] border border-dashed shadow-sm" title={`Duty: ${r.technician}`}>
                        <div className="font-semibold flex items-center gap-1">{r.technician}{onNow && <span className="text-[9px] font-bold text-ok">● ON DUTY</span>}</div>
                        <div className="opacity-70">{fmtT(r.start_at)}–{fmtT(r.end_at)} · duty</div>
                      </div>
                    )
                  })}
                  {/* Planner slots — per-tech pastel, solid, removable (manager) */}
                  {daySlots.map(s => {
                    const c = jcs.find(x => x.id === s.card_id)
                    const tc = colorFor(s.technician)
                    return (
                      <div key={'s' + s.id}
                        style={{ background: tc.bg, borderColor: tc.border, color: tc.text }}
                        className={`rounded-md px-1.5 py-1 text-[10px] border shadow-sm ${canManage ? 'cursor-pointer hover:shadow transition' : ''}`}
                        onClick={canManage ? () => actions.delSlot(s.id) : undefined}
                        title={canManage ? `${s.technician} — tap to remove` : s.technician}>
                        <div className="font-semibold">{fmtT(s.start_at)}–{fmtT(s.end_at)}</div>
                        <div className="flex items-center gap-1 font-medium"><span style={{ background: tc.dot }} className="w-1.5 h-1.5 rounded-full inline-block shrink-0" />{s.technician}</div>
                        {c && <div className="font-semibold opacity-90">{c.card_no}</div>}
                        {(s.note || c) && <div className="opacity-70 truncate">{s.note || c?.description.slice(0, 24)}</div>}
                      </div>
                    )
                  })}
                  {/* Empty-day add affordance — manager only */}
                  {canManage && daySlots.length === 0 && dayRoster.length === 0 && (
                    <button
                      onClick={() => actions.addSlotFor(slotForm.tech, staffByName(slotForm.tech)?.id ?? null, day)}
                      className="w-full min-h-[44px] rounded border border-dashed border-surface-rule text-[11px] text-text-faint hover:border-brand hover:text-brand transition flex items-center justify-center gap-1"
                      title={`Add a 2-hour slot for ${slotForm.tech}`}>
                      <Plus size={12} /> add
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {/* Technician colour legend */}
        {techNames.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-faint mr-0.5">Technicians</span>
            {techNames.map(t => {
              const tc = colorFor(t)
              return (
                <span key={t} className="inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full border px-2 py-0.5"
                  style={{ background: tc.bg, borderColor: tc.border, color: tc.text }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: tc.dot }} /> {t}
                </span>
              )
            })}
          </div>
        )}
        <div className="text-[11px] text-text-faint mt-2">
          Each technician has their own colour. Dashed chips are duty-roster windows; solid chips are planned slots.
          {canManage && ' Tap an empty day to add a quick 2-hour slot for the planner-form technician, or tap a slot chip to remove it.'}
        </div>
      </Section>

      {/* ── Duty roster (now sourced from the Operations shift roster) ── */}
      <Section title="Duty roster" subtitle="Sourced from the Operations shift roster" open={openRoster} onToggle={() => setOpenRoster(o => !o)}>
        <div className="rounded-lg bg-info/10 border border-info/20 p-3 text-[12px] text-text space-y-2">
          <div>
            The on-duty maintenance technician is now read from the <strong>Operations shift roster</strong> —
            the Maintenance-role rows for the current Day / Night shift. Breakdowns auto-route to whoever is on
            shift there, so the roster is managed in one place.
          </div>
          <div>Currently on duty: <strong className={duty ? 'text-ok' : 'text-err'}>{duty ?? 'NOBODY'}</strong>
            {dutyNow.length > 1 && <span className="text-text-muted"> (+{dutyNow.length - 1} more on shift)</span>}
          </div>
          <Link href="/production/roster"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand text-white px-3 py-2 text-[12px] font-semibold hover:brightness-110 transition">
            <CalendarRange size={14} /> Open the shift roster
          </Link>
        </div>
      </Section>

      {/* ── QC area map ── */}
      <Section title="QC area map" subtitle="Completed jobs route to the QC mapped to their area" open={openQc} onToggle={() => setOpenQc(o => !o)}>
        <div className="text-[12px] text-text-muted mb-2">Pick a name from your staff directory. Completed jobs route to the area's QC for the post-maintenance check.</div>
        <div className="max-h-[420px] overflow-y-auto">
          {AREAS.map(a => {
            const current = actions.qcFor(a)
            const known = staff.some(s => s.name === current)
            return (
              <div key={a} className="flex gap-1.5 items-center mb-1">
                <span className="text-[12px] w-44 text-text-muted">{a}</span>
                {canManage ? (
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
                ) : (
                  <span className="flex-1 text-[12px] text-text">{current || <span className="text-text-faint">— unassigned —</span>}</span>
                )}
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return open
    ? <ChevronDown size={16} className="text-text-muted shrink-0" />
    : <ChevronRight size={16} className="text-text-muted shrink-0" />
}

function Section({ title, subtitle, open, onToggle, children }: {
  title: string; subtitle?: string; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="card p-0 mb-4 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface-dim/50 transition">
        <Chevron open={open} />
        <span className="text-sm font-semibold text-text">{title}</span>
        {subtitle && <span className="text-[12px] text-text-muted ml-1 truncate">{subtitle}</span>}
      </button>
      {open && <div className="px-4 pb-4 border-t border-surface-rule pt-3">{children}</div>}
    </div>
  )
}

function NavBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="px-3 py-2 min-h-[40px] rounded-lg text-[12px] font-semibold border border-surface-rule text-text-muted hover:border-text/30 hover:text-text transition">
      {children}
    </button>
  )
}
