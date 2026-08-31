'use client'

// app/(app)/maintenance/my-jobs/page.tsx
// The technician's own job-card screen: Allocated / In progress / Completed tabs
// over the cards assigned to them (as either the first OR second technician),
// plus an "All history" tab over every closed card so a technician can research a
// machine before starting work — what broke before, what was done, and whether it
// keeps coming back.
//
// Every tab shares one filter bar: area, machine, issue/fault type, closed-date
// range and free-text search.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, Wrench } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useMaintenanceContext } from '../layout'
import { deriveMaintRole } from '@/lib/maintenance/roles'
import { JobCardTable } from '@/components/maintenance/JobCardTable'
import { PLANNED_TYPES } from '@/lib/maintenance/constants'
import { fmtD, diffDays } from '@/lib/maintenance/helpers'
import { INP } from '@/components/production/shared/ui'
import type { JobCard } from '@/lib/maintenance/types'

const TAB = (active: boolean) =>
  `px-3.5 py-2 rounded-lg text-[12px] font-semibold whitespace-nowrap transition ${active ? 'bg-brand text-white' : 'text-text-muted hover:bg-surface-dim'}`

type TabKey = 'allocated' | 'in_progress' | 'completed' | 'history'

export default function MyJobsPage() {
  const auth = useAuth()
  const role = deriveMaintRole(auth)
  const { loading, data, actor } = useMaintenanceContext()
  const { jcs } = data

  const cardRoles = { canManage: role.canManage, isTech: role.isTech, isQc: role.isQc, isRaiser: role.isRaiser }

  const [tab, setTab] = useState<TabKey>('allocated')
  const [q, setQ] = useState('')
  const [areaF, setAreaF] = useState('all')
  const [machF, setMachF] = useState('all')
  const [issueF, setIssueF] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // Cards where I am either technician (a two-person job counts for both).
  const mine = useMemo(
    () => jcs.filter(j => j.assigned_to === actor || j.assigned_to_2 === actor),
    [jcs, actor],
  )

  // Filter option lists come from whichever set the active tab reads, so the
  // dropdowns never offer a value that can't match anything.
  const pool = tab === 'history' ? jcs : mine
  const areas = useMemo(() => Array.from(new Set(pool.map(j => j.area).filter(Boolean))).sort(), [pool])
  const machines = useMemo(() => Array.from(new Set(pool.map(j => j.machine).filter(Boolean) as string[])).sort(), [pool])

  const dateOf = (j: JobCard) => (j.completed_at ?? j.verified_at ?? j.raised_at ?? '').slice(0, 10)
  const ql = q.trim().toLowerCase()

  const passes = (j: JobCard) => {
    if (areaF !== 'all' && j.area !== areaF) return false
    if (machF !== 'all' && j.machine !== machF) return false
    if (issueF !== 'all') {
      if (issueF === 'breakdown') { if (j.workflow !== 'breakdown') return false }
      else if (!(j.maint_types ?? []).includes(issueF)) return false
    }
    const d = dateOf(j)
    if (from && d && d < from) return false
    if (to && d && d > to) return false
    if (ql && ![j.card_no, j.area, j.machine, j.description, j.long_desc, j.root_cause, j.work_done, j.assigned_to, j.assigned_to_2, j.raised_by]
      .some(v => (v ?? '').toLowerCase().includes(ql))) return false
    return true
  }

  const rows = useMemo(() => {
    const base =
      tab === 'allocated' ? mine.filter(j => j.status === 'assigned')
      : tab === 'in_progress' ? mine.filter(j => j.status === 'in_progress')
      : tab === 'completed' ? mine.filter(j => j.status === 'complete')
      : jcs.filter(j => j.status === 'complete' || j.status === 'cancelled')
    return base.filter(passes).sort((a, b) => (dateOf(b) ?? '').localeCompare(dateOf(a) ?? ''))
  }, [tab, mine, jcs, areaF, machF, issueF, from, to, ql]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = {
    allocated: mine.filter(j => j.status === 'assigned').length,
    in_progress: mine.filter(j => j.status === 'in_progress').length,
    completed: mine.filter(j => j.status === 'complete').length,
  }

  const active = !!(q || from || to || areaF !== 'all' || machF !== 'all' || issueF !== 'all')
  const clear = () => { setQ(''); setFrom(''); setTo(''); setAreaF('all'); setMachF('all'); setIssueF('all') }

  if (loading) return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="card p-6 text-text-muted text-sm">Loading…</div></div>

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-text flex items-center gap-2"><Wrench className="w-6 h-6 text-brand" /> My job cards</h1>
        <p className="text-sm text-text-muted mt-1">
          Your allocated, in-progress and completed work, {actor ? <strong className="text-text">{actor}</strong> : 'technician'}.
          Use <strong className="text-text">All history</strong> to look up a machine before you start — what failed before, what was done, and whether it keeps recurring.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button className={TAB(tab === 'allocated')} onClick={() => setTab('allocated')}>Allocated <span className="opacity-70 tabular-nums">{counts.allocated}</span></button>
        <button className={TAB(tab === 'in_progress')} onClick={() => setTab('in_progress')}>In progress <span className="opacity-70 tabular-nums">{counts.in_progress}</span></button>
        <button className={TAB(tab === 'completed')} onClick={() => setTab('completed')}>Completed <span className="opacity-70 tabular-nums">{counts.completed}</span></button>
        <button className={TAB(tab === 'history')} onClick={() => setTab('history')}>All history</button>
      </div>

      {/* Shared filters — stack on mobile, one labelled row from sm: up */}
      <div className="card p-3 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">Search</span>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
              <input className={`${INP} pl-8 w-full`} placeholder="Card, fault, root cause, what was done…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">Area</span>
            <select className={`${INP} w-auto`} value={areaF} onChange={e => setAreaF(e.target.value)}>
              <option value="all">All areas</option>
              {areas.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">Machine</span>
            <select className={`${INP} w-auto`} value={machF} onChange={e => setMachF(e.target.value)}>
              <option value="all">All machines</option>
              {machines.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">Issue / fault</span>
            <select className={`${INP} w-auto`} value={issueF} onChange={e => setIssueF(e.target.value)}>
              <option value="all">All types</option>
              <option value="breakdown">Breakdown</option>
              {PLANNED_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">From</span>
            <input type="date" className={`${INP} w-auto`} value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">To</span>
            <input type="date" className={`${INP} w-auto`} value={to} onChange={e => setTo(e.target.value)} />
          </div>
          {active && <button className="text-[12px] underline text-text-muted hover:text-text pb-2" onClick={clear}>Clear</button>}
        </div>
      </div>

      {/* History reads as a reference table (what was done); the working tabs use
          the normal expandable board rows so a card can be actioned in place. */}
      {tab === 'history' ? (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead><tr>{['#', 'Type', 'Area', 'Machine', 'Fault', 'Root cause', 'What was done', 'Technician', 'Closed'].map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 200).map(j => (
                <tr key={j.id}>
                  <td><Link href={`/maintenance/job-cards/${j.id}`} className="text-accent font-semibold whitespace-nowrap">{j.card_no}</Link></td>
                  <td><span className={`badge ${j.workflow === 'breakdown' ? 'badge-err' : 'badge-info'}`}>{j.workflow === 'breakdown' ? 'BD' : 'PL'}</span></td>
                  <td className="whitespace-nowrap">{j.area}</td>
                  <td className="text-text-muted whitespace-nowrap">{j.machine ?? '—'}</td>
                  <td className="max-w-[220px] truncate" title={j.description}>{j.description}</td>
                  <td className="max-w-[200px] truncate text-text-muted" title={j.root_cause}>{j.root_cause || '—'}</td>
                  <td className="max-w-[240px] truncate text-text-muted" title={j.work_done}>{j.work_done || '—'}</td>
                  <td className="whitespace-nowrap">{j.assigned_to ?? '—'}{j.assigned_to_2 ? ` + ${j.assigned_to_2}` : ''}</td>
                  <td className="whitespace-nowrap">{j.status === 'cancelled' ? <span className="badge badge-gray">cancelled</span> : fmtD(j.completed_at ?? j.verified_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {rows.length === 0 && <div className="p-6 text-center text-[13px] text-text-faint">No job cards match these filters.</div>}
          {rows.length > 200 && <div className="p-2 text-[11px] text-text-faint text-center">Showing the first 200 of {rows.length} — narrow with the filters.</div>}
        </div>
      ) : (
        <JobCardTable cards={rows} roles={cardRoles} empty={
          tab === 'allocated' ? 'Nothing allocated to you right now.'
          : tab === 'in_progress' ? 'You have no jobs in progress.'
          : 'You have no completed job cards yet.'} />
      )}
    </div>
  )
}
