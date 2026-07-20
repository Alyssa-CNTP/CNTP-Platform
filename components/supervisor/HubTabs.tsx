'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarRange, PenLine, Factory, MessageSquare, Clock } from 'lucide-react'

// Sub-nav for the Supervisor Hub — deliberately just the five things a
// low-tech-comfort supervisor actually needs day to day, in the order they'd
// reach for them: roster the shift, sign sections off, check PO history,
// talk to the floor, review hours. The old Overview/Analytics/Calendar/Assign
// tabs still exist in the codebase (reachable directly) but aren't primary
// nav here — they read as extra surface area, not daily tools.
const TABS = [
  { href: '/supervisor',                  label: 'Roster',      icon: CalendarRange },
  { href: '/supervisor/signoff',          label: 'Sign-off',    icon: PenLine },
  { href: '/supervisor/productions',      label: 'Productions', icon: Factory },
  { href: '/supervisor/messages',         label: 'Messages',    icon: MessageSquare },
  { href: '/supervisor/timesheets',       label: 'Timesheets',  icon: Clock },
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
