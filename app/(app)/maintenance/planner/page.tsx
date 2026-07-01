'use client'

// app/(app)/maintenance/planner/page.tsx
// Planner & Roster — maintenance team at a glance.
// • "Next" strip — on duty now / up next on roster / next scheduled job
// • Per-technician status panel
// • Maintenance on shift — current-period shift assignments from the production roster
// • QC area map

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  ChevronDown, ChevronRight, CalendarRange, UserCheck, Clock3, Wrench, Users,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useMaintenanceContext } from '../layout'
import { deriveMaintRole } from '@/lib/maintenance/roles'
import { AREAS } from '@/lib/maintenance/constants'
import { fmtT, fmtDT } from '@/lib/maintenance/helpers'
import { INP } from '@/components/production/shared/ui'
import { getDb } from '@/lib/supabase/client'

// ── SAST helpers ──────────────────────────────────────────────────────────────
function todaySAST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }) // yyyy-MM-dd
}
function hourSAST() {
  return parseInt(new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: 'numeric', hour12: false }), 10)
}
// Day shift 07:00–16:59, night shift otherwise
function currentShift(): 'day' | 'night' {
  const h = hourSAST()
  return h >= 7 && h < 17 ? 'day' : 'night'
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface RosterEntry {
  id: string
  shift: 'day' | 'night'
  person_name: string | null
  role_key: string
}
interface RosterPeriod {
  id: string
  start_date: string
  end_date: string
  day_label: string | null
  night_label: string | null
}

// ── Per-technician pastel identity colours ────────────────────────────────────
interface Pastel { bg: string; border: string; text: string; dot: string }
const TECH_PALETTE: Pastel[] = [
  { bg: '#EDE9FE', border: '#8B5CF6', text: '#5B21B6', dot: '#7C3AED' },
  { bg: '#DBEAFE', border: '#3B82F6', text: '#1D4ED8', dot: '#2563EB' },
  { bg: '#D1FAE5', border: '#10B981', text: '#047857', dot: '#059669' },
  { bg: '#FEF3C7', border: '#F59E0B', text: '#B45309', dot: '#D97706' },
  { bg: '#FFE4E6', border: '#F43F5E', text: '#BE123C', dot: '#E11D48' },
  { bg: '#CFFAFE', border: '#06B6D4', text: '#0E7490', dot: '#0891B2' },
  { bg: '#FFEDD5', border: '#F97316', text: '#C2410C', dot: '#EA580C' },
  { bg: '#FAE8FF', border: '#D946EF', text: '#A21CAF', dot: '#C026D3' },
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
  const { loading, data, derived, actions } = ctx
  const { jcs, slots, staff } = data
  const { duty, dutyNow } = derived

  const techNames = staff.map(s => s.name)
  const techIndex = new Map(techNames.map((t, i) => [t, i]))
  const colorFor = (name: string) => TECH_PALETTE[(techIndex.has(name) ? techIndex.get(name)! : hashName(name)) % TECH_PALETTE.length]

  const [openQc, setOpenQc] = useState(false)

  // Shift roster state
  const [rosterPeriod, setRosterPeriod] = useState<RosterPeriod | null>(null)
  const [rosterEntries, setRosterEntries] = useState<RosterEntry[]>([])
  const [rosterLoading, setRosterLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setRosterLoading(true)
      const today = todaySAST()
      const { data: periods } = await getDb()
        .schema('production' as any)
        .from('roster_periods')
        .select('id,start_date,end_date,day_label,night_label')
        .lte('start_date', today)
        .gte('end_date', today)
        .order('start_date', { ascending: false })
        .limit(1)
      const period = (periods as RosterPeriod[] | null)?.[0] ?? null
      setRosterPeriod(period)
      if (period) {
        const { data: entries } = await getDb()
          .schema('production' as any)
          .from('roster_entries')
          .select('id,shift,person_name,role_key')
          .eq('period_id', period.id)
          .in('role_key', ['maintenance_tech', 'maintenance_asst'])
        setRosterEntries((entries as RosterEntry[] | null) ?? [])
      }
      setRosterLoading(false)
    }
    load()
  }, [])

  const nowMs = Date.now()

  // "Next" strip selectors
  const upNextRoster = [...(data.roster ?? [])]
    .filter(r => new Date(r.start_at).getTime() > nowMs)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0] ?? null
  const nextJob = [...slots]
    .filter(s => new Date(s.start_at).getTime() > nowMs)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0] ?? null
  const nextJobCard = nextJob ? jcs.find(c => c.id === nextJob.card_id) : null

  const activeShift = currentShift()
  const dayLabel = rosterPeriod?.day_label ?? 'Day shift'
  const nightLabel = rosterPeriod?.night_label ?? 'Night shift'
  const dayEntries = rosterEntries.filter(e => e.shift === 'day')
  const nightEntries = rosterEntries.filter(e => e.shift === 'night')

  if (loading) {
    return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="card p-6 text-text-muted text-sm">Loading planner…</div></div>
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text flex items-center gap-2"><CalendarRange className="w-6 h-6 text-brand" /> Planner &amp; Roster</h1>
          <p className="text-sm text-text-muted mt-1">Who is on duty, who is up next, and every scheduled slot — on one page.</p>
        </div>
      </div>

      {/* ── "Next" strip ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className={`rounded-xl border p-4 ${duty ? 'border-ok/30 bg-ok/5' : 'border-err/30 bg-err/5'}`}>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            <UserCheck className={`w-4 h-4 ${duty ? 'text-ok' : 'text-err'}`} /> On duty now
          </div>
          {duty
            ? <div className="mt-1.5 text-lg font-semibold text-ok flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorFor(duty).dot }} />{duty}</div>
            : <div className="mt-1.5 text-sm font-semibold text-err">Nobody — breakdowns will wait</div>}
          <div className="text-[11px] text-text-faint mt-1">Breakdowns auto-route to the on-duty technician.</div>
        </div>

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

      {/* ── Per-technician status ── */}
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

      {/* ── Maintenance on shift — from the production roster ── */}
      <div className="card p-4 mb-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarRange size={16} className="text-brand" />
            <h2 className="text-sm font-semibold text-text">Maintenance on shift</h2>
            {rosterPeriod && (
              <span className="text-[11px] text-text-muted">
                {new Date(rosterPeriod.start_date + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                {' – '}
                {new Date(rosterPeriod.end_date + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
          <Link href="/production/roster"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand hover:underline">
            Edit in Shift Roster →
          </Link>
        </div>

        {rosterLoading ? (
          <div className="text-sm text-text-muted">Loading roster…</div>
        ) : !rosterPeriod ? (
          <div className="rounded-lg border border-warn/20 bg-warn/5 p-3 text-[12px] text-text-muted">
            No active roster period found for today. <Link href="/production/roster" className="text-brand font-semibold hover:underline">Open the shift roster</Link> to create one.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Day shift */}
            <div className={`rounded-xl border p-4 ${activeShift === 'day' ? 'border-brand/40 bg-brand/5 ring-1 ring-brand/20' : 'border-surface-rule bg-surface-card'}`}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-[11px] font-bold uppercase tracking-wide ${activeShift === 'day' ? 'text-brand' : 'text-text-muted'}`}>
                  {dayLabel}
                </span>
                {activeShift === 'day' && (
                  <span className="text-[9px] font-bold bg-brand text-white rounded px-1.5 py-0.5 uppercase tracking-wide">Active now</span>
                )}
                <span className="text-[10px] text-text-faint ml-auto">07:00 – 16:59</span>
              </div>
              {dayEntries.length === 0 ? (
                <div className="text-[12px] text-text-faint">No maintenance staff on day shift.</div>
              ) : (
                <div className="space-y-2">
                  {dayEntries.map(e => {
                    const name = e.person_name ?? '—'
                    const tc = colorFor(name)
                    const onDuty = dutyNow.includes(name)
                    return (
                      <div key={e.id} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tc.dot }} />
                        <span className="text-[13px] font-medium text-text flex-1">{name}</span>
                        <span className="text-[10px] text-text-faint">{e.role_key === 'maintenance_tech' ? 'Technician' : 'Assistant'}</span>
                        {onDuty && <span className="badge badge-ok text-[9px]">ON DUTY</span>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Night shift */}
            <div className={`rounded-xl border p-4 ${activeShift === 'night' ? 'border-brand/40 bg-brand/5 ring-1 ring-brand/20' : 'border-surface-rule bg-surface-card'}`}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-[11px] font-bold uppercase tracking-wide ${activeShift === 'night' ? 'text-brand' : 'text-text-muted'}`}>
                  {nightLabel}
                </span>
                {activeShift === 'night' && (
                  <span className="text-[9px] font-bold bg-brand text-white rounded px-1.5 py-0.5 uppercase tracking-wide">Active now</span>
                )}
                <span className="text-[10px] text-text-faint ml-auto">17:00 – 06:59</span>
              </div>
              {nightEntries.length === 0 ? (
                <div className="text-[12px] text-text-faint">No maintenance staff on night shift.</div>
              ) : (
                <div className="space-y-2">
                  {nightEntries.map(e => {
                    const name = e.person_name ?? '—'
                    const tc = colorFor(name)
                    const onDuty = dutyNow.includes(name)
                    return (
                      <div key={e.id} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tc.dot }} />
                        <span className="text-[13px] font-medium text-text flex-1">{name}</span>
                        <span className="text-[10px] text-text-faint">{e.role_key === 'maintenance_tech' ? 'Technician' : 'Assistant'}</span>
                        {onDuty && <span className="badge badge-ok text-[9px]">ON DUTY</span>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

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
