'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Clock, Factory, CalendarDays, MessageSquare } from 'lucide-react'

// Sub-nav for the Supervisor Hub. Calendar + Messages are shown as disabled
// "soon" placeholders until phases 2/3 land — matching the tab styling used on
// the Management page (border-b-2 brand on active).
const TABS = [
  { href: '/supervisor',             label: 'Overview',    icon: LayoutDashboard },
  { href: '/supervisor/timesheets',  label: 'Timesheets',  icon: Clock },
  { href: '/supervisor/productions', label: 'Productions', icon: Factory },
  { href: '/supervisor/calendar',    label: 'Calendar',    icon: CalendarDays },
  { href: '/supervisor/messages',    label: 'Messages',    icon: MessageSquare },
] as const

const SOON: { label: string; icon: typeof MessageSquare }[] = []

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
      {SOON.map(s => (
        <span key={s.label} title="Coming soon"
          className="flex items-center gap-1.5 px-4 py-3 font-medium text-[13px] border-b-2 border-transparent text-stone-300 whitespace-nowrap cursor-default">
          <s.icon size={14} /> {s.label}
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-400">soon</span>
        </span>
      ))}
    </div>
  )
}
