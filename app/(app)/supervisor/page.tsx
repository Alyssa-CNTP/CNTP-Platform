'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  CalendarRange, Users, Clock, Factory, Wrench, HardHat,
  ChevronRight, Tag, RefreshCw,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { resolveOnDutyTechnician } from '@/lib/maintenance/roster'
import { currentShift, SHIFT_LABEL } from '@/lib/production/shifts'
import { HubTabs } from '@/components/supervisor/HubTabs'

const hrsLabel = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}h ${m}m` : `${m}m` }

interface Snapshot {
  shifts:    number
  operators: number
  hoursMin:  number
  productions: number
  breakdowns: number
  dutyTech:  string | null
}

export default function SupervisorOverview() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const shift = currentShift()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const db = getDb()
    const [assigns, timesheets, sessions, breakdowns, duty] = await Promise.all([
      db.schema('production').from('shift_assignments').select('operator_ids').eq('date', today),
      db.schema('production').from('prod_timesheets').select('worked_minutes').eq('date', today).eq('confirmed', true),
      db.schema('production').from('prod_sessions').select('id').eq('date', today),
      db.schema('maintenance').from('job_cards').select('id,status').eq('workflow', 'breakdown').neq('status', 'complete'),
      resolveOnDutyTechnician(db as any),
    ])
    const aRows = (assigns.data as any[]) ?? []
    const ops = new Set<string>()
    aRows.forEach(a => (a.operator_ids ?? []).forEach((id: string) => ops.add(id)))
    setSnap({
      shifts: aRows.length,
      operators: ops.size,
      hoursMin: ((timesheets.data as any[]) ?? []).reduce((s, r) => s + (r.worked_minutes ?? 0), 0),
      productions: ((sessions.data as any[]) ?? []).length,
      breakdowns: ((breakdowns.data as any[]) ?? []).length,
      dutyTech: duty?.name ?? null,
    })
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const v = (n: string | number) => loading ? '—' : String(n)
  const tiles = [
    { label: 'Shifts rostered', value: v(snap?.shifts ?? 0),        icon: CalendarRange, cls: 'text-text' },
    { label: 'Operators on shift', value: v(snap?.operators ?? 0),  icon: Users,         cls: 'text-text' },
    { label: 'Hours logged',    value: loading ? '—' : hrsLabel(snap?.hoursMin ?? 0), icon: Clock, cls: 'text-brand' },
    { label: 'Productions',     value: v(snap?.productions ?? 0),   icon: Factory,       cls: 'text-text' },
    { label: 'Open breakdowns', value: v(snap?.breakdowns ?? 0),    icon: Wrench,        cls: (snap?.breakdowns ?? 0) > 0 ? 'text-warn' : 'text-text-muted' },
    { label: 'Tech on duty',    value: loading ? '—' : (snap?.dutyTech ?? 'None'),     icon: HardHat, cls: snap?.dutyTech ? 'text-text' : 'text-text-muted', small: true },
  ]

  const links = [
    { href: '/supervisor/timesheets', label: 'Timesheets', desc: 'Operator hours & breaks', icon: Clock },
    { href: '/supervisor/productions', label: 'Productions', desc: 'What was produced + handover notes', icon: Factory },
    { href: '/tags', label: 'Bag Tracking', desc: 'Look up any bag tag', icon: Tag },
    { href: '/maintenance', label: 'Maintenance', desc: 'Breakdowns & job cards', icon: Wrench },
  ]

  return (
    <div className="px-4 py-6 max-w-[1000px] mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display font-bold text-[22px] text-text">Supervisor Hub</h1>
          <p className="text-[12px] text-stone-400 mt-0.5">
            {format(new Date(), 'EEEE d MMM')} · {SHIFT_LABEL[shift]} shift
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text mt-1">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      <HubTabs />

      {/* Today snapshot */}
      <div>
        <h3 className="font-display font-bold text-[13px] text-text-muted uppercase tracking-wide mb-3">Today at a glance</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {tiles.map(t => (
            <div key={t.label} className="bg-surface-card border border-surface-rule rounded-xl p-4">
              <t.icon size={14} className={`${t.cls} mb-2`} />
              <div className={`font-display font-bold leading-none ${t.cls} ${(t as any).small ? 'text-[15px]' : 'text-[24px]'}`}>{t.value}</div>
              <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide mt-1">{t.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Module links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {links.map(l => (
          <Link key={l.href} href={l.href}
            className="flex items-center gap-3 bg-surface-card border border-surface-rule rounded-2xl p-4 hover:border-brand/40 hover:bg-surface transition-colors group">
            <div className="w-10 h-10 rounded-xl bg-brand/8 text-brand flex items-center justify-center shrink-0">
              <l.icon size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-body font-semibold text-[14px] text-text">{l.label}</div>
              <div className="text-[12px] text-text-muted">{l.desc}</div>
            </div>
            <ChevronRight size={16} className="text-stone-300 group-hover:text-brand transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  )
}
