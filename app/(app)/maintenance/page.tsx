'use client'

// app/(app)/maintenance/page.tsx
// Maintenance dashboard / landing. Six KPI tiles from the live analytics plus
// link-cards into Job Cards, Scheduled and Stock (modelled on logistics/page.tsx).
// Richer charts + AI analyst land in Phase 4 (placeholder below).

import Link from 'next/link'
import { ClipboardList, CalendarCheck, Boxes, ArrowRight } from 'lucide-react'
import { useMaintenanceContext } from './layout'
import MaintenanceAnalytics from '@/components/maintenance/MaintenanceDashboard'

export default function MaintenanceDashboard() {
  const { loading, error, data, derived } = useMaintenanceContext()
  const { jcs } = data
  const { totalMins, avgCloseDays, reopens, breakdowns, completionRate, completed, duty, newCards, openPlannedCards, annualRows } = derived

  const kpis: { value: string; label: string }[] = [
    { value: String(jcs.length), label: 'Job cards logged' },
    { value: String(breakdowns), label: 'Breakdowns' },
    { value: (totalMins / 60).toFixed(1) + ' hrs', label: 'Recorded repair time' },
    { value: avgCloseDays + ' days', label: 'Avg time to close' },
    { value: String(reopens), label: 'QC / verify reopens' },
    { value: jcs.length ? completionRate + '%' : '—', label: 'Completion rate' },
  ]

  const dueSoon = annualRows.filter(a => a.days <= 60).length

  const cards = [
    {
      href: '/maintenance/job-cards',
      icon: ClipboardList,
      title: 'Job Cards',
      desc: 'Raise breakdowns & planned work, allocate, run QC and verify.',
      stat: `${newCards.length} awaiting allocation`,
      accent: 'bg-warn/10 text-warn border-warn/20',
    },
    {
      href: '/maintenance/scheduled',
      icon: CalendarCheck,
      title: 'Scheduled',
      desc: 'Weekly & monthly checklists plus annual / calibration tracking.',
      stat: `${dueSoon} due within 60 days`,
      accent: 'bg-info/10 text-info border-info/20',
    },
    {
      href: '/maintenance/stock',
      icon: Boxes,
      title: 'Stock & Spares',
      desc: 'Spare parts register, usage log and offsite equipment tracking.',
      stat: `${data.stock.length} parts`,
      accent: 'bg-accent/10 text-accent border-accent/20',
    },
  ]

  if (loading) {
    return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="card p-6 text-text-muted text-sm">Loading maintenance system…</div></div>
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text">Maintenance</h1>
          <p className="text-sm text-text-muted mt-1">FSSC 22000 maintenance management — breakdowns, planned work, scheduled checklists and spares.</p>
        </div>
        <span className={`badge ${duty ? 'badge-ok' : 'badge-err'}`}>{duty ? `On duty: ${duty}` : 'No tech on duty'}</span>
      </div>

      {error && <div className="card p-3 mb-4 text-[12px] text-err border border-err/30">{error}</div>}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6 stagger">
        {kpis.map(k => (
          <div key={k.label} className="card p-4 text-center">
            <div className="text-2xl font-semibold text-text tabular-nums">{k.value}</div>
            <div className="text-[11px] uppercase tracking-wider text-text-muted mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Module link cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-in">
        {cards.map(c => (
          <Link key={c.href} href={c.href}
            className="group rounded-xl border border-surface-rule bg-surface-card p-5 hover:border-text/30 transition shadow-sm hover:shadow-md">
            <div className="flex items-start justify-between">
              <div className={`inline-flex items-center justify-center w-11 h-11 rounded-lg border ${c.accent}`}>
                <c.icon className="w-5 h-5" />
              </div>
              <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-text group-hover:translate-x-0.5 transition" />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text">{c.title}</h3>
              <span className="text-[11px] uppercase tracking-wider text-text-muted">{c.stat}</span>
            </div>
            <p className="text-sm text-text-muted mt-1">{c.desc}</p>
          </Link>
        ))}
      </div>

      {/* Quick context */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
        <MiniStat label="Completed" value={completed.length} />
        <MiniStat label="Open planned" value={openPlannedCards.length} />
        <MiniStat label="New / awaiting" value={newCards.length} />
        <MiniStat label="Calibration due ≤60d" value={dueSoon} />
      </div>

      {/* Smart analytics, charts & AI analyst */}
      <div className="mt-8">
        <MaintenanceAnalytics />
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-surface-rule bg-surface-card p-3">
      <div className="text-[11px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="text-2xl font-semibold text-text mt-1 tabular-nums">{value}</div>
    </div>
  )
}
