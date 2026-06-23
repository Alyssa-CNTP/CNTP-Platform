'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Clock, Factory, CalendarDays, MessageSquare } from 'lucide-react'

// Sub-nav for the Supervisor Hub. Analytics was folded into the Overview
// (KPI strip + 7-day trends), so it no longer needs its own tab — the deeper
// breakdowns stay reachable via the Overview's "Full analytics" link.
const TABS = [
  { href: '/supervisor',             label: 'Overview',    icon: LayoutDashboard },
  { href: '/supervisor/timesheets',  label: 'Timesheets',  icon: Clock },
  { href: '/supervisor/productions', label: 'Productions', icon: Factory },
  { href: '/supervisor/calendar',    label: 'Calendar',    icon: CalendarDays },
  { href: '/supervisor/messages',    label: 'Messages',    icon: MessageSquare },
] as const

export function HubTabs() {
  const pathname = usePathname()
  return (
    <div className="flex items-center gap-1 border-b border-stone-200 overflow-x-auto">
      {TABS.map(t => {
        const active = pathname === t.href
        return (
          <Link key={t.href} href={t.href}
            className={`flex items-center gap-1.5 px-4 py-3 font-medium text-[13px] border-b-2 transition-colors -mb-px whitespace-nowrap ${active ? 'border-brand text-brand' : 'border-transparent text-stone-400 hover:text-stone-700'}`}>
            <t.icon size={14} /> {t.label}
          </Link>
        )
      })}
    </div>
  )
}

// Shared page header for every Hub tab: a consistent title + contextual
// subtitle + the tab bar, with an optional right-aligned action (e.g. Refresh).
// Keeps all tabs visually identical at the top so the hub is easy to follow.
export function HubHeader({ subtitle, action }: { subtitle?: string; action?: React.ReactNode }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-[22px] text-text">Supervisor Hub</h1>
          {subtitle && <p className="text-[12px] text-stone-400 mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="mt-1 shrink-0">{action}</div>}
      </div>
      <HubTabs />
    </>
  )
}
