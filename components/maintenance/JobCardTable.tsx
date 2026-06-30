'use client'

// components/maintenance/JobCardTable.tsx
// Professional one-line job-card table. Each row is a scannable summary; clicking
// it expands an inline panel that renders the full JobCardItem (all workflow
// actions, timer, spares, comments and the activity log) — so the manager
// allocates and the technician logs work from the same expandable row.

import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { Timer } from './Timer'
import { JobCardItem, type JobCardRoles } from './JobCardItem'
import { diffDays, priorityOf, PRIORITY_META } from '@/lib/maintenance/helpers'
import { URGENCY_META } from '@/lib/maintenance/constants'
import type { JobCard } from '@/lib/maintenance/types'

export function JobCardTable({ cards, roles, empty = 'No job cards.' }: { cards: JobCard[]; roles: JobCardRoles; empty?: string }) {
  const [open, setOpen] = useState<number | null>(null)
  if (cards.length === 0) return <div className="card p-4 text-center text-[12px] text-text-faint">{empty}</div>
  return (
    <div className="rounded-xl border border-surface-rule bg-surface-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="data-table w-full">
          <thead><tr>
            <th className="w-6" />
            {['#', 'Type', 'Urgency', 'Area / machine', 'Description', 'Technician', 'Status', 'Timer / age'].map(h => <th key={h}>{h}</th>)}
          </tr></thead>
          <tbody>
            {cards.map(j => {
              const isOpen = open === j.id
              const isBd = j.workflow === 'breakdown'
              const urg = j.urgency ? URGENCY_META[j.urgency] : null
              const prio = PRIORITY_META[priorityOf(j)]
              const age = diffDays(j.raised_at, j.completed_at ?? j.verified_at ?? new Date().toISOString())
              // Live timer in-row while a job is actively running (breakdowns time
              // from raise; planned work from "Start job").
              const timerStart = isBd ? j.raised_at : j.started_at
              const running = (j.status === 'in_progress' && !j.paused) || (isBd && j.status === 'assigned')
              return (
                <Fragment key={j.id}>
                  <tr className={`cursor-pointer transition hover:bg-surface-dim/50 ${isOpen ? 'bg-surface-dim/40' : ''}`} onClick={() => setOpen(isOpen ? null : j.id)}>
                    <td className="text-text-muted align-middle">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td className="font-semibold text-accent whitespace-nowrap">{j.card_no}</td>
                    <td><span className={`badge ${isBd ? 'badge-err' : 'badge-info'}`}>{isBd ? 'BD' : 'PL'}</span></td>
                    <td><span className={`badge ${urg ? urg.badge : prio.badge}`}>{urg ? urg.label : prio.label}</span></td>
                    <td className="whitespace-nowrap">{j.area}{j.machine ? <span className="text-text-faint"> · {j.machine}</span> : ''}</td>
                    <td className="max-w-[280px] truncate" title={j.description}>{j.description}</td>
                    <td className="whitespace-nowrap">{j.assigned_to ?? <span className="text-text-faint">—</span>}{j.external && j.external_company ? <span className="text-text-faint"> (ext)</span> : ''}</td>
                    <td><StatusBadge status={j.status} /></td>
                    <td className="whitespace-nowrap tabular-nums text-text-muted">
                      {running && timerStart
                        ? <span onClick={e => e.stopPropagation()}><Timer start={timerStart} pauseMs={j.pause_ms ?? 0} pausedAt={j.paused ? j.paused_at ?? null : null} /></span>
                        : `${age}d`}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={9} className="bg-surface-raised/30 p-0">
                        <div className="p-3" onClick={e => e.stopPropagation()}><JobCardItem j={j} roles={roles} compact={false} /></div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
